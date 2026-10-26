import {chmod,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Exported assets must be readable by the web server after an archive deploy.
// Restrict this to generated public output, never source or runtime secrets.
const outputs={web:'../out/',chat:'../agent-demo/dist/'};
const output=outputs[process.argv[2]];
if(!output)throw new Error('Choose web or chat static output');
async function prepare(directory){
  await chmod(directory,0o755);
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const filename=path.join(directory,entry.name);
    if(entry.isDirectory())await prepare(filename);
    else if(entry.isFile())await chmod(filename,0o644);
  }
}
await prepare(fileURLToPath(new URL(output,import.meta.url)));
