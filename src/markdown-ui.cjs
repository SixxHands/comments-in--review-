// SPDX-License-Identifier: BUSL-1.1
'use strict';
const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');
const repo = require('./repository.cjs');
const store = require('./state.cjs');
const markdown = require('./markdown.cjs');
function registerCommentsInReviewMarkdownCommands({
  state,
  command,
  chooseRoot,
  refresh,
}) {
  const ensure = () => {
    if (
      !require('./compatibility.cjs').hasCommentsInReviewDirectory(state.root)
    )
      store.initialize(state.root, '.');
  };
  command('commentsInReview.protectMarkdown', async (uri) => {
    uri ||= vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file')
      throw new Error('Select a local Markdown file');
    const root = repo.rootAt(path.dirname(uri.fsPath));
    const file = path.relative(root, uri.fsPath).replace(/\\/g, '/');
    repo.safePath(root, file);
    const branchKey = require('./branch-state.cjs').identity(root).key;
    if (!markdown.isMarkdown(file))
      throw new Error('Select an .md, .markdown, or .mdx file');
    if (
      (await vscode.window.showWarningMessage(
        `Require human review for ${file}?`,
        {
          modal: true,
          detail:
            'This adds whole-file protection. It does not approve the current contents. Git gates must be installed to enforce approval before commit or push.',
        },
        'Protect file',
      )) !== 'Protect file'
    )
      return;
    if (require('./branch-state.cjs').identity(root).key !== branchKey)
      throw new Error('Branch changed; configure protection again');
    state.root = root;
    ensure();
    store.mutate(root, (s) => {
      const p = markdown.policy(s);
      s.markdown = {
        ...p,
        files: [...new Set([...p.files, file])],
        exceptions: p.exceptions.filter((f) => f !== file),
      };
    });
    await refresh();
  });
  command('commentsInReview.configureMarkdown', async () => {
    state.root = await chooseRoot();
    if (!state.root) return;
    ensure();
    const branchKey = store.load(state.root).contextKey;
    const before = markdown.policy(store.load(state.root));
    const mode = await vscode.window.showQuickPick(
      [
        { label: 'Protect selected Markdown files', value: 'selected' },
        {
          label: 'Protect all Markdown except selected exceptions',
          value: 'all',
        },
      ],
      {
        placeHolder:
          'Current branch Markdown review policy (current: ' +
          before.mode +
          ')',
      },
    );
    if (!mode) return;
    const current = mode.value === 'all' ? before.exceptions : before.files;
    const files = [
      ...new Set([
        ...repo.tracked(state.root).filter(markdown.isMarkdown),
        ...before.files,
        ...before.exceptions,
      ]),
    ].sort();
    const picked = await vscode.window.showQuickPick(
      files.map((file) => ({ label: file, picked: current.includes(file) })),
      {
        canPickMany: true,
        placeHolder:
          mode.value === 'all'
            ? 'Select exact files that may change without Markdown approval'
            : 'Select exact files requiring whole-file approval',
      },
    );
    if (!picked) return;
    const selection = picked.map((p) => p.label);
    if (
      (await vscode.window.showWarningMessage(
        'Apply this branch Markdown policy?',
        {
          modal: true,
          detail:
            (mode.value === 'all'
              ? 'All Git-visible Markdown requires approval, except:\n'
              : 'Only these Markdown files require approval:\n') +
            (selection.join('\n') || '(none)') +
            '\n\nThis changes protection, not approval. Existing approval records are retained.',
        },
        'Apply policy',
      )) !== 'Apply policy'
    )
      return;
    if (store.load(state.root).contextKey !== branchKey)
      throw new Error('Branch changed; configure protection again');
    store.mutate(state.root, (s) => {
      const p = markdown.policy(s);
      s.markdown = {
        ...p,
        mode: mode.value,
        [mode.value === 'all' ? 'exceptions' : 'files']: selection,
      };
    });
    await refresh();
  });
}
module.exports = { registerCommentsInReviewMarkdownCommands };
