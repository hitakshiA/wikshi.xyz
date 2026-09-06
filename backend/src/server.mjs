import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {Store,hash} from './store.mjs';
import {Engine} from './engine.mjs';
import {Providers} from './providers.mjs';
import {ApiError} from './catalog.mjs';
import {RefundSigner} from './payments/hedera.mjs';
import {receiveEmail} from './inbound.mjs';

function credential(req) {
  const token=req.headers.authorization?.replace(/^Bearer /,'');
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(token||''))throw new ApiError('private_credential_required',401);
  return token;
}
async function rawBody(req) {
  if(!req.headers['content-type']?.startsWith('application/json'))throw new ApiError('json_required',415);
  if(req.headers['content-encoding'])throw new ApiError('unsupported_encoding',415);
  let length=0;const parts=[];
  for await(const part of req){length+=part.length;if(length>65536)throw new ApiError('request_too_large',413);parts.push(part);}
  return Buffer.concat(parts);
}
async function body(req) {try{return JSON.parse((await rawBody(req)).toString());}catch(error){if(error instanceof ApiError)throw error;throw new ApiError('invalid_json');}}
export function createApi(engine) {
  const limits=new Map();
  const server=createServer({maxHeaderSize:65536,requestTimeout:15000,headersTimeout:10000},async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Referrer-Policy','no-referrer');
    const send=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
    try {
    // Do not trust client-supplied forwarding headers. Reverse proxy gets a shared budget.
    const now=Date.now(), ip=req.socket.remoteAddress;
    if(limits.size>10000)limits.clear();
    let bucket=limits.get(ip);if(!bucket || bucket.at+60000<now){bucket={at:now,n:0};limits.set(ip,bucket);}
    if(++bucket.n>180)throw new ApiError('rate_limited',429);
    if (req.method === 'GET' && req.url === '/healthz') {
      return send(200,{status:'ok',service:'wikshi-api'});
    } else if (req.method === 'GET' && req.url === '/v1/services') {
      return send(200,{network:'hedera:testnet',services:engine?.services()||[],status:engine?'configured':'configuration_required'});
    }
    if(!engine)throw new ApiError('not_found',404);
    if(req.method==='POST' && req.url==='/v1/webhooks/email')return send(200,await receiveEmail(engine,await rawBody(req),req.headers));
    if(req.method==='GET' && req.url==='/v1/docs'){res.setHeader('Content-Type','text/plain; charset=utf-8');res.end(readFileSync(new URL('../docs/api.md',import.meta.url)));return;}
    if(req.method==='GET' && req.url==='/v1/receipt-key')return send(200,engine.receiptKey);
    const files={
      '/meet':['../public/meet.html','text/html; charset=utf-8'],
      '/static/meeting.js':['../public/meeting.js','text/javascript'],
      '/static/meeting.css':['../public/meeting.css','text/css'],
      '/static/bird.png':['../../public/wikshi/art/bird-wave-cutout.png','image/png'],
      '/static/meeting-bird.png':['../../public/wikshi/art/meeting-cutout.png','image/png'],
      '/static/funnel.woff2':['../../public/sites/inkbox-ai-e8043030/root-8a5edab2/s/funneldisplay/v3/B50WF7FGv37QNVWgE0ga--4Pbb6dDYs0gnHA.woff2','font/woff2'],
      '/static/geist.woff2':['../../public/sites/inkbox-ai-e8043030/root-8a5edab2/s/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2','font/woff2'],
      '/static/livekit.js':['../node_modules/livekit-client/dist/livekit-client.umd.js','text/javascript'],
    };
    if(req.method==='GET' && files[req.url]){
      const [path,type]=files[req.url];res.setHeader('Content-Type',type);
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self' https://*.livekit.cloud wss:; media-src 'self' blob:; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      res.end(readFileSync(new URL(path,import.meta.url)));return;
    }
    if(req.method==='POST' && req.url==='/v1/meetings/join'){
      const data=await body(req);if(!/^[A-Za-z0-9_-]{43}$/.test(data.guestToken||'') || data.consent!==true)throw new ApiError('meeting_consent_required');
      return send(200,await engine.join(data.guestToken));
    }
    const token=credential(req);
    if(req.method==='GET' && req.url==='/v1/inboxes')return send(200,{inboxes:engine.store.inboxes(hash(token))});
    if(req.method==='POST' && req.url==='/v1/operations'){
      const data=await body(req);let op=await engine.quote(data.service,data.input,token,req.headers['idempotency-key']);
      if(req.headers['payment-signature']){
        let payment;try{payment=JSON.parse(Buffer.from(req.headers['payment-signature'],'base64').toString());}catch{throw new ApiError('invalid_payment');}
        op=await engine.pay(op.id,token,payment);
        if(op.data.payment?.confirmed)res.setHeader('PAYMENT-RESPONSE',Buffer.from(JSON.stringify({success:true,network:'hedera:testnet',transaction:op.data.payment.tx,payer:op.data.payment.payer})).toString('base64'));
        return send(op.state==='payment_rejected'?402:202,engine.view(op));
      }
      if(op.state==='awaiting_payment'){
        const challenge=engine.challenge(op);res.setHeader('PAYMENT-REQUIRED',Buffer.from(JSON.stringify(challenge)).toString('base64'));
        return send(402,{...engine.view(op),paymentRequired:challenge});
      }
      return send(200,engine.view(op));
    }
    const route=/^\/v1\/operations\/([a-f0-9-]{36})(?:\/(pay|cancel))?$/.exec(req.url||'');
    if(route){
      if(req.method==='GET' && !route[2])return send(200,engine.view(engine.authorize(route[1],token)));
      if(req.method==='POST' && route[2]==='cancel')return send(200,engine.view(await engine.cancel(route[1],token)));
      if(req.method==='POST' && route[2]==='pay'){
        const data=await body(req);let payload=data.payment;
        if(req.headers['payment-signature']){try{payload=JSON.parse(Buffer.from(req.headers['payment-signature'],'base64').toString());}catch{throw new ApiError('invalid_payment');}}
        const op=await engine.pay(route[1],token,payload);
        if(op.data.payment?.confirmed)res.setHeader('PAYMENT-RESPONSE',Buffer.from(JSON.stringify({success:true,network:'hedera:testnet',transaction:op.data.payment.tx,payer:op.data.payment.payer})).toString('base64'));
        return send(op.state==='payment_rejected'?402:202,engine.view(op));
      }
    }
    const parsed=new URL(req.url,'http://localhost');
    const inbox=/^\/v1\/inboxes\/([a-f0-9-]{36})\/messages(?:\/([a-f0-9-]{36}))?$/.exec(parsed.pathname);
    if(req.method==='GET' && inbox){
      const resource=engine.store.resource(inbox[1],hash(token));if(!resource || resource.kind!=='inbox')throw new ApiError('not_found',404);
      if(inbox[2]){const message=engine.store.message(inbox[1],inbox[2]);if(!message)throw new ApiError('not_found',404);return send(200,{message,contentTrust:'untrusted-message-content'});}
      const before=parsed.searchParams.has('before')?Number(parsed.searchParams.get('before')):Number.MAX_SAFE_INTEGER;
      if(!Number.isSafeInteger(before) || before<1)throw new ApiError('invalid_cursor');
      const messages=engine.store.messages(inbox[1],before);
      return send(200,{messages,nextCursor:messages.length===20?messages.at(-1).cursor:null,contentTrust:'untrusted-message-content'});
    }
    throw new ApiError('not_found',404);
    } catch(error) {
      // Neither stack traces, upstream URLs, credentials nor provider error text cross this boundary.
      const known=error instanceof ApiError;
      send(known?error.status:503,{error:{code:known?error.code:'request_unavailable',requestId}});
    }
  });
  server.maxConnections=100;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  const env=process.env;
  if(!env.WIKSHI_PUBLIC_ORIGIN || !/^https?:\/\//.test(env.WIKSHI_PUBLIC_ORIGIN))throw new Error('WIKSHI_PUBLIC_ORIGIN required');
  const db=env.WIKSHI_DB || '.runtime/wikshi.sqlite';mkdirSync(dirname(db),{recursive:true,mode:0o700});
  const store=new Store(db,env.WIKSHI_DATA_KEY);
  const engine=new Engine({store,env,providers:new Providers(env),refundSigner:env.WIKSHI_MERCHANT_KEY?new RefundSigner(env.WIKSHI_MERCHANT_ACCOUNT,env.WIKSHI_MERCHANT_KEY):undefined});
  engine.recover();
  const interval=setInterval(()=>engine.tick().catch(()=>{}),5000);
  const server = createApi(engine);
  server.listen(port, '127.0.0.1', () => console.log(`Wikshi API listening on loopback:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {clearInterval(interval);server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(0),25000).unref();});
}
