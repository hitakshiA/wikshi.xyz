import {DatabaseSync} from 'node:sqlite';
import {createHash, randomBytes, createCipheriv, createDecipheriv} from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export class Store {
  constructor(path, key) {
    if (!/^[a-f0-9]{64}$/i.test(key || '')) throw new Error('WIKSHI_DATA_KEY must be 32 bytes of hex');
    this.key = Buffer.from(key, 'hex');
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY, auth TEXT NOT NULL, idem TEXT NOT NULL, request_hash TEXT NOT NULL,
        state TEXT NOT NULL, created INTEGER NOT NULL, updated INTEGER NOT NULL, data TEXT NOT NULL,
        UNIQUE(auth, idem));
      CREATE TABLE IF NOT EXISTS payments (tx TEXT PRIMARY KEY, operation TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS guests (hash TEXT PRIMARY KEY, operation TEXT NOT NULL UNIQUE, used INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, auth TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resource_grants (resource TEXT NOT NULL, auth TEXT NOT NULL, PRIMARY KEY(resource,auth));
      CREATE TABLE IF NOT EXISTS explicit_inbox_access (resource TEXT NOT NULL, auth TEXT NOT NULL, PRIMARY KEY(resource,auth));
      CREATE TABLE IF NOT EXISTS payer_inboxes (payer TEXT PRIMARY KEY, resource TEXT NOT NULL UNIQUE, address_hash TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS inbox_aliases (address_hash TEXT PRIMARY KEY, resource TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS verified_payers (auth TEXT NOT NULL, payer TEXT NOT NULL, PRIMARY KEY(auth,payer));
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, inbox TEXT NOT NULL, source TEXT NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(inbox,source));
      CREATE TABLE IF NOT EXISTS mail_events (id TEXT PRIMARY KEY, received INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL, state TEXT NOT NULL, at INTEGER NOT NULL);
    `);
  }
  seal(value, aad) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  open(value, aad) {
    const bytes = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0,12));
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
  }
  atomic(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value=fn(); this.db.exec('COMMIT'); return value; } catch(e) {this.db.exec('ROLLBACK');throw e;} }
  get(id) { const row=this.db.prepare('SELECT * FROM operations WHERE id=?').get(id); return row ? {...row,data:this.open(row.data,row.id)} : null; }
  find(auth, idem) { const row=this.db.prepare('SELECT id FROM operations WHERE auth=? AND idem=?').get(auth,idem); return row && this.get(row.id); }
  insert(op) {
    this.db.prepare('INSERT INTO operations VALUES (?,?,?,?,?,?,?,?)').run(op.id,op.auth,op.idem,op.request_hash,op.state,op.created,op.created,this.seal(op.data,op.id));
    this.event(op.id,op.state);
  }
  save(op) {
    this.db.prepare('UPDATE operations SET state=?,updated=?,data=? WHERE id=?').run(op.state,Date.now(),this.seal(op.data,op.id),op.id);
    this.event(op.id,op.state);
  }
  event(id,state) {this.db.prepare('INSERT INTO events(operation,state,at) VALUES(?,?,?)').run(id,state,Date.now());}
  list(states) {return this.db.prepare(`SELECT id FROM operations WHERE state IN (${states.map(()=>'?').join(',')}) ORDER BY updated LIMIT 30`).all(...states).map(row=>this.get(row.id));}
  resource(id, auth) {const row=this.db.prepare('SELECT data FROM resources WHERE id=? AND (auth=? OR EXISTS(SELECT 1 FROM resource_grants WHERE resource=resources.id AND auth=?))').get(id,auth,auth);if(!row)return null;const value=this.open(row.data,id);return value.kind==='inbox'&&!this.db.prepare('SELECT 1 FROM explicit_inbox_access WHERE resource=? AND auth=?').get(id,auth)?null:value;}
  putResource(id, auth, data) {this.db.prepare('INSERT INTO resources VALUES(?,?,?)').run(id,auth,this.seal(data,id));}
  bindPayer(auth,payer) {
    this.db.prepare('INSERT OR IGNORE INTO verified_payers VALUES(?,?)').run(auth,payer);
    // Payment identity is not an inbox purchase or authorization.
  }
  authorizeInbox(id,auth) {
    this.db.prepare('INSERT OR IGNORE INTO resource_grants VALUES(?,?)').run(id,auth);
    this.db.prepare('INSERT OR IGNORE INTO explicit_inbox_access VALUES(?,?)').run(id,auth);
  }
  payerInbox(payer) {
    const row=this.db.prepare('SELECT r.id,r.data FROM resources r JOIN payer_inboxes p ON p.resource=r.id WHERE p.payer=?').get(payer);
    return row?this.open(row.data,row.id):null;
  }
  createPayerInbox(payer,auth,resource) {
    return this.atomic(()=>{
      const primary=this.primaryInbox(auth);if(primary)return primary;
      let inbox=this.payerInbox(payer);
      if(!inbox){this.putResource(resource.id,auth,resource);this.db.prepare('INSERT INTO payer_inboxes VALUES(?,?,?)').run(payer,resource.id,hash(resource.address.toLowerCase()));inbox=resource;}
      this.authorizeInbox(inbox.id,auth);
      return inbox;
    });
  }
  inboxForAddress(address) {
    const digest=hash(address.toLowerCase());
    const row=this.db.prepare('SELECT r.id,r.data FROM resources r WHERE r.id IN (SELECT resource FROM payer_inboxes WHERE address_hash=? UNION SELECT resource FROM inbox_aliases WHERE address_hash=?)').get(digest,digest);
    return row?this.open(row.data,row.id):null;
  }
  renameInbox(payer,address) {
    return this.atomic(()=>{
      const inbox=this.payerInbox(payer);if(!inbox)throw new Error('inbox_not_found');
      const occupied=this.inboxForAddress(address);if(occupied && occupied.id!==inbox.id)throw new Error('address_unavailable');
      this.db.prepare('INSERT OR IGNORE INTO inbox_aliases VALUES(?,?)').run(hash(inbox.address.toLowerCase()),inbox.id);
      inbox.address=address.toLowerCase();
      this.db.prepare('UPDATE resources SET data=? WHERE id=?').run(this.seal(inbox,inbox.id),inbox.id);
      this.db.prepare('UPDATE payer_inboxes SET address_hash=? WHERE payer=?').run(hash(inbox.address),payer);
      return inbox;
    });
  }
  inboxes(auth) {return this.db.prepare("SELECT id,data FROM resources WHERE EXISTS(SELECT 1 FROM explicit_inbox_access WHERE resource=resources.id AND auth=?) ORDER BY resources.rowid").all(auth).map(r=>this.open(r.data,r.id)).filter(r=>r.kind==='inbox').map(r=>({id:r.id,address:r.address,displayName:r.displayName}));}
  primaryInbox(auth) {const inbox=this.inboxes(auth)[0];return inbox?this.resource(inbox.id,auth):null;}
  putMessage(inbox,source,data) {
    const id=hash(`${inbox}:${source}`).slice(0,32).replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5');
    this.db.prepare('INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?)').run(id,inbox,source,Date.now(),this.seal({...data,id},id));return id;
  }
  messages(inbox,before=Number.MAX_SAFE_INTEGER) {return this.db.prepare('SELECT id,data,rowid AS cursor FROM messages WHERE inbox=? AND rowid<? ORDER BY rowid DESC LIMIT 20').all(inbox,before).map(r=>({...this.open(r.data,r.id),cursor:r.cursor}));}
  message(inbox,id) {const r=this.db.prepare('SELECT data FROM messages WHERE inbox=? AND id=?').get(inbox,id);return r?this.open(r.data,id):null;}
  close() {this.db.close();}
}
