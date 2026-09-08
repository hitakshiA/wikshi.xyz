import {randomUUID,randomBytes,createPrivateKey,createPublicKey,sign,createHmac} from 'node:crypto';
import {hash} from './store.mjs';
import {ApiError,catalog,validate,emailAddress} from './catalog.mjs';
import {Blocky,NETWORK,ASSETS} from './payments/blocky.mjs';
import {inspectPayment,confirmTransfer} from './payments/hedera.mjs';
import {cancelUnpaidOperation,cancelResearchOperation,isResearchService} from './cancel.mjs';

export class Engine {
  constructor({store,env,providers,blocky=new Blocky(),inspect=inspectPayment,confirm=confirmTransfer,refundSigner}) {
    Object.assign(this,{store,env,providers,blocky,inspect,confirm,refundSigner});
    this.researchTimers=new Map();this.researchControllers=new Map();this.cancelWork=new Map();this.refundWork=new Map();this.confirmWork=new Map();
    const seed=createHmac('sha256',store.key).update('wikshi-receipts-ed25519-v1').digest();
    this.signingKey=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
    this.receiptKey=createPublicKey(this.signingKey).export({format:'jwk'});
  }
  clearResearchDeadline(id){clearTimeout(this.researchTimers.get(id));this.researchTimers.delete(id);}
  armResearchDeadline(op){
    if(!isResearchService(op.data.service)||!Number.isFinite(op.data.researchDeadlineAt)||['completed','cancelled','failed','expired','payment_rejected'].includes(op.state))return;
    this.clearResearchDeadline(op.id);
    const timer=setTimeout(()=>{try{this.refreshResearch(op);void this.reconcileResearchCancellations();}catch{}},Math.max(0,op.data.researchDeadlineAt-Date.now()));
    timer.unref?.();this.researchTimers.set(op.id,timer);
  }
  cancelledResearchReceipt(op){
    if(!op.data.payment?.confirmed)return;
    op.data.cancellation.paymentStatus='confirmed';
    if(!op.data.receipt){
      const receipt={version:1,operationId:op.id,network:NETWORK,...ASSETS[op.data.requirements.asset],paymentTransaction:op.data.payment.tx,
        prepaidAtomic:op.data.requirements.amount,unit:op.data.price.unit,rateAtomic:op.data.price.rateAtomic,units:0,chargedAtomic:'0',refundDueAtomic:op.data.requirements.amount,
        resultHash:hash(JSON.stringify(null)),outcome:'cancelled',cancellationReason:op.data.cancellation.reason,issuedAt:new Date().toISOString()};
      const canonical=JSON.stringify(receipt);
      op.data.receipt={...receipt,signature:sign(null,Buffer.from(canonical),this.signingKey).toString('base64'),signedPayload:Buffer.from(canonical).toString('base64')};
    }
    if(!op.data.refund)op.data.refund={amount:op.data.requirements.amount,status:'pending'};
  }
  refreshResearch(op){
    if(!isResearchService(op.data.service))return op;
    let current=this.store.get(op.id)||op;
    if(Number.isFinite(current.data.researchDeadlineAt) && current.data.researchDeadlineAt<=Date.now() && !['completed','cancelled','failed','expired','payment_rejected'].includes(current.state)){
      current=cancelResearchOperation(this.store,current.id,null,{reason:'timeout',internal:true,receipt:value=>this.cancelledResearchReceipt(value)});
    }
    if(current.state==='cancelled'){
      this.clearResearchDeadline(current.id);this.researchControllers.get(current.id)?.abort();
    }
    return current;
  }
  sweepResearchDeadlines(){
    for(const row of this.store.db.prepare("SELECT id FROM operations WHERE state NOT IN ('completed','cancelled','failed','expired','payment_rejected')").all())this.refreshResearch(this.store.get(row.id));
  }
  async reconcileResearchCancellations(){
    const work=[];
    for(const {id} of this.store.db.prepare("SELECT id FROM operations WHERE state='cancelled'").all()){
      const op=this.store.get(id);if(!isResearchService(op.data.service)||!op.data.payment||op.data.refund?.status==='confirmed')continue;
      if(this.cancelWork.has(id)){work.push(this.cancelWork.get(id));continue;}
      const task=Promise.resolve().then(async()=>{try{if(!op.data.payment.confirmed)await this.reconcilePayment(op);const current=this.store.get(id);if(current.data.payment?.confirmed)await this.refund(current);}catch{}}).finally(()=>this.cancelWork.delete(id));
      this.cancelWork.set(id,task);work.push(task);
    }
    await Promise.all(work);
  }
  services(){return catalog(this.env);}
  authorize(id,credential) {
    const op=this.store.get(id);
    if(!op || op.auth!==hash(credential))throw new ApiError('not_found',404);
    return this.refreshResearch(op);
  }
  view(op) {
    op=this.refreshResearch(op);
    const data=op.data;
    return {id:op.id,service:data.service,status:op.state,createdAt:new Date(op.created).toISOString(),expiresAt:new Date(data.expires).toISOString(),
      researchStartedAt:Number.isFinite(data.researchStartedAt)?new Date(data.researchStartedAt).toISOString():undefined,
      researchDeadlineAt:Number.isFinite(data.researchDeadlineAt)?new Date(data.researchDeadlineAt).toISOString():undefined,cancellation:data.cancellation,
      paymentOptions:(data.offers||[{requirements:data.requirements,price:data.price}]).map(o=>({...ASSETS[o.requirements.asset],amountAtomic:o.requirements.amount,rateAtomic:o.price.rateAtomic})),
      payment:data.payment?{...ASSETS[data.requirements.asset],amountAtomic:data.requirements.amount,confirmed:data.payment.confirmed===true}:undefined,
      result:data.result,inbox:data.inbox,receipt:data.receipt,refund:data.refund?{...ASSETS[data.requirements.asset],status:data.refund.status,amountAtomic:data.refund.amount,transaction:data.refund.status==='confirmed'?data.refund.tx:undefined}:undefined,
      error:data.error?{code:data.error}:undefined};
  }
  challenge(op) {return {x402Version:2,resource:{url:`${this.env.WIKSHI_PUBLIC_ORIGIN}/v1/operations/${op.id}/pay`,description:'Wikshi service operation',mimeType:'application/json'},accepts:op.data.offers?.map(o=>o.requirements)||[op.data.requirements],extensions:{wikshi:{transactionMemo:`wikshi:${op.id}`,operationId:op.id}}};}
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
    const offers=await Promise.all(entry.prices.map(async price=>({
      requirements:await this.blocky.requirements({payTo:this.env.WIKSHI_MERCHANT_ACCOUNT,asset:price.asset,amount:(BigInt(price.rateAtomic)*BigInt(entry.unit==='second'?input.maxSeconds:1)).toString()}),
      price:{...price,unit:entry.unit},
    })));
    const {requirements,price}=offers[0];
    const now=Date.now(), id=randomUUID();
    const op={id,auth,idem,request_hash:requestHash,state:'awaiting_payment',created:now,data:{service,input:normalized,price,requirements,offers,expires:now+300000}};
    return this.store.atomic(()=>{const existing=this.store.find(auth,idem);if(existing){if(existing.request_hash!==requestHash)throw new ApiError('idempotency_conflict',409);return existing;}
      if(service==='email.inbox'){
        if(this.store.primaryInbox(auth))throw new ApiError('inbox_already_available_use_get_inboxes',409);
        const active=this.store.db.prepare("SELECT id FROM operations WHERE auth=? AND state NOT IN ('completed','failed','cancelled','expired','payment_rejected')").all(auth);
        if(active.some(row=>this.store.get(row.id).data.service==='email.inbox'))throw new ApiError('inbox_creation_in_progress',409);
      }
      const pending=this.store.db.prepare("SELECT COUNT(*) AS n FROM operations WHERE auth=? AND state='awaiting_payment'").get(auth).n;
      if(pending>=20)throw new ApiError('too_many_pending_quotes',429);
      this.store.insert(op);return op;});
  }
  async pay(id,credential,payload) {
    let op=this.authorize(id,credential);
    if(op.state!=='awaiting_payment')return op;
    if(op.data.expires<Date.now())throw new ApiError('quote_expired',410);
    const selected=(op.data.offers||[{requirements:op.data.requirements,price:op.data.price}]).find(o=>o.requirements.asset===(payload?.accepted?.asset??op.data.requirements.asset));
    if(!selected)throw new ApiError('payment_asset_not_offered');
    this.blocky.envelope(payload,selected.requirements);
    const payment=this.inspect(payload,selected.requirements,op.id);
    const claimed=this.store.atomic(()=>{
      op=this.store.get(id);if(op.state!=='awaiting_payment')return false;
      if(op.data.expires<Date.now())throw new ApiError('quote_expired',410);
      if(op.data.service==='email.inbox' && this.store.primaryInbox(op.auth))throw new ApiError('inbox_already_available_use_get_inboxes',409);
      if(this.store.db.prepare('SELECT tx FROM payments WHERE tx=?').get(payment.tx))throw new ApiError('payment_replayed',409);
      if(!this.services().some(s=>s.id===op.data.service && s.enabled))throw new ApiError('service_unavailable',503);
      this.store.db.prepare('INSERT INTO payments VALUES(?,?)').run(payment.tx,id);
      op.data.requirements=selected.requirements;op.data.price=selected.price;
      if(isResearchService(op.data.service)){op.data.researchStartedAt=Date.now();op.data.researchDeadlineAt=op.data.researchStartedAt+120000;}
      op.state='verifying_payment';op.data.payment={...payment,payload};this.store.save(op);return true;
    });
    if(!claimed)return op;
    this.armResearchDeadline(op);
    let verified;
    try {verified=await this.blocky.verify(payload,op.data.requirements);if(verified.payer!==payment.payer)throw new Error();}
    catch {op=this.refreshResearch(this.store.get(id));if(op.state==='cancelled')return op;op.state='payment_rejected';op.data.error='payment_rejected';this.store.save(op);this.clearResearchDeadline(id);return op;}
    op=this.refreshResearch(this.store.get(id));if(op.state==='cancelled')return op;
    op.state='settling_payment';this.store.save(op);
    let facilitatorConfirmed=false;
    try {
      const settled=await this.blocky.settle(payload,op.data.requirements);
      if(settled.payer!==payment.payer || settled.transaction!==payment.tx)throw new Error();
      facilitatorConfirmed=true;
    } catch {/* Independent confirmation determines whether payment actually arrived. */}
    op=this.refreshResearch(this.store.get(id));op.data.payment.facilitatorConfirmed=facilitatorConfirmed;
    // Independently confirm exact payer, recipient, token and amount on Mirror before dispatch.
    if(op.state!=='cancelled')op.state='confirming_payment';this.store.save(op);
    await this.reconcilePayment(op);
    if(this.store.get(id).state==='cancelled')void this.reconcileResearchCancellations();
    return this.store.get(id);
  }
  async reconcilePayment(op) {
    if(this.confirmWork.has(op.id))return this.confirmWork.get(op.id);
    const task=Promise.resolve().then(async()=>{try{
      op=this.refreshResearch(this.store.get(op.id));
      if(!op.data.payment || op.data.payment.confirmed)return;
      if(await this.confirm(op.data.payment.tx,{payer:op.data.payment.payer,payTo:op.data.requirements.payTo,amount:op.data.requirements.amount,asset:op.data.requirements.asset,memo:`wikshi:${op.id}`})){
        op=this.refreshResearch(this.store.get(op.id));
        // Re-read after network I/O so cancellation and completion cannot be
        // overwritten by an older verification promise.
        this.store.atomic(()=>{op=this.store.get(op.id);if(op.data.payment.confirmed)return;
          this.store.bindPayer(op.auth,op.data.payment.payer);op.data.payment.confirmed=true;delete op.data.payment.payload;
          if(op.state==='cancelled' && isResearchService(op.data.service))this.cancelledResearchReceipt(op);
          else op.state='queued';this.store.save(op);});
        this.attachInbox(op);
      }
    }catch{/* Mirror lag or outage is not payment failure. */}}).finally(()=>this.confirmWork.delete(op.id));
    this.confirmWork.set(op.id,task);return task;
  }
  attachInbox(op) {
    // A research, contact or conversation purchase can recover access to an
    // existing payer inbox, but only email.inbox is allowed to create one.
    const inbox=this.store.primaryInbox(op.auth);
    if(inbox && op.data.inbox?.id!==inbox.id){op.data.inbox={id:inbox.id,address:inbox.address};this.store.save(op);}
  }
  finish(op,result,seconds=undefined) {
    if(isResearchService(op.data.service)){op=this.refreshResearch(op);if(op.state==='cancelled')return op;this.clearResearchDeadline(op.id);}
    if(seconds!==undefined && (!Number.isFinite(seconds) || seconds<0))throw new Error('Invalid measured duration');
    const prepaid=BigInt(op.data.requirements.amount), rate=BigInt(op.data.price.rateAtomic);
    const units=seconds===undefined?1:Math.min(op.data.input.maxSeconds,Math.ceil(seconds));
    const charged=rate*BigInt(units), returned=prepaid-charged;
    op.state='completed';op.data.result=result;
    const receipt={version:1,operationId:op.id,network:NETWORK,...ASSETS[op.data.requirements.asset],paymentTransaction:op.data.payment.tx,prepaidAtomic:prepaid.toString(),
      unit:op.data.price.unit,rateAtomic:rate.toString(),units,measuredSeconds:seconds,chargedAtomic:charged.toString(),refundDueAtomic:returned.toString(),
      resultHash:hash(JSON.stringify(result)),issuedAt:new Date().toISOString()};
    const canonical=JSON.stringify(receipt);
    op.data.receipt={...receipt,signature:sign(null,Buffer.from(canonical),this.signingKey).toString('base64'),signedPayload:Buffer.from(canonical).toString('base64')};
    if(returned>0n)op.data.refund={amount:returned.toString(),status:'pending'};
    this.store.save(op);
  }
  fail(op,code='service_execution_failed') {
    if(isResearchService(op.data.service)){op=this.refreshResearch(op);if(op.state==='cancelled')return op;this.clearResearchDeadline(op.id);}
    op.state='failed';op.data.error=code;op.data.refund={amount:op.data.requirements.amount,status:'pending'};this.store.save(op);
  }
  async dispatch(op) {
    op=this.refreshResearch(op);
    const claimed=this.store.atomic(()=>{
      op=this.store.get(op.id);
      if(op.state!=='queued')return false;
      if(!op.data.payment?.confirmed)throw new Error('Cannot dispatch unpaid operation');
      op.state='dispatching';this.store.save(op);return true;
    });
    if(!claimed)return;
    const controller=isResearchService(op.data.service)?new AbortController():null;
    if(controller)this.researchControllers.set(op.id,controller);
    try {
      this.attachInbox(op);
      const output=await this.providers.execute(op,this.store,{signal:controller?.signal});
      op=this.refreshResearch(this.store.get(op.id));if(op.state==='cancelled')return;
      if(op.data.service==='email.inbox')this.attachInbox(op);
      if(output.resource){this.store.atomic(()=>{this.store.putResource(output.resource.id,op.auth,output.resource);op.data.resourceId=output.resource.id;this.store.save(op);});output.result.inboxId=output.resource.id;}
      if(output.done)this.finish(op,output.result);
      else {
        op.data.private=output.private;
        op.state=output.waiting?'awaiting_guest':'running';
        if(output.waiting){
          const guest=randomBytes(32).toString('base64url');
          op.data.guestExpires=(Date.parse(op.data.input.scheduledAt)||Date.now())+3600000;
          op.data.result={meetingUrl:output.private.hosted?`https://bey.chat/${output.private.agentId}`:`${this.env.WIKSHI_PUBLIC_ORIGIN}/meet#${guest}`,scheduledAt:op.data.input.scheduledAt,
            ...(output.private.hosted?{admission:'provider_hosted_not_strictly_one_use'}:{})};
          this.store.atomic(()=>{this.store.db.prepare('INSERT INTO guests(hash,operation) VALUES(?,?)').run(hash(guest),op.id);this.store.save(op);});
        } else this.store.save(op);
      }
    } catch(error) {
      op=this.refreshResearch(this.store.get(op.id));if(op.state==='cancelled')return;
      if(error.uncertain || !(error.name==='Error' && error.message==='service_execution_failed')) {op.state='execution_unknown';op.data.error='execution_requires_reconciliation';this.store.save(op);}
      else this.fail(op);
    }finally{this.researchControllers.delete(op.id);}
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
  async cancel(id,credential,reason='user') {
    if(!['user','timeout'].includes(reason))throw new ApiError('invalid_cancellation_reason');
    const op=this.authorize(id,credential);
    if(!isResearchService(op.data.service)){if(reason==='timeout')throw new ApiError('cannot_cancel_current_state',409);return cancelUnpaidOperation(this.store,id,credential);}
    const cancelled=cancelResearchOperation(this.store,id,credential,{reason,receipt:value=>this.cancelledResearchReceipt(value)});
    this.clearResearchDeadline(id);this.researchControllers.get(id)?.abort();
    void this.reconcileResearchCancellations();return cancelled;
  }
  async refund(op) {
    const id=op.id;if(this.refundWork.has(id))return this.refundWork.get(id);
    const task=Promise.resolve().then(async()=>{
      op=this.store.get(id);let r=op.data.refund;if(!r || r.status==='confirmed')return;
      if(r.status==='pending' && this.refundSigner){
        const prepared=await this.refundSigner.prepare(op.data.payment.payer,r.amount,id,op.data.requirements.asset);
        op=this.store.get(id);r=op.data.refund;if(r.status!=='pending')return;
        Object.assign(r,prepared,{status:'submitting'});this.store.save(op);
        try{await this.refundSigner.submit(prepared);}catch{/* Never generate a new transaction to retry. */}
        op=this.store.get(id);r=op.data.refund;if(r.tx===prepared.tx && r.status==='submitting'){r.status='confirming';this.store.save(op);}
      }
      const tx=r.tx;
      if(tx && await this.confirm(tx,{payer:this.env.WIKSHI_MERCHANT_ACCOUNT,payTo:op.data.payment.payer,amount:r.amount,asset:op.data.requirements.asset,memo:`refund:${id}`})){
        op=this.store.get(id);r=op.data.refund;if(r.tx!==tx)return;
        r.status='confirmed';delete r.bytes;this.store.save(op);
      }
    }).finally(()=>this.refundWork.delete(id));
    this.refundWork.set(id,task);return task;
  }
  recover() {
    let pending;
    while((pending=this.store.list(['dispatching','joining','settling_payment','verifying_payment'])).length){
      for(const op of pending){op.state=['dispatching','joining'].includes(op.state)?'execution_unknown':'confirming_payment';this.store.save(op);}
    }
    // Restore access grants to existing inboxes, without creating mailboxes for
    // historical research or conversation purchases during a restart.
    for(const row of this.store.db.prepare('SELECT id FROM operations').all()){
      let op=this.store.get(row.id);
      if(isResearchService(op.data.service) && op.data.payment && !['completed','cancelled','failed','expired','payment_rejected'].includes(op.state)){
        if(!Number.isFinite(op.data.researchDeadlineAt)){op.data.researchStartedAt=Date.now();op.data.researchDeadlineAt=op.data.researchStartedAt+120000;this.store.save(op);}
        op=this.refreshResearch(op);this.armResearchDeadline(op);
      }
      if(op.data.payment?.confirmed){this.store.bindPayer(op.auth,op.data.payment.payer);this.attachInbox(op);}
    }
    void this.reconcileResearchCancellations();
  }
  async tick() {
    // The independent server interval invokes this even while a previous tick
    // is blocked on a provider. Timers enforce the exact research deadline;
    // this sweep and independent refund work also recover across restarts.
    this.sweepResearchDeadlines();void this.reconcileResearchCancellations();
    if(this.busy)return;this.busy=true;
    try {
      for(const candidate of ['confirming_payment','queued','running','awaiting_guest','awaiting_payment'].flatMap(state=>this.store.list([state]))) {
        let op=this.store.get(candidate.id);
        try {
          if(op.state==='confirming_payment')await this.reconcilePayment(op);
          else if(op.state==='queued')await this.dispatch(op);
          else if(op.state==='running') {
            const done=await this.providers.poll(op);
            op=this.refreshResearch(this.store.get(op.id));if(op.state!=='running')continue;
            if(done){
              // Completion and transcript availability can arrive separately. Wait for two
              // identical reads ten seconds apart before archiving and deleting the agent.
              if(done.seconds>0 && done.transcript.length===0)continue;
              const fingerprint=hash(JSON.stringify(done.transcript));
              if(op.data.transcriptCandidate!==fingerprint){op.data.transcriptCandidate=fingerprint;op.data.transcriptObservedAt=Date.now();this.store.save(op);continue;}
              if(Date.now()-op.data.transcriptObservedAt<10000)continue;
              this.finish(op,{transcript:done.transcript},done.seconds);op=this.store.get(op.id);
              if(op.state==='cancelled')continue;
              op.data.cleanupPending=Boolean(op.data.private?.agentId);this.store.save(op);
            }
          } else if(op.state==='awaiting_guest'){
            // Hosted admission happens on bey.chat, not through our join endpoint.
            const callId=op.data.private?.hosted?await this.providers.findHostedCall(op):null;
            if(callId){op.data.private.callId=callId;op.state='running';this.store.save(op);}
            else if(op.data.guestExpires<Date.now()){this.fail(op,'meeting_expired');op.data.cleanupPending=true;this.store.save(op);}
          }
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
