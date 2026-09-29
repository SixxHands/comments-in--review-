// SPDX-License-Identifier: BUSL-1.1
'use strict';
const { extract, hash } = require('./parser.cjs');
const store = require('./state.cjs');
const markdown = require('./markdown.cjs');
const repo = require('./repository.cjs');
const digest = (text) => (text === null ? 'deleted' : hash(text));
async function parseFor(state, file, text) {
  if (!markdown.protects(state, file)) return extract(file, text);
  if (Buffer.byteLength(text, 'utf8') > 4 * 1024 * 1024 || text.includes('\0'))
    throw new Error('Markdown is binary or larger than 4 MiB; cannot review');
  return {
    mode: 'whole-file',
    codeHash: hash(text),
    items: [
      {
        index: 0,
        kind: 'protected Markdown',
        text,
        start: 0,
        end: text.length,
        line: 0,
        endLine: text.split('\n').length - 1,
        anchorHash: hash(file),
      },
    ],
  };
}
async function inspect(state, file, text) {
  const local = state.files[file] || { approvals: [], receipts: [] };
  const shared =
    text === null ? null : state.sharedVersions?.[file]?.[digest(text)];
  const saved = shared
    ? { ...shared.entry, requireReview: local.requireReview }
    : local;
  const required = markdown.protects(state, file) || !!local.requireReview;
  if (text === null)
    return {
      file,
      text,
      items: [],
      removed: required || saved.approvals.length ? ['File removed'] : [],
      protectedPending:
        !saved.receipts.includes('deleted') &&
        (required || !!saved.approvals.length),
      approved:
        saved.receipts.includes('deleted') ||
        (!required && !saved.approvals.length),
    };
  const parsed = await parseFor(state, file, text);
  const items = parsed.items.map((item) => {
    const match = [
      ...saved.approvals,
      ...(state.sharedComments?.[file] || []),
    ].find(
      (a) =>
        a.index === item.index &&
        a.textHash === hash(item.text) &&
        a.anchorHash === item.anchorHash &&
        a.codeHash === parsed.codeHash,
    );
    const old = [...saved.approvals]
      .reverse()
      .find((a) => a.index === item.index);
    return {
      ...item,
      approved: markdown.protects(state, file)
        ? saved.receipts.includes(digest(text))
        : !!match,
      previous: old?.text,
      previousSourceDigest: old?.sourceDigest,
      codeChanged: !!old && old.codeHash !== parsed.codeHash,
      reason: markdown.protects(state, file)
        ? saved.receipts.includes(digest(text))
          ? 'Approved'
          : old
            ? 'Markdown changed'
            : 'Markdown approval required'
        : match
          ? 'Approved'
          : !old
            ? local.requireReview
              ? 'Branch version needs review'
              : 'New comment'
            : old.textHash !== hash(item.text) &&
                old.codeHash !== parsed.codeHash
              ? 'Comment and supporting code changed'
              : old.textHash !== hash(item.text)
                ? 'Comment changed'
                : old.codeHash !== parsed.codeHash
                  ? 'Supporting code changed'
                  : 'Comment moved',
      protected: required || !!old,
      approvalSource: shared?.source || match?.source,
    };
  });
  const removed =
    (local.requireReview &&
      items.length < (local.inheritedCount || 0) &&
      !saved.receipts.includes(digest(text))) ||
    saved.approvals.some((a) => a.index >= items.length)
      ? ['Previously approved comments were removed']
      : [];
  const protectedPending =
    !saved.receipts.includes(digest(text)) &&
    (markdown.protects(state, file) ||
      (local.requireReview &&
        (items.some((i) => !i.approved) || removed.length > 0)) ||
      saved.approvals.some((a) => !items[a.index]?.approved));
  return {
    file,
    text,
    ...parsed,
    items,
    removed,
    protectedPending,
    approved:
      saved.receipts.includes(digest(text)) ||
      (!markdown.protects(state, file) &&
        items.every((i) => i.approved) &&
        !removed.length),
  };
}
async function scan(root) {
  const s = store.load(root);
  const files = new Set([
    ...repo.tracked(root),
    ...Object.keys(s.files),
    ...markdown.policy(s).files,
  ]);
  const results = [];
  for (const file of files) {
    if (!repo.inScope(s, file)) continue;
    try {
      results.push({
        ...(await inspect(s, file, repo.readWorktree(root, file))),
        contextKey: s.contextKey,
        contextLabel: s.contextLabel,
      });
    } catch (e) {
      results.push({ file, error: e.message, items: [], approved: false });
    }
  }
  return results;
}
async function approve(root, file, index, expectedDigest, expectedContext) {
  const approvedContext = store.load(root).contextKey;
  if (expectedContext && approvedContext !== expectedContext)
    throw new Error('Branch changed; refresh and review again');
  const text = repo.readWorktree(root, file);
  if (digest(text) !== expectedDigest)
    throw new Error(
      'File changed while you were reviewing. Refresh and inspect it again.',
    );
  const result = await inspect(store.load(root), file, text);
  if (result.error || text === null)
    throw new Error('Use removal approval for a removed file');
  const item = result.items[index];
  if (!item) throw new Error('Comment no longer exists');
  store.mutate(root, (s) => {
    if (require('./branch-state.cjs').identity(root).key !== approvedContext)
      throw new Error('Branch changed; review again');
    if (digest(repo.readWorktree(root, file)) !== expectedDigest)
      throw new Error('File changed before approval was saved');
    const entry = (s.files[file] ||= { approvals: [], receipts: [] });
    entry.snapshots ||= {};
    entry.snapshots[expectedDigest] = text;
    entry.approvals.push({
      index,
      sourceDigest: expectedDigest,
      textHash: hash(item.text),
      anchorHash: item.anchorHash,
      text: item.text,
      codeHash: result.codeHash,
      at: new Date().toISOString(),
    });
    const all = result.items.every(
      (i) =>
        i.approved ||
        entry.approvals.some(
          (a) =>
            a.index === i.index &&
            a.textHash === hash(i.text) &&
            a.anchorHash === i.anchorHash &&
            a.codeHash === result.codeHash,
        ),
    );
    if (
      all &&
      !result.removed.length &&
      !entry.receipts.includes(expectedDigest)
    )
      entry.receipts.push(expectedDigest);
    entry.snapshotText = text;
  });
}
async function approveRemoval(root, file, expectedDigest, expectedContext) {
  const approvedContext = store.load(root).contextKey;
  if (expectedContext && approvedContext !== expectedContext)
    throw new Error('Branch changed; refresh and review again');
  const text = repo.readWorktree(root, file);
  if (digest(text) !== expectedDigest)
    throw new Error('File changed; review again');
  const result = await inspect(store.load(root), file, text);
  if (result.items.some((i) => !i.approved))
    throw new Error('Approve remaining comments before acknowledging removals');
  store.mutate(root, (s) => {
    if (require('./branch-state.cjs').identity(root).key !== approvedContext)
      throw new Error('Branch changed; review again');
    if (digest(repo.readWorktree(root, file)) !== expectedDigest)
      throw new Error('File changed');
    const e = (s.files[file] ||= { approvals: [], receipts: [] });
    if (!e.receipts.includes(expectedDigest)) e.receipts.push(expectedDigest);
  });
}
async function checkSnapshot(root, ref, branchRef) {
  const s = store.load(root, branchRef),
    tree = repo.snapshot(root, ref),
    errors = [];
  let parents = [];
  try {
    parents =
      ref === null
        ? ['HEAD']
        : repo
            .git(root, ['rev-list', '--parents', '-n', '1', ref])
            .trim()
            .split(' ')
            .slice(1);
  } catch {}
  const prior = new Set();
  for (const parent of parents) {
    try {
      for (const f of repo.snapshot(root, parent).keys()) prior.add(f);
    } catch (e) {
      if (ref !== null) throw e;
    }
  }
  for (const file of new Set([...tree.keys(), ...prior])) {
    if (
      !repo.inScope(s, file) ||
      (!markdown.protects(s, file) &&
        !s.files[file]?.approvals?.length &&
        !s.files[file]?.requireReview)
    )
      continue;
    try {
      const text = tree.has(file) ? repo.blob(root, tree.get(file)) : null;
      const r = await inspect(s, file, text);
      if (r.protectedPending)
        errors.push(
          `${file}: ${r.removed.length ? 'removal or ' : ''}comment/documentation review required`,
        );
    } catch (e) {
      errors.push(`${file}: ${e.message}`);
    }
  }
  return errors;
}
module.exports = {
  inspect,
  scan,
  approve,
  approveRemoval,
  checkSnapshot,
  digest,
};
async function approveRevision(root, ref, file, expectedDigest) {
  const approvedContext = store.load(root).contextKey;
  const tree = repo.snapshot(root, ref);
  const text = tree.has(file) ? repo.blob(root, tree.get(file)) : null;
  if (digest(text) !== expectedDigest)
    throw new Error('Revision content changed');
  const parsed =
    text === null ? null : await parseFor(store.load(root), file, text);
  store.mutate(root, (s) => {
    if (require('./branch-state.cjs').identity(root).key !== approvedContext)
      throw new Error('Branch changed; review again');
    const e = (s.files[file] ||= { approvals: [], receipts: [] });
    e.snapshots ||= {};
    if (text !== null) e.snapshots[expectedDigest] = text;
    for (const i of parsed?.items || [])
      e.approvals.push({
        sourceDigest: expectedDigest,
        index: i.index,
        text: i.text,
        textHash: hash(i.text),
        anchorHash: i.anchorHash,
        codeHash: parsed.codeHash,
        at: new Date().toISOString(),
        revision: ref,
      });
    if (!e.receipts.includes(expectedDigest)) e.receipts.push(expectedDigest);
  });
}
module.exports.approveRevision = approveRevision;
