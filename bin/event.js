#!/usr/bin/env node
import {existsSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {loadState} from '../lib/state.js';
import {eventWorktree} from '../lib/restore.js';
import {client,PLUGIN,rolesFor} from '../lib/layout.js';
import {openPickerArgs} from '../lib/pane.js';
export function onOpened(env=process.env,call=client(env.HERDR_BIN_PATH||'herdr')) {
  if(env.HERDR_ENV!=='1'||env.HERDR_PLUGIN_EVENT!=='worktree.opened')return;
  const dir=env.HERDR_PLUGIN_CONFIG_DIR;
  if(!dir||existsSync(join(dir,'.workflow.lock')))return; // Wizard already owns this creation/open.
  const target=eventWorktree(env);if(!target?.workspace||!target.path)return;
  const state=loadState(dir);
  const entry=Object.entries(state.tickets).find(([,t])=>t.cwd && existsSync(t.cwd) && realpathSync(t.cwd)===realpathSync(target.path));
  if(!entry)return;
  const [key,ticket]=entry;
  const panes=call(['pane','list','--workspace',target.workspace]).panes;
  const roles=new Set(panes.filter(p=>p.tokens?.wfl_issue===ticket.identifier).map(p=>p.tokens?.wfl_role));
  if([...rolesFor(ticket.mode),'issue','lazygit'].every(r=>roles.has(r)))return;
  const targetPane=panes[0]?.pane_id;if(!targetPane)return;
  // Popup/overlay panes cannot target an explicit workspace or pane in Herdr.
  // An event must restore its own worktree, independent of the UI's current focus.
  const args=openPickerArgs(PLUGIN,target.path,'right');
  args[args.indexOf('--entrypoint')+1]='restore';
  // A split derives its workspace from target-pane; --workspace is rejected.
  args.push('--target-pane',targetPane,'--env',`WFL_RESTORE_KEY=${key}`,'--env',`WFL_RESTORE_WORKSPACE=${target.workspace}`);
  if(target.alreadyOpen===false && panes.length===1 && !panes[0].tokens?.wfl_role)
    args.push('--env',`WFL_RESTORE_ROOT=${targetPane}`);
  call(args);
}
if(process.argv[1]?.endsWith('/bin/event.js'))try{onOpened();}catch(e){console.error(`Restoration: ${e.message}`);process.exitCode=1;}
