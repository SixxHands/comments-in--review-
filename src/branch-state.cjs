// SPDX-License-Identifier: BUSL-1.1
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { git, tracked } = require('./repository.cjs');
const { hash } = require('./parser.cjs');
function identity(root, branchRef) {
  let origin = '';
  try {
    origin = git(root, ['remote', 'get-url', 'origin']).trim();
  } catch {}
  let ref = branchRef;
  if (!ref) {
    try {
      ref = git(root, ['symbolic-ref', '-q', 'HEAD']).trim();
    } catch {
      ref = 'detached:' + git(root, ['rev-parse', 'HEAD']).trim();
    }
  }
  return {
    key: hash(origin + '\0' + ref),
    label: ref.replace(/^refs\/heads\//, ''),
    origin,
    ref,
  };
}
function blank() {
  return { version: 2, contexts: {}, links: [], lastKey: null };
}
function validateContext(s) {
  if (
    !s ||
    !Array.isArray(s.scopes) ||
    !s.files ||
    typeof s.files !== 'object' ||
    Array.isArray(s.files)
  )
    throw new Error('Comments In (Review) state is invalid');
  if (s.markdown) require('./markdown.cjs').validate(s.markdown);
}
function decode(raw, id) {
  if (raw.version === 1) {
    validateContext(raw);
    return {
      version: 2,
      contexts: { [id.key]: { ...raw, label: id.label, origin: id.origin } },
      links: [],
      lastKey: id.key,
    };
  }
  if (
    raw.version !== 2 ||
    !raw.contexts ||
    typeof raw.contexts !== 'object' ||
    Array.isArray(raw.contexts) ||
    !Array.isArray(raw.links)
  )
    throw new Error('Comments In (Review) state is invalid');
  for (const c of Object.values(raw.contexts)) validateContext(c);
  if (raw.links.some((p) => typeof p !== 'string' || !path.isAbsolute(p)))
    throw new Error('Invalid linked approval source');
  return raw;
}
function pools(root, raw) {
  const list = Object.values(raw.contexts).map((c) => ({
    ...c,
    source: c.label,
  }));
  // repositories cannot recursively add other repositories.
  for (const linked of raw.links) {
    const file = path.join(
      require('./compatibility.cjs').migrateCommentsInReviewDirectory(linked),
      'state.json',
    );
    try {
      const peer = decode(
        JSON.parse(fs.readFileSync(file, 'utf8')),
        identity(linked),
      );
      for (const c of Object.values(peer.contexts))
        list.push({ ...c, source: path.basename(linked) + ':' + c.label });
    } catch (e) {
      throw new Error(
        `Linked review records unavailable at ${linked}: ${e.message}. Restore the source or unlink it in Comments In (Review).`,
      );
    }
  }
  return list;
}
function select(root, raw, id) {
  if (raw.contexts[id.key]) return structuredClone(raw.contexts[id.key]);
  let previous = raw.contexts[raw.lastKey] || Object.values(raw.contexts)[0];
  let best = Infinity;
  for (const c of Object.values(raw.contexts)) {
    if (c.origin !== id.origin) continue;
    try {
      const tip = git(root, [
        'rev-parse',
        '--verify',
        'refs/heads/' + c.label,
      ]).trim();
      git(root, ['merge-base', '--is-ancestor', tip, id.ref]);
      const distance = Number(
        git(root, ['rev-list', '--count', tip + '..' + id.ref]).trim(),
      );
      if (distance < best) {
        previous = c;
        best = distance;
      }
    } catch {
      /* Detached or unrelated histories retain the last local template. */
    }
  }
  const s = previous
    ? structuredClone(previous)
    : { version: 1, scopes: [], files: {} };
  let names = [];
  try {
    names = git(root, [
      'ls-tree',
      '-r',
      '--name-only',
      '-z',
      id.ref.replace(/^detached:/, ''),
    ])
      .split('\0')
      .filter(Boolean);
  } catch {}
  if (identity(root).key === id.key) names.push(...tracked(root));
  const files = new Set(names);
  s.files = {};
  // A new branch inherits protection only for its own tree.
  for (const c of pools(root, raw))
    for (const [file, entry] of Object.entries(c.files)) {
      if (files.has(file) && (entry.approvals?.length || entry.requireReview))
        s.files[file] = {
          approvals: [],
          receipts: [],
          snapshotText: entry.snapshotText,
          requireReview: true,
        };
    }
  for (const [file, entry] of Object.entries(s.files)) {
    const baseline = previous?.files[file];
    if (baseline) {
      const receipt = (baseline.receipts || [])
        .filter((d) => d !== 'deleted')
        .at(-1);
      entry.inheritedCount =
        baseline.inheritedCount ||
        Math.max(
          0,
          ...(baseline.approvals || [])
            .filter((a) => !receipt || a.sourceDigest === receipt)
            .map((a) => a.index + 1),
        );
    }
  }
  if (s.markdown?.mode === 'selected')
    s.markdown.files = s.markdown.files.filter((f) => files.has(f));
  s.label = id.label;
  s.origin = id.origin;
  return s;
}
function decorate(root, raw, id, selected) {
  selected.contextKey = id.key;
  selected.contextLabel = id.label;
  selected.sharedVersions = {};
  selected.sharedComments = {};
  for (const c of pools(root, raw))
    for (const [file, entry] of Object.entries(c.files)) {
      (selected.sharedComments[file] ||= []).push(
        ...(entry.approvals || []).map((a) => ({ ...a, source: c.source })),
      );
      for (const digest of entry.receipts || []) {
        // Deletion approval never crosses branches only approved content does.
        if (digest === 'deleted') continue;
        (selected.sharedVersions[file] ||= {})[digest] = {
          source: c.source,
          entry: {
            ...entry,
            approvals: (entry.approvals || []).filter(
              (a) => a.sourceDigest === digest,
            ),
            receipts: [digest],
          },
        };
      }
    }
  return selected;
}
module.exports = { identity, blank, decode, select, decorate };
