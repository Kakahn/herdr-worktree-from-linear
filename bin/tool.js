#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
const role=process.argv[2]||process.env.WFL_TOOL;
const cwd=process.argv[3]||process.env.WFL_WORKTREE;
const commands={codex:['codex'],claude:['claude'],lazygit:['lazygit'],shell:[process.env.SHELL||'/bin/zsh','-l']};
if(!commands[role] || !cwd){ console.error('Missing role or worktree directory.');process.exitCode=1; }
else {
  const [cmd,...args]=commands[role];
  let child=spawn(cmd,args,{cwd,stdio:'inherit'});
  let held=false;
  async function done(message) {
    if(held)return;held=true;
    if(process.stdin.isTTY)process.stdin.setRawMode(false);
    console.log(`\n${message}\nThis pane stays open. Press Enter to open a shell in this worktree.`);
    const rl=createInterface({input:process.stdin,output:process.stdout});
    try{await rl.question('');}catch{}finally{rl.close();}
    child=spawn(process.env.SHELL||'/bin/zsh',['-l'],{cwd,stdio:'inherit'});
    child.on('error',e=>{console.error(e.message);process.exitCode=1;});
    child.on('exit',code=>{process.exitCode=code||0;});
  }
  child.once('error',()=>done(`${cmd} was not found or could not start.`));
  child.once('exit',code=>done(`${cmd} finished (code ${code ?? 'signal'}).`));
}
