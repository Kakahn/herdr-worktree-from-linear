#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2];if(!root)throw new Error('Configuration directory required');
const old=join(root,'plugins/config/tdi.worktree-from-linear/config.json');
const dir=join(root,'plugins/config/kakahn.worktree-from-linear');
mkdirSync(dir,{recursive:true,mode:0o700});
const dest=join(dir,'config.json');
if(existsSync(dest)){console.log('Existing fork configuration preserved.');}
else {
 let c={};try{c=JSON.parse(readFileSync(old,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const out={...c,placement:c.placement||'popup',popupWidth:c.popupWidth||'85%',popupHeight:c.popupHeight||'85%',network:{ipv4Only:false,timeoutMs:20000,...c.network},preparation:{enabled:true,...c.preparation}};
 writeFileSync(dest,JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log('Personal configuration imported without displaying the key.');
 if(!c.linearApiKey)console.log('Set linearApiKey locally or LINEAR_API_KEY before searching.');
}
