import {loadConfig} from './config.js';
import {loadState,lock} from './state.js';
import {client,ensureLayout} from './layout.js';
import {prepare} from './prepare.js';
import {ask} from './ui.js';
import {worktrees} from './git.js';
import {realpathSync} from 'node:fs';
export function eventWorktree(env) {
  const parse=s=>{try{return JSON.parse(s||'{}');}catch{return {};}};
  const context=parse(env.HERDR_PLUGIN_CONTEXT_JSON),payload=parse(env.HERDR_PLUGIN_EVENT_JSON);
  const find=(node,depth=0)=>{
    if(!node || typeof node!=='object'||depth>5)return null;
    const wt=node.worktree;
    if(wt && (wt.checkout_path||wt.path))return {path:wt.checkout_path||wt.path,workspace:node.workspace_id||node.workspace?.workspace_id||context.workspace_id,...(typeof node.already_open==='boolean'?{alreadyOpen:node.already_open}:{})};
    for(const key of ['event','data','payload','workspace']){const found=find(node[key],depth+1);if(found)return found;}
    return null;
  };
  return find(payload)||find(context);
}
export async function restore({env=process.env,call=client(env.HERDR_BIN_PATH||'herdr'),prepareFn=prepare,askFn=ask}={}) {
  if(env.HERDR_ENV!=='1')throw new Error('Run restoration from Herdr.');
  const dir=env.HERDR_PLUGIN_CONFIG_DIR, release=lock(dir);
  try {
    const state=loadState(dir),ticket=state.tickets[env.WFL_RESTORE_KEY];
    if(!ticket?.repo||!ticket.identifier||!env.WFL_RESTORE_WORKSPACE)throw new Error('Incomplete restoration context.');
    const found=worktrees(ticket.repo).find(w=>w.branch===ticket.branch);
    if(!found)throw new Error('This worktree no longer exists in Git.');
    const ws=call(['workspace','get',env.WFL_RESTORE_WORKSPACE]).workspace;
    if(!ws.worktree?.checkout_path || realpathSync(ws.worktree.checkout_path)!==realpathSync(found.path))throw new Error('The workspace no longer matches the registered worktree.');
    console.log(`Restoration ${ticket.identifier} · ${ticket.branch}`);
    await prepareFn(found.path,loadConfig(dir));
    await askFn('Preparation finished. Press Enter to restore missing panes');
    const panes=call(['pane','list','--workspace',ws.workspace_id]).panes.filter(p=>p.pane_id!==env.HERDR_PANE_ID);
    const original=panes.find(p=>p.pane_id===env.WFL_RESTORE_ROOT);
    // Reuse only the sole initial pane from a newly reopened workspace.
    const reuseRoot=!!original && panes.length===1 && !original.tokens?.wfl_role;
    const root=(reuseRoot?original:null)||panes.find(p=>p.tab_id===ws.active_tab_id)||panes[0];
    if(!root)throw new Error('The workspace has no available panes.');
    ensureLayout({result:{workspace:ws,tab:{tab_id:root.tab_id},root_pane:root,already_open:!reuseRoot},identifier:ticket.identifier,mode:ticket.mode,cwd:found.path,call,onProgress:console.log});
  }finally{release();}
}
