import {randomBytes, randomUUID} from 'node:crypto';

export class SessionError extends Error {
  constructor(code, status=400) { super(code); this.status=status; }
}

// Deliberately no disk-backed transcript or global chat index.
export class Sessions {
  constructor({ttl=120_000, capacity=30, now=Date.now}={}) {
    Object.assign(this,{ttl,capacity,now}); this.items=new Map();
  }
  create() {
    this.sweep();
    if(this.items.size>=this.capacity) throw new SessionError('Please try again shortly.',503);
    const id=randomUUID(), token=randomBytes(32).toString('base64url');
    const s={id,token,credential:randomBytes(32).toString('base64url'),lastSeen:this.now(),busy:false,operations:new Map(),agent:null};
    this.items.set(token,s); return s;
  }
  get(token) {
    const s=this.items.get(token);
    if(!s || this.now()-s.lastSeen>this.ttl) {if(s)this.close(token);throw new SessionError('This chat has ended. Start a new chat.',401);}
    s.lastSeen=this.now();return s;
  }
  async exclusive(token, fn) {
    const s=this.get(token);
    if(s.busy)throw new SessionError('Wait for the current response to finish.',409);
    s.busy=true;try{return await fn(s);}finally{s.busy=false;}
  }
  close(token) {const s=this.items.get(token);s?.agent?.abort('Chat closed');this.items.delete(token);}
  sweep() {for(const[token,s]of this.items)if(this.now()-s.lastSeen>this.ttl)this.close(token);}
}
