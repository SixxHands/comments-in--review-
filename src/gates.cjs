// SPDX-License-Identifier: BUSL-1.1
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const repo = require('./repository.cjs');
const store = require('./state.cjs');
const review = require('./comments-in-review.cjs');
const marker = '# COMMENTS IN REVIEW v1';
const legacyMarker = '# COMMENT REVIEW v1';
const isCommentsInReviewHook = (text) =>
  text.includes(marker) || text.includes(legacyMarker);
function commentsInReviewBackup(hook) {
  const current = hook + '.before-comments-in-review';
  const legacy = hook + '.before-comment-review';
  return fs.existsSync(current)
    ? current
    : fs.existsSync(legacy)
      ? legacy
      : current;
}
function quote(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
function hookDir(root) {
  const custom = cp.spawnSync(
    'git',
    ['-C', root, 'config', '--get', 'core.hooksPath'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (custom.status === 0 && custom.stdout.trim())
    throw new Error(
      'Existing core.hooksPath detected. Integrate the documented gate command into that hook manager; its configuration was not changed.',
    );
  return path.resolve(
    root,
    repo.git(root, ['rev-parse', '--git-path', 'hooks']).trim(),
  );
}
function install(root) {
  store.load(root);
  const dir = hookDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const cli = path.join(__dirname, 'cli.cjs').replace(/\\/g, '/');
  for (const name of [
    'pre-commit',
    'pre-push',
    'pre-merge-commit',
    'pre-applypatch',
  ]) {
    const p = path.join(dir, name),
      backup = commentsInReviewBackup(p);
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, 'utf8');
      if (!isCommentsInReviewHook(text)) {
        if (fs.existsSync(backup))
          throw new Error(`Backup already exists: ${backup}`);
        fs.renameSync(p, backup);
      }
    }
    fs.writeFileSync(
      p,
      `#!/bin/sh\n${marker}\nexec node ${quote(cli)} hook "$0" "$@"\n`,
      { mode: 0o755 },
    );
    fs.chmodSync(p, 0o755);
  }
  store.mutate(root, (s) => {
    s.enforce = true;
  });
  return dir;
}
function uninstall(root) {
  const dir = hookDir(root);
  for (const name of [
    'pre-commit',
    'pre-push',
    'pre-merge-commit',
    'pre-applypatch',
  ]) {
    const p = path.join(dir, name),
      backup = commentsInReviewBackup(p);
    if (!fs.existsSync(p)) continue;
    if (!isCommentsInReviewHook(fs.readFileSync(p, 'utf8')))
      throw new Error(
        `${name} changed after installation; inspect it before removing`,
      );
    fs.unlinkSync(p);
    if (fs.existsSync(backup)) fs.renameSync(backup, p);
  }
  store.mutate(root, (s) => {
    s.enforce = false;
  });
}
async function push(root, input) {
  const errors = [];
  const seen = new Set();
  for (const line of input.trim().split('\n').filter(Boolean)) {
    const [localRef, local, remoteRef, remote] = line.trim().split(/\s+/);
    if (
      !/^[0-9a-f]{40,64}$/.test(local || '') ||
      !/^[0-9a-f]{40,64}$/.test(remote || '')
    )
      throw new Error('Malformed pre-push input');
    if (/^0+$/.test(local)) continue;
    const branchRef = localRef.startsWith('refs/heads/') ? localRef : undefined;
    if (
      branchRef &&
      repo.git(root, ['rev-parse', '--verify', branchRef]).trim() !== local
    )
      throw new Error('Source branch changed during push; retry');
    const state = store.load(root, branchRef);
    let commit;
    try {
      commit = repo
        .git(root, ['rev-parse', '--verify', `${local}^{commit}`])
        .trim();
    } catch {
      throw new Error(
        `${localRef}: non-commit objects require separate publication review`,
      );
    }
    const args = ['rev-list', commit];
    if (!/^0+$/.test(remote)) {
      try {
        repo.git(root, ['cat-file', '-e', `${remote}^{commit}`]);
        args.push('^' + remote);
      } catch {
        // Unknown remote history is checked locally in full.
      }
    }
    if (state.baseline) args.push('^' + state.baseline);
    const revisions = [
      commit,
      ...repo.git(root, args).trim().split('\n').filter(Boolean),
    ];
    for (const ref of revisions) {
      const seenKey = (branchRef || 'current') + ':' + ref;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      for (const error of await review.checkSnapshot(root, ref, branchRef))
        errors.push(`${ref.slice(0, 12)} ${error}`);
    }
  }
  return errors;
}
async function run(root, event, input = '') {
  if (event === 'pre-push') return push(root, input);
  if (['pre-commit', 'pre-merge-commit', 'pre-applypatch'].includes(event))
    return review.checkSnapshot(root, null);
  throw new Error('Unknown Git hook');
}
function previous(hook, args, input) {
  const backup = commentsInReviewBackup(hook);
  if (!fs.existsSync(backup)) return 0;
  const r = cp.spawnSync(
    'sh',
    ['-c', 'exec "$@"', 'comments-in-review', backup, ...args],
    { input, encoding: 'utf8', windowsHide: true },
  );
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) throw r.error;
  return r.status ?? 1;
}
module.exports = { install, uninstall, run, previous, push, marker };
