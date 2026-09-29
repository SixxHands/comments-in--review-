// SPDX-License-Identifier: BUSL-1.1

// For users that have agents in their enviroment so they dont write trash
// such as "Todo: <whatever>" or "LIFT DONT USE" or random legal jargon in 
// your own repo because you have a license file in it. OR for the special
// fun case that the agent writes a monolithic comment on why the code exists.
// Kinda like this but less annoyed and more like "WHY THIS EXITS:" like @%$# please.

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const repo = require('./repository.cjs');
const review = require('./comments-in-review.cjs');
const store = require('./state.cjs');
function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}
function context(event, text) {
  return {
    hookSpecificOutput: { hookEventName: event, additionalContext: text },
  };
}
async function handle(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return null;
  const event = payload.hook_event_name || 'PreToolUse';
  const input =
    payload.tool_input && typeof payload.tool_input === 'object'
      ? payload.tool_input
      : {};
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  let root;
  try {
    root = repo.rootAt(cwd);
  } catch {
    return null;
  }
  if (!require('./compatibility.cjs').hasCommentsInReviewDirectory(root))
    return null;
  let state;
  try {
    state = store.load(root);
  } catch (e) {
    if (event === 'PreToolUse') return deny(e.message);
    return context(event, e.message);
  }
  if (!state.enforce) return null;
  if (event === 'SessionStart')
    return context(
      event,
      'Comments In (Review) is active. Preserve approved comments, Javadoc, docstrings and other documentation. Change them only when supporting code requires it, explain the reason, and request human review. Selected Markdown files require explicit human approval of the entire file, including wording changes. Never approve your own changes, edit the review policy, or bypass the Git hooks.',
    );
  const file =
    input.file_path || input.filePath || input.path || input.target_file;
  if (
    event === 'PreToolUse' &&
    typeof file === 'string' &&
    ['Write', 'Edit', 'MultiEdit', 'write', 'edit', 'apply_patch'].includes(
      payload.tool_name,
    )
  ) {
    const absolute = path.resolve(cwd, file);
    if (
      absolute === path.join(root, '.comments-in-review') ||
      absolute.startsWith(path.join(root, '.comments-in-review') + path.sep)
    )
      return deny(
        'Approval records belong to the human reviewer. Do not modify .comments-in-review.',
      );
  }
  const command = typeof input.command === 'string' ? input.command : '';
  if (
    event === 'PreToolUse' &&
    ['Bash', 'PowerShell', 'bash', 'shell', 'exec_command'].includes(
      payload.tool_name,
    )
  ) {
    if (
      /--no-verify|core\.hooksPath|GIT_CONFIG|\.comments-in-review[\\/].*(state\.json|write\.lock)/i.test(
        command,
      ) ||
      /\bgit(?:\.exe)?\b[^\n;]*\bcommit\s+-(?:[a-z]*n[a-z]*)\b/i.test(command)
    )
      return deny(
        'Do not bypass comment review or rewrite its approval records. Ask the human to review or repair the setup.',
      );
    if (
      /\bgit(?:\.exe)?["']?\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s+)*(commit|push|merge|rebase|cherry-pick|am)\b/i.test(
        command,
      )
    ) {
      try {
        const results = await review.scan(root);
        const pending = results.filter(
          (r) =>
            r.protectedPending ||
            (r.error &&
              (state.files[r.file]?.approvals?.length ||
                state.files[r.file]?.requireReview ||
                require('./markdown.cjs').protects(state, r.file))),
        );
        const staged = await review.checkSnapshot(root, null);
        if (pending.length || staged.length)
          return deny(
            `Human comment review is pending: ${[...pending.map((r) => r.file), ...staged].slice(0, 8).join('; ')}. Continue code fixes or ask for review; do not approve these yourself.`,
          );
      } catch (e) {
        return deny(`Comment review could not verify the change: ${e.message}`);
      }
    }
  }
  if (event === 'PostToolUse') {
    try {
      const results = await review.scan(root);
      const pending = results.filter(
        (r) =>
          r.protectedPending ||
          (r.error &&
            (state.files[r.file]?.approvals?.length ||
              state.files[r.file]?.requireReview ||
              require('./markdown.cjs').protects(state, r.file))),
      );
      if (pending.length)
        return context(
          event,
          `Comment review required: ${pending
            .slice(0, 8)
            .map((r) => r.file + (r.error ? ': ' + r.error : ''))
            .join(
              '; ',
            )}. An approved comment or its source code changed, or new documentation needs review. Preserve the author's wording unless supporting code requires a correction. Explain any correction and ask the human to review it in VS Code before committing or pushing.`,
        );
    } catch (e) {
      return context(
        event,
        `Comment review check failed: ${e.message}. Repair the setup before publication.`,
      );
    }
  }
  return null;
}
module.exports = { handle, deny };
