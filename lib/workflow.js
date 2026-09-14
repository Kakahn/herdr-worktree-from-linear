import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { loadConfig } from './config.js';
import { listIssues, fetchIssue, parseIdentifier } from './linear.js';
import { repoRootFor } from './run.js';
import { configureNetwork } from './network.js';
import { ask, choose, selectIssue, clean, Cancelled } from './ui.js';
import { loadState, saveState, stateKey, lock } from './state.js';
import { git, validBranch, worktrees, localBranch, refs, resolveCommit } from './git.js';
import { prepare } from './prepare.js';
import { client, ensureLayout, PLUGIN } from './layout.js';

export async function findIssue(config,{fetchFn=fetch,chooseFn=choose,askFn=ask,selectFn=selectIssue,direct=false,log=console.log}={}) {
  while(true) {
    const source=direct?'id':await chooseFn('Find an issue',[{value:'list',label:'Filtered list'},{value:'id',label:'Exact identifier — ignore team, assignee and status filters'}]);
    direct=false;
    if(source==='id') {
      const id=(await askFn('Linear identifier (e.g. ENG-123)')).toUpperCase();
      if(!parseIdentifier(id)){log('Invalid identifier.');continue;}
      const issue=await fetchIssue(config,id,fetchFn);
      return issue;
    }
    log(`Loading · team ${clean(config.teamKey||'all')} · ${config.assignedToMe?'assigned to me':'all assignees'} · Triage ${config.includeTriage?'included':'excluded'}…`);
    const issues=await listIssues(config,fetchFn);
    if(!issues.length){log('No issues match these filters. Look up an identifier or change the filters.');continue;}
    const issue=await selectFn(issues);if(issue)return issue;
  }
}
export async function branchPlan(repo,suggestion,{askFn=ask,chooseFn=choose}={}) {
  let branch;
  while(true){branch=await askFn('Branch name',suggestion);try{validBranch(repo,branch);break;}catch(e){console.log(e.message);}}
  const existing=worktrees(repo).find(w=>w.branch===branch);
  if(existing)return {branch,existing,base:null};
  const local=localBranch(repo,branch);
  if(local){console.log('This branch already exists: keep its history without changing its base.');return {branch,base:local};}
  const choices=[{value:'HEAD',label:`Current branch of the main checkout (${git(repo,['branch','--show-current'])||'detached HEAD'})`}];
  for(const ref of refs(repo))choices.push({value:ref,label:ref.replace('refs/heads/','Local · ').replace('refs/remotes/','Known remote · ')});
  choices.push({value:'manual',label:'Enter another reference or commit'});
  let ref=await chooseFn('Starting branch / commit (local references; no automatic fetch)',choices);
  if(ref==='manual')ref=await askFn('Git reference or SHA');
  const base=resolveCommit(repo,ref);
  return {branch,base,baseLabel:ref};
}
export async function workflow({env=process.env,fetchFn=fetch,call=client(env.HERDR_BIN_PATH||'herdr'),ui={ask,choose,selectIssue},prepareFn=prepare,layoutFn=ensureLayout,log=console.log}={}) {
  if(env.HERDR_ENV!=='1')throw new Error('Run this action from a Herdr terminal.');
  const dir=env.HERDR_PLUGIN_CONFIG_DIR;
  if(!dir)throw new Error('Plugin configuration directory is missing.');
  const release=lock(dir);
  try {
    const config=loadConfig(dir);configureNetwork(config);
    const boundedFetch=(u,o)=>fetchFn(u,{...o,signal:AbortSignal.timeout(config.network?.timeoutMs||20000)});
    const issue=await findIssue(config,{fetchFn:boundedFetch,chooseFn:ui.choose,askFn:ui.ask,selectFn:ui.selectIssue,direct:env.WFL_DIRECT==='1',log});
    const repo=realpathSync(repoRootFor(config,issue,env));
    log(`\n${clean(issue.identifier)} · ${clean(issue.title)}\nRepository: ${repo}`);
    const state=loadState(dir),key=stateKey(repo,issue.identifier);
    const remembered=state.tickets[key];
    // Linear controls the initial suggestion; never infer the base from the ticket.
    const plan=await branchPlan(repo,remembered?.branch||issue.branchName||issue.identifier.toLowerCase(),{askFn:ui.ask,chooseFn:ui.choose});
    const modes=[{value:'shell',label:'Shell only'},{value:'claude',label:'Claude Code'},{value:'codex',label:'Codex'},{value:'both',label:'Both — Codex above Claude Code'}];
    const previous=remembered?.mode||state.lastMode;
    modes.sort((a,b)=>Number(b.value===previous)-Number(a.value===previous));
    const mode=await ui.choose('Left panes (existing panes will be preserved)',modes);
    log(`\n${plan.existing?'Open':'Create'} ${plan.branch}\nBase : ${plan.existing?'existing worktree':plan.baseLabel||'existing local branch'}\nMode : ${mode}\nPreparation: ${config.preparation?.enabled===false?'disabled':'configured file rules'}\nUncommitted changes in the main checkout are not copied.`);
    if(await ui.choose('Apply these choices?',[{value:true,label:'Continue'},{value:false,label:'Cancel'}])!==true)throw new Cancelled();
    if(!ui.skipToolCheck) {
      const required=['node','lazygit',...(mode==='both'?['codex','claude']:mode==='shell'?[]:[mode])];
      if(config.preparation?.enabled!==false)required.push('python3');
      for(const command of required)if(spawnSync('/usr/bin/which',[command],{stdio:'ignore'}).status!==0)throw new Error(`Tool missing from the Herdr PATH: ${command}. Install or configure this tool, then try again.`);
    }
    const args=plan.existing?['worktree','open','--cwd',repo,'--branch',plan.branch,'--no-focus']:['worktree','create','--cwd',repo,'--branch',plan.branch,'--base',plan.base,'--no-focus'];
    const result=call(args);
    const cwd=result.worktree?.path || result.workspace?.worktree?.checkout_path;
    if(!cwd || !result.workspace || !result.root_pane)throw new Error('Incomplete Herdr response: no agents were launched.');
    const actual=worktrees(repo).find(w=>w.branch===plan.branch);
    if(!actual || realpathSync(actual.path)!==realpathSync(cwd))throw new Error('The returned worktree does not match the selected branch.');
    state.tickets[key]={repo,identifier:issue.identifier,cwd,branch:plan.branch,mode};state.lastMode=mode;saveState(dir,state);
    await prepareFn(cwd,config);
    log('Preparation finished. Press Enter to open the panes.');
    await ui.ask('Continue');
    layoutFn({result,identifier:issue.identifier,mode,cwd,call,onProgress:log});
    try{call(['workspace','report-metadata',result.workspace.workspace_id,'--source',`plugin:${PLUGIN}`,'--token',`linear=${issue.identifier}`]);}catch{log('Could not update the Linear sidebar label.');}
    log('Workspace ready. Existing agents were preserved.');
    return 0;
  } finally {release();}
}
