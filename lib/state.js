import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export function stateKey(repo,issue) { return createHash('sha256').update(`${repo}\0${issue}`).digest('hex'); }
export function loadState(dir) {
  try { const s=JSON.parse(readFileSync(join(dir,'workflow-state.json'),'utf8')); if(s.version!==1)throw new Error('Unknown state version'); return s; }
  catch(e) { if(e.code==='ENOENT') return {version:1,tickets:{},lastMode:'shell'}; throw new Error('Unreadable workflow state; keep workflow-state.json and check its format.'); }
}
export function saveState(dir,state) {
  mkdirSync(dir,{recursive:true,mode:0o700});
  const dest=join(dir,'workflow-state.json'), tmp=`${dest}.${process.pid}.tmp`;
  writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{mode:0o600}); renameSync(tmp,dest);
}
export function lock(dir) {
  const p=join(dir,'.workflow.lock');
  try { mkdirSync(p,{mode:0o700}); }
  catch(e) {
    if(e.code!=='EEXIST')throw e;
    let pid;try{pid=Number(readFileSync(join(p,'pid'),'utf8'));}catch{}
    let alive=true;
    if(Number.isInteger(pid)&&pid>0)try{process.kill(pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}
    if(!alive){rmSync(p,{recursive:true,force:true});return lock(dir);}
    throw new Error(`A preparation is already open. Close the other picker. Lock: ${p}.`);
  }
  writeFileSync(join(p,'pid'),String(process.pid));
  let released=false;
  const terminate=()=>process.exit(143);
  const release=()=>{
    if(released)return;released=true;
    rmSync(p,{recursive:true,force:true});
    process.removeListener('exit',release);process.removeListener('SIGTERM',terminate);process.removeListener('SIGHUP',terminate);
  };
  process.once('exit',release);process.once('SIGTERM',terminate);process.once('SIGHUP',terminate);
  return release;
}
