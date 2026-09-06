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
  resource(id, auth) {const row=this.db.prepare('SELECT data FROM resources WHERE id=? AND auth=?').get(id,auth);return row ? this.open(row.data,id) : null;}
  putResource(id, auth, data) {this.db.prepare('INSERT INTO resources VALUES(?,?,?)').run(id,auth,this.seal(data,id));}
  close() {this.db.close();}
}
