import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContextCwd, parseMainWorktree, resolveRepo } from '../lib/repo.js';

test('parseContextCwd prefers flat keys then nested then fallback', () => {
  assert.equal(parseContextCwd(JSON.stringify({ focused_pane_cwd: '/a', workspace_cwd: '/b' }), '/f'), '/a');
  assert.equal(parseContextCwd(JSON.stringify({ workspace_cwd: '/b' }), '/f'), '/b');
  assert.equal(parseContextCwd(JSON.stringify({ worktree: { checkout_path: '/wt' } }), '/f'), '/wt');
  assert.equal(parseContextCwd(JSON.stringify({ repo_root: '/r' }), '/f'), '/r');
  assert.equal(parseContextCwd('not json', '/f'), '/f');
  assert.equal(parseContextCwd(undefined, '/f'), '/f');
});

test('resolveRepo prefers HERDR_WFP_CWD over context JSON', () => {
  const env = { HERDR_WFP_CWD: '/explicit/repo', HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_cwd: '/plugin/dir' }) };
  const seen = [];
  const exec = (cmd, args) => {
    if (cmd === 'git' && args.includes('--porcelain')) { seen.push(args.join(' ')); return { status: 0, stdout: 'worktree /explicit/repo\nHEAD abc\nbranch refs/heads/main\n', stderr: '' }; }
    return { status: 1, stdout: '', stderr: '' };
  };
  assert.deepEqual(resolveRepo(env, exec), { repoRoot: '/explicit/repo' });
  assert.ok(seen[0].includes('-C /explicit/repo'));
});

test('parseMainWorktree takes the first worktree line', () => {
  assert.equal(parseMainWorktree('worktree /main\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/a\n'), '/main');
  assert.equal(parseMainWorktree(''), null);
  assert.equal(parseMainWorktree('HEAD abc\n'), null);
});

// The bug: invoked from a linked worktree, resolveRepo used to return the linked path,
// and herdr rejected it with linked_worktree_source. It must return the main root.
test('resolveRepo returns the main worktree root when invoked from a linked worktree', () => {
  const linked = '/Users/x/.herdr/worktrees/repo/feat-b';
  const porcelain = [
    'worktree /Users/x/projects/repo', 'HEAD aaa', 'branch refs/heads/main', '',
    `worktree ${linked}`, 'HEAD bbb', 'branch refs/heads/feat/b', '',
  ].join('\n');
  const exec = (cmd, args) => (cmd === 'git' && args.includes('--porcelain')
    ? { status: 0, stdout: porcelain, stderr: '' }
    : { status: 1, stdout: '', stderr: '' });
  assert.deepEqual(resolveRepo({ HERDR_WFP_CWD: linked }, exec), { repoRoot: '/Users/x/projects/repo' });
});

test('resolveRepo throws when not a git repo', () => {
  const exec = () => ({ status: 1, stdout: '', stderr: 'fatal' });
  assert.throws(() => resolveRepo({}, exec), /not inside a git repository/);
});
