import React,{useRef,useState} from 'react';

type Choices={accounts:string[];extensions:{id:string;name:string}[]};
export function WalletChoice({disabled=false}:{disabled?:boolean}) {
  const [options,setOptions]=useState<Choices>({accounts:[],extensions:[]});
  const [account,setAccount]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const details=useRef<HTMLDetailsElement>(null);
  async function refresh(){
    setLoading(true);setError('');
    try{const wallet=await import('./wallet');const next=await wallet.walletOptions();setOptions(next);if(!next.accounts.includes(account))setAccount('');}
    catch(e:any){setError(e.message||'Could not load wallets. Try again.');}
    finally{setLoading(false);}
  }
  async function connect(extensionId?:string){
    setLoading(true);setError('');
    try{const wallet=await import('./wallet');const chosen=await wallet.connectWallet(extensionId);setAccount(chosen);setOptions(await wallet.walletOptions());}
    catch(e:any){setError(e.message||'Wallet connection was not completed. You can retry or use sponsorship.');}
    finally{setLoading(false);}
  }
  async function choose(value:string){
    try{const wallet=await import('./wallet');wallet.chooseWalletAccount(value);setAccount(value);setError('');}
    catch(e:any){setError(e.message||'Select a connected testnet account.');}
  }
  return <details className="wallet-choice" ref={details} onToggle={()=>{if(details.current?.open)void refresh();}}>
    <summary>Choose or change wallet{account&&<span>{account}</span>}</summary>
    <div className="wallet-choice-body">
      <p>Connect a Hedera testnet wallet. Connecting does not pay or approve this request.</p>
      {options.accounts.length>0&&<label>Signing account<select value={account} disabled={disabled||loading} onChange={e=>void choose(e.target.value)}><option value="" disabled>Select your testnet account</option>{options.accounts.map(a=><option key={a} value={a}>{a}</option>)}</select></label>}
      <div className="wallet-choice-actions">{options.extensions.map(extension=><button key={extension.id} className="primary" disabled={disabled||loading} onClick={()=>void connect(extension.id)}>Connect {extension.name}</button>)}
        <button className="text-button" disabled={disabled||loading} onClick={()=>void connect()}>Connect with WalletConnect ↗</button>
        <button className="text-button" disabled={disabled||loading} onClick={()=>void refresh()}>Refresh wallets ↻</button>
      </div>
      {loading&&<p role="status">Connecting to your wallet…</p>}
      {!loading&&!options.extensions.length&&<p>No Hedera extension detected. Unlock HashPack or Kabila, then refresh wallets, or use WalletConnect.</p>}
      {error&&<p role="alert" className="error">{error}</p>}
    </div>
  </details>;
}
