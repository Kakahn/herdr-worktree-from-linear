import { fileURLToPath } from 'node:url';
import { runCmd } from './exec.js';
export const PLUGIN='kakahn.worktree-from-linear';
export const rolesFor=mode=>mode==='both'?['codex','claude']: [mode];
export const quote=s=>`'${String(s).replaceAll("'", "'\\''")}'`;
export function client(bin='herdr',exec=runCmd) {
  return args=>{
    const command=args.slice(0,2).join(' ');
    // Herdr 0.9.0 uses silent success acknowledgements for these commands.
    // Other workflow commands must return JSON; --json is not a global flag.
    const silent=['pane report-metadata','workspace report-metadata','pane run'].includes(command);
    const r=exec(bin,[...args]);
    if(r.status!==0)throw new Error(`Herdr ${command}: ${r.stderr?.trim()||r.error?.message||'failure'}`);
    const stdout=r.stdout?.trim()||'';
    if(!stdout) {
      if(silent)return {};
      throw new Error(`Herdr ${command}: expected a JSON response, but stdout was empty. The command may have succeeded; it was not retried.`);
    }
    let json;
    try {json=JSON.parse(stdout);} catch {
      throw new Error(`Herdr ${command}: invalid JSON response. The command may have succeeded; it was not retried.`);
    }
    if(json?.error)throw new Error(`Herdr ${command}: ${json.error.message||'request failed'}`);
    if(!json || typeof json!=='object' || !Object.hasOwn(json,'result'))
      throw new Error(`Herdr ${command}: JSON response is missing result.`);
    return json.result;
  };
}
export function ensureLayout({result,identifier,mode,cwd,call,onProgress=()=>{}}) {
  const workspace=result.workspace.workspace_id;
  let list=call(['pane','list','--workspace',workspace]).panes;
  const matches=list.filter(p=>p.tokens?.wfl_issue===identifier && p.tokens?.wfl_role);
  if(new Set(matches.map(p=>p.tab_id)).size>1)throw new Error('Managed panes span multiple tabs. Group them in one tab before automatic repair.');
  let tab=matches[0]?.tab_id || result.tab.tab_id;
  let owned=matches.filter(p=>p.tab_id===tab);
  const byRole={};for(const p of owned){if(byRole[p.tokens.wfl_role])throw new Error('Two managed panes have the same role; no changes were made.');byRole[p.tokens.wfl_role]=p.pane_id;}
  const toolTitles={codex:'Codex',claude:'Claude Code',lazygit:'Lazygit'};
  // Refresh existing tool titles without renaming the issue pane or restarting tools.
  for(const p of owned) {
    const title=toolTitles[p.tokens.wfl_role];
    if(title)call(['pane','rename',p.pane_id,title]);
  }
  const tag=(id,role)=>{
    call(['pane','report-metadata',id,'--source',`plugin:${PLUGIN}`,'--token',`wfl_role=${role}`,'--token',`wfl_issue=${identifier}`]);
    call(['pane','rename',id,toolTitles[role]||`Linear · ${role==='issue'?identifier:role}`]);
    byRole[role]=id;
  };
  const wanted=rolesFor(mode);
  // Never send an agent command into an existing, unowned shell or process.
  if(!owned.length) {
    let root=result.root_pane;
    if(result.already_open) {
      onProgress('Workspace already open: creating a workflow tab and preserving existing panes.');
      const created=call(['tab','create','--workspace',workspace,'--cwd',cwd,'--label',`Linear · ${identifier}`,'--no-focus']);
      root=created.root_pane;tab=created.tab.tab_id;
    }
    tag(root.pane_id,wanted[0]);
    if(wanted[0]!=='shell') {
      const script=fileURLToPath(new URL('../bin/tool.js',import.meta.url));
      call(['pane','run',root.pane_id,`node ${quote(script)} ${quote(wanted[0])} ${quote(cwd)}`]);
    }
  }
  const open=(role,target,direction,swap)=>{
    const args=['plugin','pane','open','--plugin',PLUGIN,'--entrypoint',role==='issue'?'issue':'tool','--placement','split','--target-pane',target,'--direction',direction,'--no-focus'];
    if(role==='issue')args.push('--env',`HERDR_WFP_ISSUE=${identifier}`);
    else args.push('--env',`WFL_TOOL=${role}`,'--env',`WFL_WORKTREE=${cwd}`);
    const p=call(args).plugin_pane.pane;
    tag(p.pane_id,role);
    if(swap)call(['pane','swap','--pane',p.pane_id,'--direction',swap]);
    onProgress(`Added ${role} pane.`);
    return p.pane_id;
  };
  const lostLeft=!(byRole.codex||byRole.claude||byRole.shell);
  const lostRight=!byRole.issue && !byRole.lazygit;
  let left=byRole.codex||byRole.claude||byRole.shell;
  if(!left)left=open(wanted[0],byRole.issue||byRole.lazygit,'right','left');
  if(!byRole.issue) {
    if(byRole.lazygit)open('issue',byRole.lazygit,'down','up');
    else open('issue',left,'right');
  }
  if(!byRole.lazygit)open('lazygit',byRole.issue,'down');
  // Existing roles are never closed or relaunched, even if the user changes mode.
  for(const role of wanted) if(!byRole[role]) {
    if(role==='codex' && byRole.claude)open(role,byRole.claude,'down','up');
    else open(role,byRole.codex||byRole.shell||byRole.claude,'down');
  }
  if(lostLeft && byRole.lazygit) call(['pane','move',byRole.lazygit,'--tab',tab,'--target-pane',byRole.issue,'--split','down','--no-focus']);
  if(lostRight && byRole.codex && byRole.claude) call(['pane','move',byRole.claude,'--tab',tab,'--target-pane',byRole.codex,'--split','down','--no-focus']);
  call(['tab','focus',tab]);
  call(['pane','focus','--pane',byRole.issue,'--direction','left']);
  // All opens use --no-focus: the original left shell stays focused in new tabs.
  return byRole;
}
