import { spawnSync } from 'node:child_process';
export function git(repo,args,exec=spawnSync) {
  const env={...process.env}; for(const k of Object.keys(env)) if(k.startsWith('GIT_'))delete env[k];
  const r=exec('git',['-C',repo,...args],{encoding:'utf8',env});
  if(r.status!==0) throw new Error(`Git : ${r.stderr?.trim() || r.error?.message || args[0]}`);
  return r.stdout.trimEnd();
}
export function validBranch(repo,branch) {
  if(!branch || branch.startsWith('-') || /[\x00-\x1f\x7f]/.test(branch)) throw new Error('Invalid branch name.');
  git(repo,['check-ref-format',`refs/heads/${branch}`]); return branch;
}
export function worktrees(repo) {
  const text=git(repo,['worktree','list','--porcelain','-z']);
  return text.split('\0\0').filter(Boolean).map(record=>{
    const parts=record.split('\0');
    return {path:parts.find(x=>x.startsWith('worktree '))?.slice(9),branch:parts.find(x=>x.startsWith('branch refs/heads/'))?.slice(18)};
  });
}
export function localBranch(repo,branch) {
  try{return git(repo,['rev-parse','--verify',`refs/heads/${branch}^{commit}`]);}catch{return null;}
}
export function refs(repo) {return git(repo,['for-each-ref','--format=%(refname)','refs/heads/','refs/remotes/']).split('\n').filter(x=>x && !x.endsWith('/HEAD'));}
export function resolveCommit(repo,ref) {
  if(ref.startsWith('-') || /[\x00-\x1f\x7f]/.test(ref))throw new Error('Invalid reference');
  return git(repo,['rev-parse','--verify','--end-of-options',`${ref}^{commit}`]);
}
