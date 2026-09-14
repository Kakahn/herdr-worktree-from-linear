import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
export class Cancelled extends Error {}
export const clean = (s) => String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
export async function ask(label, fallback = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let interrupted = false;
  rl.on('SIGINT', () => { interrupted = true; rl.close(); });
  try {
    const answer = await rl.question(`${label}${fallback ? ` [${clean(fallback)}]` : ''} : `);
    if (interrupted) throw new Cancelled();
    return answer.trim() || fallback;
  } catch { throw new Cancelled(); } finally { rl.close(); }
}
export async function choose(title, options) {
  console.log(`\n${title}`);
  options.forEach((o,i)=>console.log(`  ${i+1}. ${clean(o.label)}`));
  while (true) {
    const answer = await ask('Choose (q to cancel)', '1');
    if (answer.toLowerCase() === 'q') throw new Cancelled();
    const n=Number(answer);
    if (Number.isInteger(n) && n>=1 && n<=options.length) return options[n-1].value;
    console.log('Choose a number from the list.');
  }
}
export async function selectIssue(issues) {
  const entries=issues.map((i,n)=>`${n}\t${clean(i.identifier)}  ${clean(i.title)}  [${clean(i.stateName)}]`);
  const r=spawnSync('fzf',['--delimiter=\t','--with-nth=2..','--layout=reverse','--prompt=Issue > ','--header=Enter: select · Escape: back'],{input:entries.join('\n'),encoding:'utf8'});
  if (r.error?.code === 'ENOENT') return choose('Issues',issues.map(i=>({label:`${i.identifier} ${i.title}`,value:i})));
  if (r.status===130 || r.status===1) return null;
  if (r.status!==0) throw new Error(`The fzf picker failed: ${clean(r.stderr)}`);
  return issues[Number(r.stdout.split('\t')[0])] || null;
}
export async function acknowledge(message='Press Enter to close') { await ask(message); }
