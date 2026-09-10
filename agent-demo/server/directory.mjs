import {createHash,createPublicKey,verify} from 'node:crypto';
export function verifyDirectory(directory,key,expectedOrigin) {
  const bytes=Buffer.from(directory.signedPayload||'','base64');
  if(createHash('sha256').update(bytes).digest('hex')!==directory.hash||!verify(null,bytes,createPublicKey({key,format:'jwk'}),Buffer.from(directory.signature||'','base64')))throw Error('Directory signature mismatch');
  const manifest=JSON.parse(bytes);
  if(JSON.stringify(manifest)!==JSON.stringify(directory.manifest)||manifest.origin!==expectedOrigin||manifest.network!=='hedera:testnet'||!Array.isArray(manifest.services))throw Error('Directory manifest mismatch');
  return manifest;
}
