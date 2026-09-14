import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {findIssue,branchPlan,workflow} from '../lib/workflow.js';
import {client,ensureLayout,quote} from '../lib/layout.js';
import {validBranch,worktrees,git} from '../lib/git.js';
import {loadState,saveState,stateKey,lock} from '../lib/state.js';
import {networkError} from '../lib/network.js';
import {Cancelled} from '../lib/ui.js';
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),'workflow-fork-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const repo=join(dir,"repo space ' quote");mkdirSync(repo);
 const g=(...a)=>execFileSync('git',['-C',repo,...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 g('init','-q');writeFileSync(join(repo,'file'),'base');g('add','.');g('-c','user.name=Test','-c','user.email=t@example.invalid','-c','commit.gpgsign=false','commit','-qm','base');g('branch','develop');
 const config=join(dir,'config');mkdirSync(config);writeFileSync(join(config,'config.json'),JSON.stringify({linearApiKey:'fake',repos:{ENG:repo}}));
 return {dir,repo,g,config};
}
const issue={identifier:'ENG-7',title:'Test',branchName:'feature/workflow-7',team:{key:'ENG'},state:{name:'Triage'}};
const response=nodes=>({ok:true,text:async()=>JSON.stringify({data:{issues:{nodes}}})});
test('direct identifier bypasses all filters and keeps Linear branchName',async()=>{
 let query;const found=await findIssue({assignedToMe:true,teamKey:'OTHER',issueLimit:1},{direct:true,askFn:async()=> 'eng-7',fetchFn:async(u,o)=>{query=JSON.parse(o.body).query;return response([issue]);}});
 assert.equal(found.branchName,'feature/workflow-7');assert.match(query,/number: \{ eq: 7/);assert.match(query,/key: \{ eq: "ENG"/);assert.doesNotMatch(query,/isMe|type: \{ in:|updatedAt/);
});
test('empty filtered list stays in the wizard, then direct lookup succeeds',async()=>{
 let n=0;const logs=[];const got=await findIssue({},{chooseFn:async()=>++n===1?'list':'id',askFn:async()=> 'ENG-7',fetchFn:async()=>response(n===1?[]:[issue]),log:s=>logs.push(s)});
 assert.equal(got.identifier,'ENG-7');assert.ok(logs.some(s=>s.includes('No issues')));
});
test('Git validates branch injection, spaces and parent references',t=>{
 const {repo}=fixture(t);for(const b of ['-bad','a b','a..b','@{x}','a\nb'])assert.throws(()=>validBranch(repo,b));assert.equal(validBranch(repo,"feature/ticket-$()-'x"),"feature/ticket-$()-'x");
});
test('base selection uses the chosen local branch commit, not origin/main',async t=>{
 const {repo,g}=fixture(t);const plan=await branchPlan(repo,'feature/workflow-7',{askFn:async(l,d)=>d,chooseFn:async()=> 'refs/heads/develop'});assert.equal(plan.base,g('rev-parse','develop').trim());assert.equal(plan.baseLabel,'refs/heads/develop');
});
test('existing branch / checkout skip base selection and never reset',async t=>{
 const {repo,dir,g}=fixture(t);const wt=join(dir,'linked');g('worktree','add','-b','feature/workflow-7',wt,'HEAD');
 const plan=await branchPlan(repo,'feature/workflow-7',{askFn:async(l,d)=>d,chooseFn:async()=>{throw new Error('must not choose base');}});
 assert.equal(plan.existing.path,wt);assert.equal(worktrees(repo).length,2);
});
test('state preserves custom issue branch and excludeddes credentials; lock prevents concurrency',t=>{
 const {config,repo}=fixture(t);const state=loadState(config);state.tickets[stateKey(repo,'ENG-7')]={branch:'custom/name',mode:'both'};saveState(config,state);assert.deepEqual(loadState(config),state);assert.doesNotMatch(readFileSync(join(config,'workflow-state.json'),'utf8'),/linearApiKey/);const release=lock(config);assert.throws(()=>lock(config),/already open/);release();lock(config)();
});
function server(existing=[],already=false) {
 let i=1;const calls=[];const root={pane_id:'p0',tab_id:'t0',workspace_id:'w0',tokens:{}};const panes=[root,...existing];
 const call=args=>{calls.push(args);const [a,b]=args;
  if(a==='pane'&&b==='list')return {panes:panes.map(p=>({...p,tokens:{...p.tokens}}))};
  if(a==='tab'&&b==='create'){const p={pane_id:`p${i++}`,tab_id:'t1',tokens:{}};panes.push(p);return {root_pane:p,tab:{tab_id:'t1'}};}
  if(a==='plugin'){const target=panes.find(p=>p.pane_id===args[args.indexOf('--target-pane')+1]);const p={pane_id:`p${i++}`,tab_id:target.tab_id,tokens:{}};panes.push(p);return {plugin_pane:{pane:p}};}
  if(a==='pane'&&b==='move'){
   // Herdr 0.9.0 requires --tab even when --target-pane is present.
   assert.ok(args.includes('--tab'),'pane move requires an explicit destination tab');
   const target=panes.find(p=>p.pane_id===args[args.indexOf('--target-pane')+1]);
   assert.equal(args[args.indexOf('--tab')+1],target.tab_id,'move must use the target pane tab');
  }
  if(a==='pane'&&b==='report-metadata'){const p=panes.find(p=>p.pane_id===args[2]);for(let j=0;j<args.length;j++)if(args[j]==='--token'){const [k,v]=args[j+1].split('=');p.tokens[k]=v;}}
  return {};
 };
 return {call,calls,panes,result:{workspace:{workspace_id:'w0'},tab:{tab_id:'t0'},root_pane:root,already_open:already}};
}
const tagged=(id,role)=>({pane_id:id,tab_id:'t0',workspace_id:'w0',tokens:{wfl_role:role,wfl_issue:'ENG-7'}});
for(const mode of ['shell','claude','codex','both'])test(`layout ${mode}: correct roles, same cwd, idempotent reopening`,()=>{
 const s=server();const args={...s,identifier:'ENG-7',mode,cwd:"/wt space/'quote"};const roles=ensureLayout(args);
 assert.deepEqual(Object.keys(roles).sort(),[...(mode==='both'?['codex','claude']:[mode]),'issue','lazygit'].sort());
 const first=s.calls.length;ensureLayout({...args,result:{...s.result,already_open:true}});const delta=s.calls.slice(first);assert.ok(!delta.some(a=>a[0]==='plugin'||a[1]==='run'||a[1]==='create'));
 assert.ok(!s.calls.some(a=>a.includes('close')||a.includes('send-keys')));
 for(const c of s.calls.filter(a=>a[0]==='plugin' && a.includes('tool')))assert.ok(c.includes("WFL_WORKTREE=/wt space/'quote"));
});
test('missing issue restored once without restarting existing agents',()=>{
 const s=server([tagged('codex','codex'),tagged('claude','claude'),tagged('git','lazygit')],true);ensureLayout({...s,identifier:'ENG-7',mode:'both',cwd:'/wt'});
 assert.equal(s.calls.filter(a=>a[0]==='plugin').length,1);assert.ok(s.calls.some(a=>a.includes('issue')));assert.ok(!s.calls.some(a=>a[1]==='run'));
});
test('existing unowned workspace gets separate tab; unknown shell receives no commands',()=>{
 const s=server([],true);ensureLayout({...s,identifier:'ENG-7',mode:'both',cwd:'/wt'});assert.ok(s.calls.some(a=>a[0]==='tab'&&a[1]==='create'));assert.ok(!s.calls.some(a=>a[1]==='run'&&a[2]==='p0'));
});
test('missing left side repaired without closing surviving tools',()=>{
 const s=server([tagged('issue','issue'),tagged('git','lazygit')],true);ensureLayout({...s,identifier:'ENG-7',mode:'both',cwd:'/wt'});
 assert.equal(s.calls.filter(a=>a[0]==='plugin').length,2);assert.ok(s.calls.some(a=>a[1]==='move'&&a[2]==='git'));assert.ok(!s.calls.some(a=>a[1]==='close'));
});
test('shell quoting protects apostrophes and command substitutions',()=>{
 const value="weird ' $(touch forbidden) `echo no`";const result=execFileSync('/bin/sh',['-c',`printf %s ${quote(value)}`],{encoding:'utf8'});assert.equal(result,value);
});
test('preparation failure stops before all layout and agent launches; retry reopens same branch',async t=>{
 const {repo,dir,config,g}=fixture(t);const events=[];let failed=true;
 const ui={skipToolCheck:true,ask:async(l,d)=>d||'',choose:async(title,opts)=>title.startsWith('Find')?'id':title.startsWith('Starting branch /')?'HEAD':title.startsWith('Left panes')?'both':true};ui.ask=async(l,d)=>l.startsWith('Linear identifier')?'ENG-7':d||'';
 const call=args=>{events.push(args[1]);const wt=join(dir,'wt');if(args[1]==='create')g('worktree','add','-b','feature/workflow-7',wt,args[args.indexOf('--base')+1]);return {worktree:{path:wt},workspace:{workspace_id:'w'},root_pane:{pane_id:'p'},tab:{tab_id:'t'}};};
 const opts={env:{HERDR_ENV:'1',HERDR_PLUGIN_CONFIG_DIR:config},ui,fetchFn:async()=>response([issue]),call,prepareFn:async()=>{events.push('prepare');if(failed)throw new Error('missing env');},layoutFn:()=>events.push('layout'),log:()=>{}};
 await assert.rejects(workflow(opts),/missing env/);assert.deepEqual(events,['create','prepare']);assert.equal(loadState(config).tickets[stateKey(repo,'ENG-7')].branch,'feature/workflow-7');
 failed=false; // Test retry only to layout; abort there to avoid invoking real metadata CLI.
 await assert.rejects(workflow({...opts,layoutFn:()=>{events.push('layout');throw new Error('layout reached');}}),/layout reached/);
 assert.deepEqual(events,['create','prepare','open','prepare','layout']);
});
test('cancellation before create has no Herdr side effects',async t=>{
 const {config}=fixture(t);let called=false;
 await assert.rejects(workflow({env:{HERDR_ENV:'1',HERDR_PLUGIN_CONFIG_DIR:config},call:()=>{called=true;},ui:{choose:async()=>{throw new Cancelled();}},log:()=>{}}),Cancelled);assert.equal(called,false);
});
test('network errors expose codes rather than request credentials',()=>{
 const e=new Error('fetch failed',{cause:{code:'ETIMEDOUT',errors:[{code:'ENETUNREACH'}]}});assert.match(networkError(e),/ETIMEDOUT, ENETUNREACH/);
});

import {eventWorktree,restore} from '../lib/restore.js';
import {onOpened} from '../bin/event.js';
test('event handler reads only explicit worktree provenance',()=>{
 assert.equal(eventWorktree({HERDR_PLUGIN_CONTEXT_JSON:JSON.stringify({focused_pane_cwd:'/not-a-worktree'})}),null);
 assert.deepEqual(eventWorktree({HERDR_PLUGIN_CONTEXT_JSON:JSON.stringify({workspace_id:'w',worktree:{checkout_path:'/wt'}})}),{path:'/wt',workspace:'w'});
});
test('native reopen dispatches restore for known checkout, skips complete layouts and wizard lock',t=>{
 const {config,repo}=fixture(t);const state=loadState(config);state.tickets.a={repo,cwd:repo,identifier:'ENG-7',mode:'both'};saveState(config,state);
 const env={HERDR_ENV:'1',HERDR_PLUGIN_EVENT:'worktree.opened',HERDR_PLUGIN_CONFIG_DIR:config,HERDR_PLUGIN_CONTEXT_JSON:JSON.stringify({workspace_id:'w',worktree:{checkout_path:repo}})};
 const calls=[];let complete=false;
 const call=a=>{calls.push(a);return {panes:complete?['codex','claude','issue','lazygit'].map(r=>tagged(r,r)):[{pane_id:'root'}]};};
 onOpened(env,call);assert.ok(calls.some(a=>a.includes('restore')&&a.includes('WFL_RESTORE_WORKSPACE=w')));
 calls.length=0;complete=true;onOpened(env,call);assert.equal(calls.length,1);
 const release=lock(config);calls.length=0;onOpened(env,call);assert.equal(calls.length,0);release();
});
test('restore refuses an unrelated workspace before preparing files',async t=>{
 const {repo,dir,config,g}=fixture(t);const wt=join(dir,'wt');g('worktree','add','-b','ticket',wt,'HEAD');const state=loadState(config);state.tickets.x={repo,cwd:wt,branch:'ticket',identifier:'ENG-7',mode:'shell'};saveState(config,state);
 let prepared=false;
 await assert.rejects(restore({env:{HERDR_ENV:'1',HERDR_PLUGIN_CONFIG_DIR:config,WFL_RESTORE_KEY:'x',WFL_RESTORE_WORKSPACE:'w'},call:()=>({workspace:{worktree:{checkout_path:repo}}}),prepareFn:async()=>{prepared=true;}}),/no longer matches/);
 assert.equal(prepared,false);lock(config)();
});
test('configuration migration is private, repeatable and keeps original intact',t=>{
 const {dir}=fixture(t),root=join(dir,'herdr'),source=join(root,'plugins/config/tdi.worktree-from-linear');mkdirSync(source,{recursive:true});
 const original=JSON.stringify({linearApiKey:'fixture-only',teamKey:'ENG'});writeFileSync(join(source,'config.json'),original);
 const script=new URL('../scripts/migrate-config.js',import.meta.url);
 execFileSync(process.execPath,[script.pathname,root]);const dest=join(root,'plugins/config/kakahn.worktree-from-linear/config.json');
 const result=readFileSync(dest,'utf8');assert.equal(JSON.parse(result).network.ipv4Only,false);assert.equal(readFileSync(join(source,'config.json'),'utf8'),original);
 execFileSync(process.execPath,[script.pathname,root]);assert.equal(readFileSync(dest,'utf8'),result);
});
test('full successful workflow creates once then reopens remembered custom branch',async t=>{
 const {dir,config,g}=fixture(t);const events=[];let created=false;
 const ui={skipToolCheck:true,ask:async(l,d)=>l.startsWith('Linear identifier')?'ENG-7':l==='Branch name'?'feature/my-custom-ticket':d||'',choose:async(title)=>title.startsWith('Find')?'id':title.startsWith('Starting branch /')?'refs/heads/develop':title.startsWith('Left panes')?'both':true};
 const call=args=>{
  if(args[0]==='workspace')return {};
  const wt=join(dir,'wt');events.push(args[1]);
  if(args[1]==='create'){assert.equal(created,false);created=true;g('worktree','add','-b','feature/my-custom-ticket',wt,args[args.indexOf('--base')+1]);}
  return {worktree:{path:wt},workspace:{workspace_id:'w'},root_pane:{pane_id:'p'},tab:{tab_id:'t'}};
 };
 const opts={env:{HERDR_ENV:'1',HERDR_PLUGIN_CONFIG_DIR:config},ui,fetchFn:async()=>response([issue]),call,prepareFn:async()=>events.push('prepare'),layoutFn:()=>events.push('layout'),log:()=>{}};
 assert.equal(await workflow(opts),0);assert.equal(await workflow(opts),0);assert.deepEqual(events,['create','prepare','layout','open','prepare','layout']);
});

test('layout completes through CLI adapter with silent metadata and run acknowledgements', () => {
 const s=server([],true);
 const call=client('herdr', (_bin,args)=>{
  assert.ok(!args.includes('--json'));
  const result=s.call(args);
  const silent=['pane report-metadata','pane run','workspace report-metadata'].includes(args.slice(0,2).join(' '));
  return {status:0,stdout:silent?'':JSON.stringify({result})};
 });
 const args={...s,call,identifier:'ENG-7',mode:'both',cwd:'/wt'};
 assert.deepEqual(Object.keys(ensureLayout(args)).sort(),['claude','codex','issue','lazygit']);
 assert.equal(s.calls.filter(a=>a[1]==='run').length,1);
 const count=s.calls.length;
 ensureLayout(args);
 assert.ok(!s.calls.slice(count).some(a=>a[0]==='plugin'||a[1]==='run'||a[1]==='create'));
});

test('column repair uses the managed tab rather than the workspace default tab', () => {
 for(const roles of [['codex','claude'],['issue','lazygit']]) {
  const existing=roles.map(role=>({...tagged(role,role),tab_id:'managed-tab'}));
  const s=server(existing,true);
  ensureLayout({...s,identifier:'ENG-7',mode:'both',cwd:'/wt'});
  const moves=s.calls.filter(a=>a[0]==='pane'&&a[1]==='move');
  assert.equal(moves.length,1);
  assert.equal(moves[0][moves[0].indexOf('--tab')+1],'managed-tab');
  const count=s.calls.length;
  ensureLayout({...s,identifier:'ENG-7',mode:'both',cwd:'/wt'});
  assert.ok(!s.calls.slice(count).some(a=>a[0]==='plugin'||['run','move','create'].includes(a[1])));
 }
});

for(const placement of ['popup','overlay'])test(`native restoration uses an explicit split target with a ${placement} picker preference`,t=>{
 const {config,repo}=fixture(t);
 writeFileSync(join(config,'config.json'),JSON.stringify({placement,popupWidth:'80%',popupHeight:'70%'}));
 const state=loadState(config);state.tickets.a={repo,cwd:repo,identifier:'ENG-7',mode:'both'};saveState(config,state);
 const env={HERDR_ENV:'1',HERDR_PLUGIN_EVENT:'worktree.opened',HERDR_PLUGIN_CONFIG_DIR:config,HERDR_PLUGIN_CONTEXT_JSON:JSON.stringify({workspace_id:'reopened',worktree:{checkout_path:repo}})};
 const calls=[];
 onOpened(env,args=>{
  calls.push(args);
  if(args[0]==='pane')return {panes:[{pane_id:'reopened:p1'}]};
  const actualPlacement=args[args.indexOf('--placement')+1];
  if(['popup','overlay'].includes(actualPlacement)&&args.includes('--target-pane'))
   throw new Error('overlay and popup plugin panes target the active pane');
  assert.equal(actualPlacement,'split');
  assert.equal(args[args.indexOf('--workspace')+1],'reopened');
  assert.equal(args[args.indexOf('--target-pane')+1],'reopened:p1');
  assert.equal(args[args.indexOf('--entrypoint')+1],'restore');
  assert.ok(!args.includes('--width')&&!args.includes('--height'));
  return {};
 });
 assert.equal(calls.length,2);
 assert.equal(JSON.parse(readFileSync(join(config,'config.json'),'utf8')).placement,placement);
});
