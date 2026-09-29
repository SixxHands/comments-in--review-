// SPDX-License-Identifier: BUSL-1.1
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const directoryName = '.comments-in-review';
const legacyDirectoryName = '.comment-review';
function migrateCommentsInReviewDirectory(root) {
  const current = path.join(root, directoryName);
  const legacy = path.join(root, legacyDirectoryName);
  if (!fs.existsSync(current) && fs.existsSync(legacy)) {
    if (
      !fs.lstatSync(legacy).isDirectory() ||
      fs.lstatSync(legacy).isSymbolicLink()
    )
      throw new Error('Legacy review directory must be a regular directory');
    const repo = require('./repository.cjs');
    const exclude = path.resolve(
      root,
      repo.git(root, ['rev-parse', '--git-path', 'info/exclude']).trim(),
    );
    fs.mkdirSync(path.dirname(exclude), { recursive: true });
    const text = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (!text.split(/\r?\n/).includes('/' + directoryName + '/'))
      fs.appendFileSync(exclude, '\n/' + directoryName + '/\n');
    fs.renameSync(legacy, current);
  }
  return current;
}
function hasCommentsInReviewDirectory(root) {
  return [directoryName, legacyDirectoryName].some((name) =>
    fs.existsSync(path.join(root, name)),
  );
}
function commentsInReviewConfiguration(vscode) {
  const current = vscode.workspace.getConfiguration('commentsInReview');
  const legacy = vscode.workspace.getConfiguration('commentReview');
  return {
    get(key, fallback) {
      const defined = current.inspect?.(key);
      if (
        defined &&
        [
          defined.workspaceFolderValue,
          defined.workspaceValue,
          defined.globalValue,
        ].some((value) => value !== undefined)
      )
        return current.get(key, fallback);
      return legacy.get(key, current.get(key, fallback));
    },
  };
}
module.exports = {
  directoryName,
  migrateCommentsInReviewDirectory,
  hasCommentsInReviewDirectory,
  commentsInReviewConfiguration,
};
