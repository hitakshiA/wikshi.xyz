import type {Metadata} from 'next';
import './replica.css';
import './wikshi-clone.css';
import './wikshi-pages.css';

export const metadata:Metadata={metadataBase:new URL('https://wikshi.xyz'),title:'Wikshi | Give your agent a voice.',description:'An email inbox to write from. A phone to call from. The data and contact details it needs. Paid per use with x402 on Hedera.',robots:{index:true,follow:true},icons:{icon:'/wikshi/art/messenger-cutout.png'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><head><link rel="stylesheet" href="/wikshi/clone-theme.css"/></head><body>{children}</body></html>;}
