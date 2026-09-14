import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
const expand=p=>p?.startsWith('~/')?resolve(homedir(),p.slice(2)):p;
export function prepare(worktree,config) {
  if(config.preparation?.enabled===false) { console.log('Preparation explicitly disabled in configuration.'); return Promise.resolve(); }
  const args=[fileURLToPath(new URL('../setup/prepare.py',import.meta.url)),'--worktree',worktree,'--require-configured'];
  if(config.preparation?.machineFile)args.push('--machine',expand(config.preparation.machineFile));
  if(config.preparation?.rulesFile)args.push('--rules',expand(config.preparation.rulesFile));
  console.log('\nPreparing worktree — copying missing local files…');
  return new Promise((res,rej)=>{
    const child=spawn('python3',args,{stdio:'inherit'});
    child.on('error',()=>rej(new Error('Python 3 is required to prepare the worktree.')));
    child.on('exit',code=>code===0?res():rej(new Error('Preparation incomplete. No agents launched. Fix the reported problem, then select this issue again.')));
  });
}
