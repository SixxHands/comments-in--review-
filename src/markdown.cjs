// SPDX-License-Identifier: BUSL-1.1
'use strict';
const isMarkdown = (file) => /\.(md|markdown|mdx)$/i.test(file);
function policy(state) {
  return (
    state.markdown || {
      mode: 'selected',
      files: Object.keys(state.files || {}).filter(
        (f) => isMarkdown(f) && state.files[f].approvals?.length,
      ),
      exceptions: [],
    }
  );
}
function protects(state, file) {
  if (!isMarkdown(file)) return false;
  const p = policy(state);
  return p.mode === 'all'
    ? !p.exceptions.includes(file)
    : p.files.includes(file);
}
function validate(p) {
  if (
    !p ||
    !['selected', 'all'].includes(p.mode) ||
    !Array.isArray(p.files) ||
    !Array.isArray(p.exceptions) ||
    [...p.files, ...p.exceptions].some(
      (f) =>
        typeof f !== 'string' ||
        !isMarkdown(f) ||
        f.startsWith('/') ||
        /^[a-z]:/i.test(f) ||
        f.includes('\\') ||
        f.includes('\0') ||
        f.split('/').some((x) => x === '..' || x === '.' || !x),
    )
  ) {
    throw new Error('Invalid Markdown review policy');
  }
}
module.exports = { isMarkdown, policy, protects, validate };
