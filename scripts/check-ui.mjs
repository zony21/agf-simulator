import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=new URL('../',import.meta.url),ui=new URL('src/ui/',root);
const html=readFileSync(new URL('index.html',root),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
if(ids.length!==new Set(ids).size)throw new Error('Duplicate static UI element IDs');
for(const name of readdirSync(ui).filter(name=>name.endsWith('.mjs'))) {
  const file=new URL(name,ui);
  const check=spawnSync(process.execPath,['--check',fileURLToPath(file)],{encoding:'utf8'});
  if(check.status!==0)throw new Error(check.stderr||'UI syntax check failed: '+name);
}
console.log('UI modules parsed; static element IDs are unique.');
