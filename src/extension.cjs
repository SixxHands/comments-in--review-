// SPDX-License-Identifier: BUSL-1.1
'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const repo = require('./repository.cjs');
const store = require('./state.cjs');
const review = require('./comments-in-review.cjs');
const navigation = require('./navigation.cjs');
function activateCommentsInReview(context) {
  let root = null,
    results = [],
    visibleResults = [],
    generation = 0,
    timer,
    branchWatcher,
    watchedHead;
  const emitter = new vscode.EventEmitter();
  const output = vscode.window.createOutputChannel('Comments In (Review)');
  const virtual = new Map();
  const contentProvider = {
    provideTextDocumentContent: (uri) => virtual.get(uri.toString()) || '',
  };
  function uri(label, text) {
    const u = vscode.Uri.parse(
      'comments-in-review:/' +
        encodeURIComponent(label) +
        '?' +
        Date.now() +
        Math.random(),
    );
    virtual.set(u.toString(), text);
    return u;
  }
  async function guard(fn) {
    try {
      if (!vscode.workspace.isTrusted)
        throw new Error(
          'Trust this workspace before reviewing or installing hooks',
        );
      await fn();
    } catch (e) {
      vscode.window.showErrorMessage('Comments In (Review): ' + e.message);
    }
  }
  async function chooseRoot() {
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length)
      throw new Error('Open a local Git project in VS Code first');
    const selected =
      folders.length === 1
        ? folders[0]
        : await vscode.window.showQuickPick(
            folders.map((f) => ({ label: f.name, folder: f })),
          );
    if (!selected) return null;
    return repo.rootAt((selected.folder || selected).uri.fsPath);
  }
  async function refresh() {
    if (!root) return;
    const headPath = path.resolve(
      root,
      repo.git(root, ['rev-parse', '--git-path', 'HEAD']).trim(),
    );
    if (watchedHead !== headPath) {
      branchWatcher?.dispose();
      branchWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          path.dirname(headPath),
          path.basename(headPath),
        ),
      );
      context.subscriptions.push(
        branchWatcher,
        branchWatcher.onDidChange(schedule),
        branchWatcher.onDidCreate(schedule),
      );
      watchedHead = headPath;
    }
    store.ensureContext(root);
    const current = ++generation;
    const next = await review.scan(root);
    if (current !== generation) return;
    const visible = await navigation.discover(
      vscode,
      root,
      next,
      store.load(root),
    );
    if (current !== generation) return;
    results = next;
    visibleResults = visible;
    emitter.fire();
    const count = navigation.pending(visibleResults).length;
    view.badge = { value: count, tooltip: `${count} items need review` };
    view.message = count
      ? `${count} items need human review`
      : 'No pending items in the current view';
    status.text = `$(comment-discussion) ${store.load(root).contextLabel}: ${count} to review`;
    status.tooltip = 'Review the next comment, removal, or inspection error';
  }
  const provider = {
    onDidChangeTreeData: emitter.event,
    getParent(item) {
      return item.type === 'file' ? undefined : { type: 'file', r: item.r };
    },
    getTreeItem(item) {
      if (item.type === 'file') {
        const t = new vscode.TreeItem(
          item.r.file,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        t.id = 'file:' + item.r.file;
        t.contextValue = 'reviewFile';
        t.description = item.r.error
          ? 'Cannot inspect'
          : item.r.approved
            ? 'Approved'
            : item.r.mode === 'whole-file'
              ? 'Full-file review'
              : 'Needs review';
        t.tooltip =
          item.r.error || item.r.reason || 'Source comments and documentation';
        return t;
      }
      const t = new vscode.TreeItem(
        item.label,
        vscode.TreeItemCollapsibleState.None,
      );
      t.id =
        item.r.file + ':' + item.type + ':' + (item.i?.index ?? item.label);
      t.contextValue =
        item.type === 'removal'
          ? 'removal'
          : item.type === 'comment'
            ? 'comment'
            : 'error';
      if (item.type === 'comment') {
        t.description = [
          item.i.reason,
          item.i.approvalSource ? 'Linked: ' + item.i.approvalSource : null,
          item.i.symbol,
        ]
          .filter(Boolean)
          .join(' · ');
        t.tooltip = item.i.text;
        t.command = {
          command: 'commentsInReview.open',
          title: 'Open',
          arguments: [item],
        };
        t.iconPath = new vscode.ThemeIcon(
          item.i.approved ? 'pass' : 'comment-discussion',
        );
      }
      return t;
    },
    getChildren(parent) {
      return navigation.children(visibleResults, parent, 'pending');
    },
  };
  const approvedProvider = {
    ...provider,
    getChildren(parent) {
      return navigation.children(visibleResults, parent, 'approved');
    },
  };
  const view = vscode.window.createTreeView('commentsInReview.pending', {
    treeDataProvider: provider,
  });
  const approvedView = vscode.window.createTreeView(
    'commentsInReview.approved',
    {
      treeDataProvider: approvedProvider,
    },
  );
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    20,
  );
  status.command = 'commentsInReview.reviewNext';
  status.text = '$(comment-discussion) Comments In (Review)';
  status.show();
  function command(id, fn) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (...args) =>
        guard(() => fn(...args)),
      ),
    );
  }
  async function selected(item) {
    if (item) return item;
    return view.selection[0] || approvedView.selection[0];
  }
  async function open(item) {
    item = await selected(item);
    if (!item?.i) return;
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(repo.safePath(root, item.r.file)),
    );
    const editor = await vscode.window.showTextDocument(doc);
    const range = new vscode.Range(
      doc.positionAt(item.i.start),
      doc.positionAt(item.i.end),
    );
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range);
  }
  function requireSaved(file) {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.fsPath === repo.safePath(root, file),
    );
    if (doc?.isDirty)
      throw new Error(
        'Save the source file, then review the saved text before approval',
      );
  }
  command('commentsInReview.scanFolder', async (folder) => {
    if (!folder || folder.scheme !== 'file')
      throw new Error('Select a local folder in Explorer');
    const target = repo.rootAt(folder.fsPath);
    const scope =
      path.relative(target, folder.fsPath).replace(/\\/g, '/') || '.';
    if (scope !== '.') repo.safePath(target, scope);
    store.initialize(target, scope);
    root = target;
    await refresh();
  });
  let lastReviewKey = null;
  command('commentsInReview.reviewNext', async () => {
    if (!root) {
      await vscode.commands.executeCommand('commentsInReview.scan');
    }
    if (!root) return;
    await refresh();
    const queue = navigation.pending(visibleResults);
    if (!queue.length) {
      vscode.window.showInformationMessage(
        'No pending items in the current view.',
      );
      return;
    }
    const key = (item) =>
      item.r.file + ':' + item.type + ':' + (item.i?.index ?? '');
    const previous = queue.findIndex((item) => key(item) === lastReviewKey);
    const item = queue[(previous + 1) % queue.length];
    lastReviewKey = key(item);
    await view.reveal(item, { select: true, focus: true });
    if (item.type === 'error') throw new Error(item.r.file + ': ' + item.label);
    if (item.type === 'comment') await open(item);
    if (item.r.text !== null)
      await vscode.commands.executeCommand('commentsInReview.diff', item);
    else await vscode.commands.executeCommand('commentsInReview.history', item);
    const choice = await vscode.window.showQuickPick(
      ['Approve', 'Edit in diff', 'Skip'],
      {
        placeHolder: item.r.file + ' · ' + (item.i?.reason || item.label),
      },
    );
    if (choice === 'Approve')
      await vscode.commands.executeCommand(
        item.type === 'removal'
          ? 'commentsInReview.removal'
          : 'commentsInReview.approve',
        item,
      );
  });
  require('./ui-commands.cjs').registerCommentsInReviewCommands({
    state: {
      get root() {
        return root;
      },
      set root(value) {
        root = value;
      },
      get results() {
        return results;
      },
    },
    command,
    chooseRoot,
    refresh,
    selected,
    open,
    requireSaved,
    uri,
    output,
  });
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file' },
      {
        onDidChangeCodeLenses: emitter.event,
        provideCodeLenses(doc) {
          if (!root) return [];
          const r = visibleResults.find(
            (x) => repo.safePath(root, x.file) === doc.uri.fsPath,
          );
          if (!r) return [];
          return r.items.map(
            (i) =>
              new vscode.CodeLens(new vscode.Range(i.line, 0, i.line, 0), {
                title: i.approved
                  ? 'Comment approved'
                  : 'Review / approve ' + i.kind,
                command: 'commentsInReview.approve',
                arguments: [{ type: 'comment', r, i }],
              }),
          );
        },
      },
    ),
  );
  const diagnostics =
    vscode.languages.createDiagnosticCollection('comments-in-review');
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        guard(async () => {
          await refresh();
          diagnostics.clear();
          for (const r of visibleResults) {
            if (r.text === null || r.approved) continue;
            const ds = r.items
              .filter((i) => !i.approved)
              .map(
                (i) =>
                  new vscode.Diagnostic(
                    new vscode.Range(i.line, 0, i.line, 1),
                    'Human documentation review required' +
                      (i.codeChanged ? ' because source code changed' : ''),
                    vscode.DiagnosticSeverity.Information,
                  ),
              );
            diagnostics.set(vscode.Uri.file(repo.safePath(root, r.file)), ds);
          }
        }),
      350,
    );
  }
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    watcher.onDidChange(schedule),
    watcher.onDidCreate(schedule),
    watcher.onDidDelete(schedule),
    vscode.workspace.onDidSaveTextDocument(schedule),
    watcher,
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('commentsInReview') ||
        e.affectsConfiguration('commentReview')
      )
        schedule();
    }),
  );
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      {
        provideHover(doc, pos) {
          const r = visibleResults.find(
            (x) => root && repo.safePath(root, x.file) === doc.uri.fsPath,
          );
          const i = r?.items.find(
            (x) => pos.line >= x.line && pos.line <= x.endLine,
          );
          return i
            ? new vscode.Hover(
                'Comments In (Review): ' +
                  [i.reason, i.symbol].filter(Boolean).join(' · '),
              )
            : null;
        },
      },
    ),
  );
  context.subscriptions.push(
    emitter,
    view,
    approvedView,
    status,
    output,
    diagnostics,
    vscode.workspace.registerTextDocumentContentProvider(
      'comments-in-review',
      contentProvider,
    ),
    {
      dispose() {
        clearTimeout(timer);
      },
    },
  );
  guard(async () => {
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length === 1) {
      try {
        root = repo.rootAt(folders[0].uri.fsPath);
      } catch {
        return;
      }
      if (require('./compatibility.cjs').hasCommentsInReviewDirectory(root))
        await refresh();
    }
  });
  return { refresh, getResults: () => results };
}
function deactivateCommentsInReview() {}
module.exports = {
  activate: activateCommentsInReview,
  deactivate: deactivateCommentsInReview,
};
