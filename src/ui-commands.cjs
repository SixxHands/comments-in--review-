// SPDX-License-Identifier: BUSL-1.1
'use strict';
const vscode = require('vscode');
const path = require('node:path');
const repo = require('./repository.cjs');
const store = require('./state.cjs');
const review = require('./comments-in-review.cjs');
const gates = require('./gates.cjs');
function registerCommentsInReviewCommands({
  state,
  command,
  chooseRoot,
  refresh,
  selected,
  open,
  requireSaved,
  uri,
  output,
}) {
  require('./branch-ui.cjs').registerCommentsInReviewBranchCommands({
    state,
    command,
    chooseRoot,
    refresh,
  });
  require('./markdown-ui.cjs').registerCommentsInReviewMarkdownCommands({
    state,
    command,
    chooseRoot,
    refresh,
  });
  command('commentsInReview.scan', async () => {
    state.root = await chooseRoot();
    if (!state.root) return;
    const choice = await vscode.window.showQuickPick([
      'Entire project',
      'Choose folder',
    ]);
    if (!choice) return;
    let scope = '.';
    if (choice === 'Choose folder') {
      const dirs = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: vscode.Uri.file(state.root),
      });
      if (!dirs) return;
      scope =
        path.relative(state.root, dirs[0].fsPath).replace(/\\/g, '/') || '.';
      if (scope !== '.') repo.safePath(state.root, scope);
    }
    store.initialize(state.root, scope);
    await refresh();
  });
  command('commentsInReview.exclude', async (item) => {
    item = await selected(item);
    if (!item?.r) throw new Error('Select a file in the review tree');
    if (require('./markdown.cjs').isMarkdown(item.r.file))
      throw new Error(
        'Use Configure Markdown Protection to change Markdown coverage',
      );
    if (
      (await vscode.window.showWarningMessage(
        'Exclude ' + item.r.file + ' from review and Git gates?',
        {
          modal: true,
          detail: 'This is a human policy change, not an approval.',
        },
        'Exclude',
      )) === 'Exclude'
    ) {
      store.mutate(state.root, (s) => {
        s.excludes ||= [];
        if (!s.excludes.includes(item.r.file)) s.excludes.push(item.r.file);
      });
      await refresh();
    }
  });
  command('commentsInReview.restoreExclusions', async () => {
    state.root ||= await chooseRoot();
    if (!state.root) return;
    const s = store.load(state.root);
    const choices = await vscode.window.showQuickPick(s.excludes || [], {
      canPickMany: true,
      placeHolder: 'Select excluded paths to review again',
    });
    if (!choices) return;
    store.mutate(state.root, (s) => {
      s.excludes = (s.excludes || []).filter((f) => !choices.includes(f));
    });
    await refresh();
  });
  command('commentsInReview.open', open);
  command('commentsInReview.approve', async (item) => {
    item = await selected(item);
    if (item?.type !== 'comment')
      throw new Error('Select a comment in the review tree');
    requireSaved(item.r.file);
    await open(item);
    const action = await vscode.window.showInformationMessage(
      item.i.kind === 'protected Markdown'
        ? 'Approve this entire saved Markdown file?'
        : `Approve this ${item.i.kind} and its current source-file code?`,
      { modal: true, detail: item.i.text.slice(0, 1800) },
      'Approve',
    );
    if (action !== 'Approve') return;
    requireSaved(item.r.file);
    await review.approve(
      state.root,
      item.r.file,
      item.i.index,
      review.digest(item.r.text),
      item.r.contextKey,
    );
    await refresh();
  });
  command('commentsInReview.removal', async (item) => {
    item = await selected(item);
    if (item?.type !== 'removal')
      throw new Error('Select a removal in the review tree');
    requireSaved(item.r.file);
    const action = await vscode.window.showWarningMessage(
      `Approve removal in ${item.r.file}?`,
      {
        modal: true,
        detail:
          'Use Git history or the source diff to inspect what was removed. This approves only the displayed saved version.',
      },
      'Approve removal',
    );
    if (action === 'Approve removal') {
      await review.approveRemoval(
        state.root,
        item.r.file,
        review.digest(item.r.text),
        item.r.contextKey,
      );
      await refresh();
    }
  });
  command('commentsInReview.diff', async (item) => {
    item = await selected(item);
    if (!item?.r) return;
    const saved = store.load(state.root).files[item.r.file];
    let before =
      saved?.snapshots?.[item.i?.previousSourceDigest] ?? saved?.snapshotText;
    if (before === undefined) {
      try {
        const tree = repo.snapshot(state.root, 'HEAD');
        before = tree.has(item.r.file)
          ? repo.blob(state.root, tree.get(item.r.file))
          : '';
      } catch {
        before = '';
      }
    }
    await vscode.commands.executeCommand(
      'vscode.diff',
      uri('Previous source · ' + item.r.file, before),
      vscode.Uri.file(repo.safePath(state.root, item.r.file)),
      'Comments In (Review) · ' + item.r.file,
    );
  });
  command('commentsInReview.changes', async () => {
    state.root ||= await chooseRoot();
    if (!state.root) return;
    let s;
    try {
      s = store.load(state.root);
    } catch {
      store.initialize(state.root, '.');
      s = store.load(state.root);
    }
    let changed;
    try {
      changed = repo.git(state.root, [
        'diff',
        '--name-only',
        '-z',
        'HEAD',
        '--',
      ]);
    } catch {
      changed = repo.git(state.root, [
        'diff',
        '--cached',
        '--name-only',
        '-z',
        '--',
      ]);
    }
    const names = new Set([
      ...changed.split('\0').filter(Boolean),
      ...repo
        .git(state.root, ['ls-files', '--others', '--exclude-standard', '-z'])
        .split('\0')
        .filter(Boolean),
    ]);
    const files = [...names].filter((f) => repo.inScope(s, f));
    const file = await vscode.window.showQuickPick(files, {
      placeHolder: 'Select changed code to review its surrounding comments',
    });
    if (!file) return;
    await refresh();
    const r = state.results.find((r) => r.file === file);
    if (r?.text === null) {
      output.clear();
      output.appendLine(repo.git(state.root, ['diff', 'HEAD', '--', file]));
      output.show();
      return;
    }
    await vscode.commands.executeCommand('commentsInReview.diff', {
      r: r || { file },
    });
  });
  command('commentsInReview.history', async (item) => {
    item = await selected(item);
    if (!item?.r) return;
    output.clear();
    output.appendLine(
      repo.git(state.root, [
        'log',
        '-n',
        '20',
        '--format=fuller',
        '-p',
        '--',
        item.r.file,
      ]),
    );
    output.show();
  });
  command('commentsInReview.install', async () => {
    state.root ||= await chooseRoot();
    if (!state.root) return;
    store.load(state.root);
    if (
      (await vscode.window.showWarningMessage(
        'Install comments-in-review gates in this repository? Existing hooks will be preserved and chained. Node.js must be on Git’s PATH.',
        { modal: true },
        'Install',
      )) !== 'Install'
    )
      return;
    const dir = gates.install(state.root);
    vscode.window.showInformationMessage(
      'Comments In (Review) hooks installed: ' + dir,
    );
  });
  command('commentsInReview.uninstall', async () => {
    state.root ||= await chooseRoot();
    if (
      state.root &&
      (await vscode.window.showWarningMessage(
        'Remove Comments In (Review) Git gates and restore the previous hooks?',
        { modal: true },
        'Remove',
      )) === 'Remove'
    )
      gates.uninstall(state.root);
  });
  command('commentsInReview.agent', async () => {
    const cli = path.join(__dirname, 'cli.cjs').replace(/\\/g, '/');
    const cmd = 'node "' + cli + '" agent';
    const config = {
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: cmd }] }],
        PreToolUse: [
          {
            matcher: 'Bash|PowerShell|Write|Edit|MultiEdit',
            hooks: [{ type: 'command', command: cmd }],
          },
        ],
        PostToolUse: [
          {
            matcher: 'Bash|PowerShell|Write|Edit|MultiEdit',
            hooks: [{ type: 'command', command: cmd }],
          },
        ],
      },
    };
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument({
        language: 'json',
        content: JSON.stringify(config, null, 2),
      }),
    );
  });
  command('commentsInReview.revision', async () => {
    state.root ||= await chooseRoot();
    if (!state.root) return;
    const value = await vscode.window.showInputBox({
      prompt: 'Commit ID to inspect (for an outgoing historical revision)',
      placeHolder: 'Full commit SHA',
    });
    if (!value) return;
    if (!/^[0-9a-f]{7,64}$/i.test(value))
      throw new Error('Enter a hexadecimal commit ID');
    const ref = repo
      .git(state.root, ['rev-parse', '--verify', value + '^{commit}'])
      .trim();
    const s = store.load(state.root),
      tree = repo.snapshot(state.root, ref);
    const files = [
      ...new Set([...tree.keys(), ...Object.keys(s.files)]),
    ].filter((f) => repo.inScope(s, f));
    const file = await vscode.window.showQuickPick(files, {
      placeHolder: 'Select the file in this commit',
    });
    if (!file) return;
    const text = tree.has(file) ? repo.blob(state.root, tree.get(file)) : null;
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(
        uri(
          file + ' at ' + ref.slice(0, 12),
          text ?? '(File absent in this revision)',
        ),
      ),
    );
    if (
      (await vscode.window.showWarningMessage(
        'Approve the entire displayed file in this exact commit?',
        {
          modal: true,
          detail:
            'Read its comments, documentation, and supporting code first. This does not approve another revision.',
        },
        'Approve revision',
      )) === 'Approve revision'
    ) {
      await review.approveRevision(state.root, ref, file, review.digest(text));
      await refresh();
    }
  });
}
module.exports = { registerCommentsInReviewCommands };
