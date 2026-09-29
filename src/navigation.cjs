// SPDX-License-Identifier: BUSL-1.1
'use strict';
const path = require('node:path');

function children(results, parent, mode) {
  if (!parent)
    return results
      .filter((r) => children(results, { type: 'file', r }, mode).length)
      .map((r) => ({ type: 'file', r }));
  if (parent.type !== 'file') return [];
  const r = parent.r;
  if (r.error)
    return mode === 'pending' ? [{ type: 'error', label: r.error, r }] : [];
  return [
    ...r.items
      .filter((i) => (r.approved || i.approved) === (mode === 'approved'))
      .map((i) => ({
        type: 'comment',
        r,
        i: r.approved ? { ...i, approved: true, reason: 'Approved' } : i,
        label: `${i.line + 1}: ${i.kind} · ${i.text.replace(/\s+/g, ' ').slice(0, 80)}`,
      })),
    ...(mode === 'pending' && !r.approved
      ? (r.removed || []).map((label) => ({ type: 'removal', r, label }))
      : []),
  ];
}
function pending(results) {
  return results.flatMap((r) =>
    children(results, { type: 'file', r }, 'pending'),
  );
}
function symbolFor(item, symbols) {
  const flat = [];
  function visit(items, parent = '') {
    for (const s of items || []) {
      const range = s.range || s.location?.range;
      const name = [parent || s.containerName, s.name]
        .filter(Boolean)
        .join('.');
      if (range)
        flat.push({ name, start: range.start.line, end: range.end.line });
      visit(s.children, name);
    }
  }
  visit(symbols);
  // Mmm... yes, commit use language-service identities, it does not.
  const next = flat
    .filter((s) => s.start >= item.endLine && s.start - item.endLine <= 4)
    .sort((a, b) => a.start - b.start || b.end - a.end)[0];
  const containing = flat
    .filter((s) => s.start <= item.line && s.end >= item.endLine)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  return (next || containing)?.name;
}
async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function discover(vscode, root, results, state) {
  const cfg = require('./compatibility.cjs').commentsInReviewConfiguration(
    vscode,
  );
  const includes = cfg.get('include', ['**/*']);
  const excludes = cfg.get('exclude', [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/vendor/**',
  ]);
  const find = async (patterns) => {
    const sets = await Promise.all(
      patterns.map((p) =>
        vscode.workspace.findFiles(new vscode.RelativePattern(root, p), null),
      ),
    );
    return new Set(
      sets.flat().map((u) => path.relative(root, u.fsPath).replace(/\\/g, '/')),
    );
  };
  const [included, excluded] = await Promise.all([
    find(includes),
    find(excludes),
  ]);
  const visible = results.filter(
    (r) =>
      require('./markdown.cjs').protects(state, r.file) ||
      state.files[r.file]?.approvals?.length ||
      state.files[r.file]?.requireReview ||
      (included.has(r.file) && !excluded.has(r.file)),
  );
  if (cfg.get('symbolLabels', true)) {
    for (let n = 0; n < visible.length; n += 4) {
      await Promise.all(
        visible.slice(n, n + 4).map(async (r) => {
          if (!r.items.length || r.mode === 'whole-file') return;
          try {
            const uri = vscode.Uri.file(path.join(root, r.file));
            const doc = await vscode.workspace.openTextDocument(uri);
            if (doc.isDirty || doc.getText() !== r.text) return;
            const symbols = await withTimeout(
              vscode.commands.executeCommand(
                'vscode.executeDocumentSymbolProvider',
                uri,
              ),
              1500,
            );
            for (const i of r.items) i.symbol = symbolFor(i, symbols);
          } catch {
            // Icky language services must not prevent review.
          }
        }),
      );
    }
  }
  return visible;
}
module.exports = { children, pending, symbolFor, discover };
