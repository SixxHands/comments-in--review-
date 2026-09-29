// SPDX-License-Identifier: BUSL-1.1
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
function git(root, args, options = {}) {
  const r = cp.spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (r.error || r.status !== 0)
    throw new Error(
      `git ${args[0]}: ${r.error?.message || r.stderr?.trim() || 'failed'}`,
    );
  return r.stdout;
}
function rootAt(dir) {
  return git(dir, ['rev-parse', '--show-toplevel']).trim();
}
function safePath(root, rel) {
  if (
    typeof rel !== 'string' ||
    !rel ||
    rel.includes('\0') ||
    rel.includes('\\') ||
    path.posix.isAbsolute(rel) ||
    rel.split('/').includes('..')
  )
    throw new Error('Invalid repository-relative path');
  const p = path.resolve(root, rel);
  if (!p.startsWith(path.resolve(root) + path.sep))
    throw new Error('Path escapes repository');
  return p;
}
function readWorktree(root, rel) {
  const p = safePath(root, rel);
  if (!fs.existsSync(p)) return null;
  const stat = fs.lstatSync(p);
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`${rel}: symlinks and nonregular files cannot be reviewed`);
  const real = fs.realpathSync(p);
  if (!real.startsWith(fs.realpathSync(root) + path.sep))
    throw new Error(`${rel}: path escapes repository`);
  return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(p));
}
function tracked(root) {
  return git(root, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ])
    .split('\0')
    .filter(Boolean);
}
function inScope(state, file) {
  const markdown = require('./markdown.cjs');
  if (
    file.startsWith('.comments-in-review/') ||
    file.startsWith('.comment-review/')
  )
    return false;
  if (markdown.isMarkdown(file)) return markdown.protects(state, file);
  return (
    !file.startsWith('.comments-in-review/') &&
    !(state.excludes || []).some(
      (s) => file === s || file.startsWith(s + '/'),
    ) &&
    state.scopes.some(
      (s) => s === '.' || file === s || file.startsWith(s + '/'),
    )
  );
}
function snapshot(root, ref) {
  const result = new Map();
  const args =
    ref === null ? ['ls-files', '--stage', '-z'] : ['ls-tree', '-r', '-z', ref];
  for (const row of git(root, args).split('\0').filter(Boolean)) {
    const sep = row.indexOf('\t');
    const meta = row.slice(0, sep).split(' '),
      file = row.slice(sep + 1);
    const mode = meta[0],
      oid = ref === null ? meta[1] : meta[2];
    if (ref === null && meta[2] !== '0')
      throw new Error('Resolve merge conflicts before comment review');
    result.set(file, { oid, mode });
  }
  return result;
}
function blob(root, entry) {
  if (!/^100(644|755)$/.test(entry.mode))
    throw new Error('Symlink/submodule requires a scope exclusion');
  return new TextDecoder('utf-8', { fatal: true }).decode(
    git(root, ['cat-file', 'blob', entry.oid], { encoding: 'buffer' }),
  );
}
module.exports = {
  git,
  rootAt,
  safePath,
  readWorktree,
  tracked,
  inScope,
  snapshot,
  blob,
};
