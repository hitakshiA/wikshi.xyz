import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const origin='https://wikshi-assets.vercel.app';
const manifest=JSON.parse(await readFile(new URL('./manifest.json',import.meta.url),'utf8'));
const files=execFileSync('git',['ls-files','src'],{encoding:'utf8'}).trim().split('\n');
let changed=0;
for(const file of files){
  if(!/\.(tsx?|json|css)$/.test(file))continue;
  const source=await readFile(file,'utf8');let next=source;
  for(const [path,dest]of Object.entries(manifest))next=next.split(path).join(origin+dest);
  if(next!==source){await writeFile(file,next);changed++;}
}
console.log(`Updated image URLs in ${changed} frontend source files.`);
