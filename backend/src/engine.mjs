import {randomUUID,randomBytes,createPrivateKey,createPublicKey,sign,createHmac} from 'node:crypto';
import {hash} from './store.mjs';
import {ApiError,catalog,validate,emailAddress} from './catalog.mjs';
import {Blocky,NETWORK,USDC} from './payments/blocky.mjs';
import {inspectPayment,confirmTransfer} from './payments/hedera.mjs';

export class Engine {
  constructor({store,env,providers,blocky=new Blocky(),inspect=inspectPayment,confirm=confirmTransfer,refundSigner}) {
    Object.assign(this,{store,env,providers,blocky,inspect,confirm,refundSigner});
    const seed=createHmac('sha256',store.key).update('wikshi-receipts-ed25519-v1').digest();
    this.signingKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
    this.receiptKey=createPublicKey(this.signingKey).export({format:'jwk'});
  }
  services(){return catalog(this.env);}
  authorize(id,credential) {
    const op=this.store.get(id);
    if(!op || op.auth!==hash(credential))throw new ApiError('not_found',404);
    return op;
  }
  view(op) {
    const data=op.data;
    return {id:op.id,service:data.service,status:op.state,createdAt:new Date(op.created).toISOString(),expiresAt:new Date(data.expires).toISOString(),
      result:data.result,inbox:data.inbox,receipt:data.receipt,refund:data.refund?{status:data.refund.status,amountAtomic:data.refund.amount,transaction:data.refund.status==='confirmed'?data.refund.tx:undefined}:undefined,
      error:data.error?{code:data.error}:undefined};
  }
  challenge(op) {return {x402Version:2,resource:{url:`${this.env.WIKSHI_PUBLIC_ORIGIN}/v1/operations/${op.id}/pay`,description:'Wikshi service operation',mimeType:'application/json'},accepts:[op.data.requirements],extensions:{wikshi:{transactionMemo:`wikshi:${op.id}`,operationId:op.id}}};}
  async quote(service,input,credential,idem) {
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(idem||''))throw new ApiError('idempotency_key_required');
    const auth=hash(credential), normalized=validate(service,input), requestHash=hash(JSON.stringify({service,input:normalized}));
    const prior=this.store.find(auth,idem);
    if(prior){if(prior.request_hash!==requestHash)throw new ApiError('idempotency_conflict',409);return prior;}
    const entry=this.services().find(s=>s.id===service && s.enabled);
    if(!entry)throw new ApiError('service_unavailable',503);
    let recipient=input.to||input.phone;
    const ownedInbox=['email.send','email.reply'].includes(service)?this.store.resource(input.inboxId,auth):null;
    if(['email.send','email.reply'].includes(service) && ownedInbox?.kind!=='inbox')throw new ApiError('inbox_not_found',404);
    if(service==='email.inbox' && this.store.inboxes(auth).length)throw new ApiError('inbox_already_available_use_get_inboxes',409);
    if(service==='email.reply'){
      if(!this.store.resource(input.inboxId,auth))throw new ApiError('inbox_not_found',404);
      const message=this.store.message(input.inboxId,input.messageId);
      if(!message || message.direction!=='inbound')throw new ApiError('message_not_found',404);
      recipient=message.replyTo||message.from;
      if(!emailAddress(recipient) || /[\r\n]/.test(message.subject||''))throw new ApiError('invalid_reply_target');
    }
    if(service==='email.send' && !this.store.resource(input.inboxId,auth))throw new ApiError('inbox_not_found',404);
    const amount=(BigInt(entry.rateAtomic)*BigInt(entry.unit==='second'?input.maxSeconds:1)).toString();
    const requirements=await this.blocky.requirements({payTo:this.env.WIKSHI_MERCHANT_ACCOUNT,amount});
    const now=Date.now(), id=randomUUID();
    const op={id,auth,idem,request_hash:requestHash,state:'awaiting_payment',created:now,data:{service,input:normalized,price:entry,requirements,expires:now+300000}};
    return this.store.atomic(()=>{const existing=this.store.find(auth,idem);if(existing){if(existing.request_hash!==requestHash)throw new ApiError('idempotency_conflict',409);return existing;}
      const pending=this.store.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE auth=? AND state='awaiting_payment'").get(auth).n;
      if(pending>=20)throw new ApiError('too_many_pending_quotes',429);
      this.store.insert(op);return op;});
  }
  async pay(id,credential,payload) {
    let op=this.authorize(id,credential);
    if(op.state!=='awaiting_payment')return op;
    if(op.data.expires<Date.now())throw new ApiError('quote_expired',410);
    this.blocky.envelope(payload,op.data.requirements);
    const payment=this.inspect(payload,op.data.requirements,op.id);
    const claimed=this.store.atomic(()=>{
      op=this.store.get(id);if(op.state!=='awaiting_payment')return false;
      if(op.data.expires<Date.now())throw new ApiError('quote_expired',410);
      if(this.store.db.prepare('SELECT tx FROM payments WHERE tx=?').get(payment.tx))throw new ApiError('payment_replayed',409);
      if(!this.services().some(s=>s.id===op.data.service && s.enabled))throw new ApiError('service_unavailable',503);
      this.store.db.prepare('INSERT INTO payments VALUES(?,?)').run(payment.tx,id);
      op.state='verifying_payment';op.data.payment={...payment,payload};this.store.save(op);return true;
    });
    if(!claimed)return op;
    let verified;
    try {verified=await this.blocky.verify(payload,op.data.requirements);if(verified.payer!==payment.payer)throw new Error();}
    catch {op.state='payment_rejected';op.data.error='payment_rejected';this.store.save(op);return op;}
    op.state='settling_payment';this.store.save(op);
    try {
      const settled=await this.blocky.settle(payload,op.data.requirements);
      if(settled.payer!==payment.payer || settled.transaction!==payment.tx)throw new Error();
      op.data.payment.facilitatorConfirmed=true;
    } catch {op.data.payment.facilitatorConfirmed=false;}
    // Independently confirm exact payer, recipient, token and amount on Mirror before dispatch.
    op.state='confirming_payment';this.store.save(op);
    await this.reconcilePayment(op);
    return this.store.get(id);
  }
  async reconcilePayment(op) {
    try {
      if(await this.confirm(op.data.payment.tx,{payer:op.data.payment.payer,payTo:op.data.requirements.payTo,amount:op.data.requirements.amount})) {
        // Grants follow a freshly verified payment signature, never a public transaction ID.
        this.store.atomic(()=>{this.store.bindPayer(op.auth,op.data.payment.payer);op.state='queued';op.data.payment.confirmed=true;delete op.data.payment.payload;this.store.save(op);});
        this.attachInbox(op);
      }
    } catch {/* Mirror lag or outage is not payment failure. */}
  }
  attachInbox(op) {
    const inbox=this.providers.provisionInbox?.(op.data.payment.payer,op.auth,this.store,op.data.input.displayName);
    if(inbox && op.data.inbox?.id!==inbox.id){op.data.inbox={id:inbox.id,address:inbox.address};this.store.save(op);}
  }
  finish(op,result,seconds=undefined) {
    if(seconds!==undefined && (!Number.isFinite(seconds) || seconds<0))throw new Error('Invalid measured duration');
    const prepaid=BigInt(op.data.requirements.amount), rate=BigInt(op.data.price.rateAtomic);
    const units=seconds===undefined?1:Math.min(op.data.input.maxSeconds,Math.ceil(seconds));
    const charged=rate*BigInt(units), returned=prepaid-charged;
    op.state='completed';op.data.result=result;
    const receipt={version:1,operationId:op.id,network:NETWORK,asset:USDC,paymentTransaction:op.data.payment.tx,prepaidAtomic:prepaid.toString(),
      unit:op.data.price.unit,rateAtomic:rate.toString(),units,measuredSeconds:seconds,chargedAtomic:charged.toString(),refundDueAtomic:returned.toString(),
      resultHash:hash(JSON.stringify(result)),issuedAt:new Date().toISOString()};
    const canonical=JSON.stringify(receipt);
    op.data.receipt={...receipt,signature:sign(null,Buffer.from(canonical),this.signingKey).toString('base64'),signedPayload:Buffer.from(canonical).toString('base64')};
    if(returned>0n)op.data.refund={amount:returned.toString(),status:'pending'};
    this.store.save(op);
  }
  fail(op,code='service_execution_failed') {
    op.state='failed';op.data.error=code;op.data.refund={amount:op.data.requirements.amount,status:'pending'};this.store.save(op);
  }
  async dispatch(op) {
    const claimed=this.store.atomic(()=>{
      op=this.store.get(op.id);
      if(op.state!=='queued')return false;
      if(!op.data.payment?.confirmed)throw new Error('Cannot dispatch unpaid operation');
      op.state='dispatching';this.store.save(op);return true;
    });
    if(!claimed)return;
    try {
      this.attachInbox(op);
      const output=await this.providers.execute(op,this.store);
      if(output.resource){this.store.atomic(()=>{this.store.putResource(output.resource.id,op.auth,output.resource);op.data.resourceId=output.resource.id;this.store.save(op);});output.result.inboxId=output.resource.id;}
      if(output.done)this.finish(op,output.result);
      else {
        op.data.private=output.private;
        op.state=output.waiting?'awaiting_guest':'running';
        if(output.waiting){
          const guest=randomBytes(32).toString('base64url');
          op.data.guestExpires=(Date.parse(op.data.input.scheduledAt)||Date.now())+3600000;
          op.data.result={meetingUrl:`${this.env.WIKSHI_PUBLIC_ORIGIN}/meet#${guest}`,scheduledAt:op.data.input.scheduledAt};
          this.store.atomic(()=>{this.store.db.prepare('INSERT INTO guests(hash,operation) VALUES(?,?)').run(hash(guest),op.id);this.store.save(op);});
        } else this.store.save(op);
      }
    } catch(error) {
      if(error.uncertain || !(error.name==='Error' && error.message==='service_execution_failed')) {op.state='execution_unknown';op.data.error='execution_requires_reconciliation';this.store.save(op);}
      else this.fail(op);
    }
  }
  async join(guest) {
    const op=this.store.atomic(()=>{
      const row=this.store.db.prepare('SELECT * FROM guests WHERE hash=?').get(hash(guest));
      if(!row || row.used)throw new ApiError('meeting_unavailable',410);
      const op=this.store.get(row.operation);
      if(op.state!=='awaiting_guest' || op.data.guestExpires<Date.now())throw new ApiError('meeting_unavailable',410);
      if(op.data.input.scheduledAt && Date.parse(op.data.input.scheduledAt)>Date.now()+300000)throw new ApiError('meeting_not_started',409);
      this.store.db.prepare('UPDATE guests SET used=1 WHERE hash=?').run(hash(guest));op.state='joining';this.store.save(op);return op;
    });
    try {
      const output=await this.providers.join(op);op.data.private.callId=output.callId;op.state='running';this.store.save(op);
      return {connection:output.connection,maxSeconds:op.data.input.maxSeconds};
    } catch(error) {
      if(error.name==='Error' && error.message==='service_execution_failed' && !error.uncertain){
        this.fail(op,'meeting_connection_unavailable');op.data.cleanupPending=true;this.store.save(op);
      }else{op.state='execution_unknown';op.data.error='meeting_requires_reconciliation';this.store.save(op);}
      throw new ApiError('meeting_connection_unavailable',503);
    }
  }
  async cancel(id,credential) {
    const op=this.authorize(id,credential);
    if(!['awaiting_payment','queued','awaiting_guest'].includes(op.state))throw new ApiError('cannot_cancel_current_state',409);
    if(op.state==='awaiting_payment'){op.state='cancelled';this.store.save(op);}
    else {this.fail(op,'cancelled');op.data.cleanupPending=Boolean(op.data.private?.agentId);this.store.save(op);}
    return op;
  }
  async refund(op) {
    const r=op.data.refund;if(!r || r.status==='confirmed')return;
    if(r.status==='pending' && this.refundSigner) {
      const prepared=await this.refundSigner.prepare(op.data.payment.payer,r.amount,op.id);
      Object.assign(r,prepared,{status:'submitting'});this.store.save(op);
      try{await this.refundSigner.submit(prepared);}catch{/* Never generate a new transaction to retry. */}
      r.status='confirming';this.store.save(op);
    }
    if(r.tx && await this.confirm(r.tx,{payer:this.env.WIKSHI_MERCHANT_ACCOUNT,payTo:op.data.payment.payer,amount:r.amount})) {
      r.status='confirmed';delete r.bytes;this.store.save(op);
    }
  }
  recover() {
    let pending;
    while((pending=this.store.list(['dispatching','joining','settling_payment','verifying_payment'])).length){
      for(const op of pending){op.state=['dispatching','joining'].includes(op.state)?'execution_unknown':'confirming_payment';this.store.save(op);}
    }
    // Upgrade previously confirmed testnet payers without asking them to pay twice.
    for(const row of this.store.db.prepare('SELECT id FROM operations').all()){
      const op=this.store.get(row.id);
      if(op.data.payment?.confirmed){this.store.bindPayer(op.auth,op.data.payment.payer);this.attachInbox(op);}
    }
  }
  async tick() {
    if(this.busy)return;this.busy=true;
    try {
      for(const candidate of ['confirming_payment','queued','running','awaiting_guest','awaiting_payment'].flatMap(state=>this.store.list([state]))) {
        const op=this.store.get(candidate.id);
        try {
          if(op.state==='confirming_payment')await this.reconcilePayment(op);
          else if(op.state==='queued')await this.dispatch(op);
          else if(op.state==='running') {
            const done=await this.providers.poll(op);
            if(done){
              // Completion and transcript availability can arrive separately. Wait for two
              // identical reads ten seconds apart before archiving and deleting the agent.
              if(done.seconds>0 && done.transcript.length===0)continue;
              const fingerprint=hash(JSON.stringify(done.transcript));
              if(op.data.transcriptCandidate!==fingerprint){op.data.transcriptCandidate=fingerprint;op.data.transcriptObservedAt=Date.now();this.store.save(op);continue;}
              if(Date.now()-op.data.transcriptObservedAt<10000)continue;
              this.finish(op,{transcript:done.transcript},done.seconds);op.data.cleanupPending=Boolean(op.data.private?.agentId);this.store.save(op);
            }
          } else if(op.state==='awaiting_guest' && op.data.guestExpires<Date.now()){this.fail(op,'meeting_expired');op.data.cleanupPending=true;this.store.save(op);}
          else if(op.state==='awaiting_payment' && op.data.expires<Date.now()){op.state='expired';this.store.save(op);}
        } catch {/* Keep durable state for the next read-only reconciliation. */}
        this.store.db.prepare('UPDATE operations SET updated=? WHERE id=?').run(Date.now(),op.id);
      }
      // Scan pending work, not the first N historical completed operations.
      const rows=this.store.db.prepare("SELECT id FROM operations WHERE state IN ('completed','failed')").all();
      for(const {id} of rows){const op=this.store.get(id);try {await this.refund(op);if(op.data.cleanupPending){await this.providers.cleanup(op);op.data.cleanupPending=false;this.store.save(op);}}catch{}}
    } finally {this.busy=false;}
  }
}
