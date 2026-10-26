import assert from 'node:assert/strict';
import {load} from 'cheerio';
const origin=process.env.WIKSHI_VERIFY_ORIGIN||'http://127.0.0.1:3000';
const navPaths=['/docs','/services','/metering','/use-cases','/stack'];
const detailPaths=['discovery','enrichment','email-inboxes','phone-calls','video-meetings','workflow-skill','data-handling','usage-guidelines','integration-status','payment-design','responsible-use'].map(p=>'/'+p);
const paths=['/',...navPaths,...detailPaths];
const pages=new Map();
for(const path of paths){const response=await fetch(origin+path);assert.equal(response.status,200,path);const $=load(await response.text());$('script,style').remove();pages.set(path,$);assert.equal($('h1').length,1,path);assert(!$('body').text().includes('—'),`${path}: em dash`);for(const href of navPaths)assert($(`header a[href="${href}"]`).length,`${path}: navigation ${href}`);for(const href of detailPaths)assert($(`footer a[href="${href}"]`).length,`${path}: footer ${href}`);}
const assets=new Set();
for(const [path,$] of pages){for(const el of $('a[href]').toArray()){const href=$(el).attr('href');if(!href.startsWith('/')&&!href.startsWith('#'))continue;const url=new URL(href,origin+path);const target=pages.get(url.pathname);if(target&&url.hash)assert(target(`[id="${url.hash.slice(1)}"]`).length,`${path}: missing anchor ${href}`);}for(const img of $('img[src]').toArray())assets.add($(img).attr('src'));}
for(const asset of assets){const r=await fetch(new URL(asset,origin),{method:'HEAD'});assert.equal(r.status,200,asset);}
assert(pages.get('/')('.testnet-cta').text().includes('Try now for free'));
const home=pages.get('/');assert.equal(home('#meetings video[autoplay][loop][muted]').length,1);assert.equal(home('#meetings video[controls],#meetings .wikshi-eyebrow,#meetings .meeting-usecases,#meetings .wikshi-text-link,#metering .wikshi-eyebrow,.metering-status').length,0);
assert.equal(pages.get('/use-cases')('.workflow-brief').length,6);
assert.equal((await fetch(origin+'/not-a-real-page')).status,404);
for(const path of ['/','/metering']){const $=pages.get(path);assert(!$('.metering-example').text().includes('HBAR'));assert($('.metering-example').text().includes('USDC'));}
console.log(`PASS: ${pages.size} routes, navigation, local anchors, ${assets.size} assets, hero CTA, USDC calculator, no em dashes.`);
