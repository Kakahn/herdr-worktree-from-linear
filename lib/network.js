import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
export function configureNetwork(config) {
  if(config.network?.ipv4Only) { setDefaultResultOrder('ipv4first'); setDefaultAutoSelectFamily(false); }
}
export function networkError(err) {
  if(err.message !== 'fetch failed')return err.message;
  const codes=[];
  function walk(e,d=0){ if(!e||d>5)return; if(/^[A-Z0-9_]+$/.test(e.code||''))codes.push(e.code);walk(e.cause,d+1);for(const c of e.errors||[])walk(c,d+1); }
  walk(err);
  return `Cannot connect to Linear (${[...new Set(codes)].join(', ')||'network'}). Check the network; network.ipv4Only can work around IPv4/IPv6 connection issues.`;
}
