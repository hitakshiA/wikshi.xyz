import sharp from 'sharp';
import {readdir,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../public/wikshi/art/',import.meta.url);
const output=new URL('./public/art/',import.meta.url);
await mkdir(output,{recursive:true});
const manifest={};let before=0,after=0;
for(const file of await readdir(root)){
  if(!file.endsWith('.png'))continue;
  const source=new URL(file,root),original=await readFile(source);
  const width=file==='starter-research-mail.png'?320:960;
  const data=await sharp(original).resize({width,withoutEnlargement:true}).webp({quality:85,alphaQuality:100,effort:6}).toBuffer();
  const hash=createHash('sha256').update(data).digest('hex').slice(0,12);
  const name=`${file.slice(0,-4)}.${hash}.webp`;
  await writeFile(new URL(name,output),data);
  manifest[`/wikshi/art/${file}`]=`/art/${name}`;
  before+=(await stat(source)).size;after+=data.length;
}
await writeFile(new URL('./manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({images:Object.keys(manifest).length,originalBytes:before,cdnBytes:after,reductionPercent:Math.round((1-after/before)*100)}));
