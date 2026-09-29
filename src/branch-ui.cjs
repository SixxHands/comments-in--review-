// SPDX-License-Identifier: BUSL-1.1
'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const repo = require('./repository.cjs');
const store = require('./state.cjs');
function registerCommentsInReviewBranchCommands({
  state,
  command,
  chooseRoot,
  refresh,
}) {
  command('commentsInReview.linkApprovals', async () => {
    state.root ||= await chooseRoot();
    if (!state.root) return;
    if (
      !require('./compatibility.cjs').hasCommentsInReviewDirectory(state.root)
    )
      store.initialize(state.root, '.');
    const choice = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title:
        'Select a trusted local clone, fork or worktree with approval records',
    });
    if (!choice?.length) return;
    const linked = repo.rootAt(choice[0].fsPath);
    if (fs.realpathSync(linked) === fs.realpathSync(state.root))
      throw new Error(
        'This checkout already shares approvals across its branches',
      );
    store.load(linked);
    const commits = new Set(
      repo
        .git(state.root, ['rev-list', '--all', '--max-count=10000'])
        .trim()
        .split('\n')
        .filter(Boolean),
    );
    if (
      !repo
        .git(linked, ['rev-list', '--all', '--max-count=10000'])
        .trim()
        .split('\n')
        .some((c) => commits.has(c))
    )
      throw new Error(
        'No common commit found in the latest 10,000 commits. Approval sources must have related Git history.',
      );
    if (
      (await vscode.window.showWarningMessage(
        'Reuse approved versions from this local checkout?',
        {
          modal: true,
          detail:
            linked +
            '\nReuse requires the same path, comment text, position anchor and supporting code. Protected Markdown requires an exact approved file. This trusts its local approval records. Policies, deleted-file approvals, and branch-only files are not imported.',
        },
        'Link approvals',
      )) !== 'Link approvals'
    )
      return;
    store.setLinks(state.root, [
      ...new Set([...store.linkedRoots(state.root), linked]),
    ]);
    await refresh();
  });
  command('commentsInReview.unlinkApprovals', async () => {
    state.root ||= await chooseRoot();
    if (!state.root) return;
    const selected = await vscode.window.showQuickPick(
      store.linkedRoots(state.root),
      { canPickMany: true, placeHolder: 'Select approval sources to unlink' },
    );
    if (!selected?.length) return;
    if (
      (await vscode.window.showWarningMessage(
        'Stop reusing approvals from the selected checkouts?',
        { modal: true },
        'Unlink',
      )) !== 'Unlink'
    )
      return;
    store.setLinks(
      state.root,
      store.linkedRoots(state.root).filter((r) => !selected.includes(r)),
    );
    await refresh();
  });
}
module.exports = { registerCommentsInReviewBranchCommands };
