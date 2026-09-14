import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from '../lib/layout.js';

const commands = [
  ['pane', 'list', '--workspace', 'w1'],
  ['pane', 'report-metadata', 'p1', '--source', 'plugin:test', '--token', 'role=shell'],
  ['pane', 'rename', 'p1', 'Linear · shell'],
  ['pane', 'swap', '--pane', 'p2', '--direction', 'up'],
  ['pane', 'move', 'p2', '--target-pane', 'p1', '--split', 'down', '--no-focus'],
  ['pane', 'focus', '--pane', 'p2', '--direction', 'left'],
  ['tab', 'create', '--workspace', 'w1', '--cwd', '/repo with spaces', '--no-focus'],
  ['tab', 'focus', 't1'],
  ['workspace', 'get', 'w1'],
  ['workspace', 'report-metadata', 'w1', '--source', 'plugin:test', '--token', 'linear=ENG-1'],
  ['plugin', 'pane', 'open', '--plugin', 'kakahn.worktree-from-linear', '--entrypoint', 'issue', '--placement', 'split', '--target-pane', 'p1', '--direction', 'right', '--no-focus'],
  ['worktree', 'create', '--cwd', '/repo', '--branch', 'feature/test', '--base', 'HEAD', '--no-focus'],
  ['worktree', 'open', '--cwd', '/repo', '--branch', 'feature/test', '--no-focus'],
];
for (const args of commands) {
  test(`client preserves ${args.slice(0, 2).join(' ')} arguments without a global JSON flag`, () => {
    const original = [...args];
    const call = client('herdr-test', (bin, actual) => {
      assert.equal(bin, 'herdr-test');
      if (actual.includes('--json')) return { status: 2, stderr: 'unknown option: --json' };
      assert.deepEqual(actual, original);
      return { status: 0, stdout: '{"result":{"type":"fixture"}}' };
    });
    assert.deepEqual(call(args), { type: 'fixture' });
    assert.deepEqual(args, original);
  });
}
test('pane run receives the exact command with no appended child arguments', () => {
  const command = "node '/plugin path/bin/tool.js' 'codex' '/worktree path'";
  const call = client('herdr', (bin, args) => {
    assert.deepEqual(args, ['pane', 'run', 'p1', command]);
    return { status: 0, stdout: '' };
  });
  assert.deepEqual(call(['pane', 'run', 'p1', command]), {});
});
test('CLI failure remains visible and does not retry a mutating command', () => {
  let attempts = 0;
  const call = client('herdr', () => { attempts++; return { status: 1, stderr: 'pane not found' }; });
  assert.throws(() => call(['pane', 'run', 'p1', 'codex']), /pane not found/);
  assert.equal(attempts, 1);
});

for (const args of [['pane', 'report-metadata'], ['workspace', 'report-metadata']]) {
  test(`${args.join(' ')} accepts a silent success acknowledgement`, () => {
    const call = client('herdr', () => ({ status: 0, stdout: '' }));
    assert.deepEqual(call(args), {});
  });
}
for (const stdout of ['', 'not json', 'null', '{}']) {
  test(`tab create rejects an unusable response ${JSON.stringify(stdout)} without retry`, () => {
    let attempts = 0;
    const call = client('herdr', () => { attempts++; return { status: 0, stdout }; });
    assert.throws(() => call(['tab', 'create']), /Herdr tab create:.*(JSON|result)/);
    assert.equal(attempts, 1);
  });
}
test('a JSON error response is reported with command context', () => {
  const call = client('herdr', () => ({ status: 0, stdout: '{"error":{"message":"pane not found"}}' }));
  assert.throws(() => call(['pane', 'report-metadata']), /Herdr pane report-metadata: pane not found/);
});
