import manifest from '../../asset-cdn/manifest.json';
export function wikshiArt(src:string){
  const path=(manifest as Record<string,string>)[src];
  return path?`https://wikshi-assets.vercel.app${path}`:src;
}
