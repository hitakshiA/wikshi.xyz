import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Read only the public project ID. Never source server secrets into a Vite build.
export function walletProjectId(text) {
  const matches=text.split(/\r?\n/).filter(line=>line.startsWith('VITE_WALLETCONNECT_PROJECT_ID='));
  if(matches.length>1)throw new Error('Duplicate WalletConnect project ID');
  const value=matches[0]?.slice('VITE_WALLETCONNECT_PROJECT_ID='.length).trim()||'';
  if(value && (!/^[a-f0-9]{32}$/i.test(value)||/^0+$/.test(value)))throw new Error('Invalid public WalletConnect project ID');
  return value;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let text='';
  try{text=readFileSync(process.argv[2]||'/etc/wikshi/chat-public.env','utf8');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  process.stdout.write(walletProjectId(text));
}
