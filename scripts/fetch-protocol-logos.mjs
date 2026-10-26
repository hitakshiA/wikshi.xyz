// Official brand assets, observed on the projects' own websites on 2026-09-06.
import {mkdir,writeFile} from 'node:fs/promises';
const assets={
 'hedera.webp':'https://hedera.com/nitropack_static/UrnjJjmKwNTqYyASRWAxQCqHOsrrxgzM/assets/images/optimized/rev-51545af/hedera.com/wp-content/uploads/2025/09/hedera-logo-docs-white-1-1.png',
 'x402.svg':'https://x402.org/wp-content/uploads/sites/10/2026/06/x402_logo.svg',
};
await mkdir('public/wikshi/protocols',{recursive:true});
for(const [name,url] of Object.entries(assets)){const response=await fetch(url);if(!response.ok)throw new Error(`${name}: ${response.status}`);await writeFile(`public/wikshi/protocols/${name}`,Buffer.from(await response.arrayBuffer()));console.log(name,response.headers.get('content-type'));}
