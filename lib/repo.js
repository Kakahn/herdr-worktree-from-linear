import { runCmd } from './exec.js';

function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

export function parseContextCwd(contextJson, fallbackCwd) {
  let ctx = null;
  try {
    ctx = contextJson ? JSON.parse(contextJson) : null;
  } catch {
    ctx = null;
  }
  if (ctx && typeof ctx === 'object') {
    const pane = ctx.focused_pane && typeof ctx.focused_pane === 'object' ? ctx.focused_pane : {};
    const workspace = ctx.workspace && typeof ctx.workspace === 'object' ? ctx.workspace : {};
    const worktree = ctx.worktree && typeof ctx.worktree === 'object' ? ctx.worktree : {};
    const found = firstString(
      ctx.focused_pane_cwd, pane.cwd, pane.working_directory,
      ctx.workspace_cwd, workspace.cwd, workspace.path,
      worktree.checkout_path, worktree.path, worktree.workspace_cwd,
      ctx.cwd, ctx.repo_root,
    );
    if (found) return found;
  }
  return fallbackCwd;
}

// `git worktree list --porcelain` always lists the MAIN worktree first, in a main
// checkout and inside a linked worktree alike.
export function parseMainWorktree(porcelain) {
  const m = /^worktree (.+)$/.exec((porcelain || '').split('\n')[0].trim());
  return m ? m[1].trim() : null;
}

// Resolve to the repo's main worktree root, NOT the invoking checkout. Inside a linked
// worktree `git rev-parse --show-toplevel` returns that worktree's own path, and herdr
// rejects it: linked_worktree_source "New and open worktree actions start from the repo
// parent workspace." Since most work happens in worktree workspaces, using the toplevel
// broke the action almost everywhere.
export function resolveRepo(env, exec = runCmd) {
  const cwd = (typeof env.HERDR_WFP_CWD === 'string' && env.HERDR_WFP_CWD)
    || parseContextCwd(env.HERDR_PLUGIN_CONTEXT_JSON, env.PWD || process.cwd());
  const list = exec('git', ['-C', cwd, 'worktree', 'list', '--porcelain']);
  const repoRoot = list.status === 0 && parseMainWorktree(list.stdout);
  if (!repoRoot) {
    throw new Error('worktree-from-linear: not inside a git repository');
  }
  return { repoRoot };
}
