#!/usr/bin/env node
const cp = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const branch = cp.execFileSync('git', ['branch', '--show-current'], {cwd: root, encoding: 'utf8'}).trim();
if (branch !== 'codex/operations-v2') {
  console.error('Wrong workspace branch: ' + (branch || 'detached HEAD') + '. Read DEVELOPMENT.md and git worktree list.');
  process.exit(1);
}
console.log('2.0 workspace OK: ' + root + ' [' + branch + ']');
