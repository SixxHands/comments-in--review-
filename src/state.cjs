// SPDX-License-Identifier: BUSL-1.1
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { git } = require('./repository.cjs');
const compatibility = require('./compatibility.cjs');
const DIR = compatibility.directoryName;
const branches = require('./branch-state.cjs');
function readRaw(root, id) {
  compatibility.migrateCommentsInReviewDirectory(root);
  const p = path.join(root, DIR, 'state.json');
  if (!fs.existsSync(p))
    throw new Error(
      'Comments In (Review) state is missing. Open the review panel; do not bypass the hook.',
    );
  return branches.decode(
    JSON.parse(fs.readFileSync(p, 'utf8')),
    branches.identity(root),
  );
}
function load(root, branchRef) {
  const id = branches.identity(root, branchRef);
  const raw = readRaw(root, id);
  const selected = branches.select(root, raw, id);
  selected.linkedRoots = raw.links;
  return branches.decorate(root, raw, id, selected);
}
function mutate(root, fn, linksOverride) {
  compatibility.migrateCommentsInReviewDirectory(root);
  const dir = path.join(root, DIR);
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink())
    throw new Error('Review directory must not be a symlink');
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'write.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch {
    throw new Error(
      'Another review is writing state. Retry; inspect a stale write.lock after a crash.',
    );
  }
  try {
    const p = path.join(dir, 'state.json');
    const id = branches.identity(root);
    const raw = fs.existsSync(p) ? readRaw(root, id) : branches.blank();
    if (linksOverride) raw.links = linksOverride;
    const s = branches.select(root, raw, id);
    const result = fn(s);
    if (branches.identity(root).key !== id.key)
      throw new Error('Branch changed while saving review state; retry');
    if (s.markdown) require('./markdown.cjs').validate(s.markdown);
    raw.contexts[id.key] = s;
    raw.lastKey = id.key;
    if (s.requestedLinks) {
      raw.links = s.requestedLinks;
      delete s.requestedLinks;
    }
    if (
      fs.existsSync(p) &&
      JSON.parse(fs.readFileSync(p, 'utf8')).version === 1
    ) {
      const backup = path.join(dir, 'state.v1-backup.json');
      if (!fs.existsSync(backup))
        fs.copyFileSync(p, backup, fs.constants.COPYFILE_EXCL);
    }
    const tmp = path.join(dir, `state.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n');
    fs.renameSync(tmp, p);
    return result;
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
function initialize(root, scope) {
  mutate(root, (s) => {
    if (!s.scopes.includes(scope)) s.scopes.push(scope);
    if (!('baseline' in s)) {
      try {
        s.baseline = git(root, ['rev-parse', 'HEAD']).trim();
      } catch {
        s.baseline = null;
      }
    }
  });
  const p = git(root, ['rev-parse', '--git-path', 'info/exclude']).trim();
  const target = path.resolve(root, p);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (!prev.split(/\r?\n/).includes('/.comments-in-review/'))
    fs.appendFileSync(
      target,
      '\n# Local Comments In (Review) approvals\n/.comments-in-review/\n',
    );
}
function ensureContext(root) {
  compatibility.migrateCommentsInReviewDirectory(root);
  const id = branches.identity(root);
  const legacy =
    JSON.parse(fs.readFileSync(path.join(root, DIR, 'state.json'), 'utf8'))
      .version === 1;
  if (legacy || !readRaw(root, id).contexts[id.key]) mutate(root, () => {});
}
function linkedRoots(root) {
  const id = branches.identity(root);
  return readRaw(root, id).links;
}
function setLinks(root, links) {
  mutate(
    root,
    (s) => {
      const present = new Set(require('./repository.cjs').tracked(root));
      for (const linked of links) {
        const peer = readRaw(linked, branches.identity(linked));
        for (const c of Object.values(peer.contexts))
          for (const [file, entry] of Object.entries(c.files)) {
            if (present.has(file) && entry.approvals?.length && !s.files[file])
              s.files[file] = {
                approvals: [],
                receipts: [],
                snapshotText: entry.snapshotText,
                inheritedCount: Math.max(
                  0,
                  ...(entry.approvals || []).map((a) => a.index + 1),
                ),
                requireReview: true,
              };
          }
      }
    },
    links,
  );
}
module.exports = {
  load,
  mutate,
  initialize,
  ensureContext,
  linkedRoots,
  setLinks,
  DIR,
};
