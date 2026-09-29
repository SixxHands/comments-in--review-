#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const repo = require('./repository.cjs');
const gates = require('./gates.cjs');
(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'agent') {
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(0, 'utf8'));
    } catch {
      process.stderr.write(
        'Comments In (Review): malformed hook input; no decision was made.\n',
      );
      return;
    }
    const result = await require('./agent.cjs').handle(payload);
    if (result) console.log(JSON.stringify(result));
    return;
  }
  const root = repo.rootAt(process.cwd());
  if (cmd === 'check') {
    const errors = await require('./comments-in-review.cjs').checkSnapshot(
      root,
      args[0] || null,
    );
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    }
    return;
  }
  if (cmd === 'hook') {
    const hook = path.resolve(args.shift());
    const input =
      path.basename(hook) === 'pre-push' ? fs.readFileSync(0, 'utf8') : '';
    const errors = await gates.run(root, path.basename(hook), input);
    if (errors.length) {
      console.error(
        'Comments In (Review) blocked publication:\n' +
          errors.slice(0, 40).join('\n') +
          '\nOpen Comments In (Review) in VS Code and approve the exact content.',
      );
      process.exitCode = 1;
      return;
    }
    process.exitCode = gates.previous(hook, args, input);
    return;
  }
  throw new Error(
    'Usage: node cli.cjs check [commit] | hook <hook-path> [args] | agent',
  );
})().catch((e) => {
  console.error('Comments In (Review): ' + e.message);
  process.exitCode = 1;
});
