import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium, webkit} = createRequire(import.meta.url)('playwright');
const base = process.env.WIKSHI_BROWSER_TEST_URL || 'http://127.0.0.1:5188';

for (const [engine, sizes] of [[chromium, [[320,740],[390,844],[768,1024],[1440,900]]], [webkit, [[390,844]]]]) {
  const browser = await engine.launch();
  try {
    for (const [width,height] of sizes) {
      const page = await browser.newPage({viewport:{width,height}, hasTouch:width<768});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(() => Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{
        if(window.failCopy)throw Error('Clipboard unavailable');
        window.copiedPrompt=text;
      }}}));
      await page.goto(base, {waitUntil:'load'});
      const selected=()=>page.locator('.agent-card[aria-checked="true"]');
      assert.equal(await selected().getAttribute('aria-label'),'Any agent');
      assert.equal(await page.locator('.agent-step, .agent-selection, .agent-picker-help').count(),0);
      const cta=await page.getByRole('link',{name:'Try now for free'}).boundingBox();
      const separator=await page.locator('.agent-picker-or').boundingBox();
      const intro=await page.locator('.agent-picker-intro').boundingBox();
      assert.equal(await page.locator('.agent-picker-or').textContent(),'or');
      assert.ok(cta.y+cta.height<=separator.y&&separator.y+separator.height<=intro.y);
      // All seven agents are reachable by tapping exposed cards, without arrows.
      for(const name of ['Hermes','OpenClaw','Claude Code','Codex','OpenCode','DeepSeek Harness','Any agent']) {
        await page.waitForTimeout(500);
        const card=page.getByRole('radio',{name,exact:true});
        const options={position:{x:105,y:70}};
        if(width<768)await card.tap(options);else await card.click(options);
        assert.equal(await selected().getAttribute('aria-label'),name);
      }
      await selected().focus();await page.keyboard.press('End');
      assert.equal(await selected().getAttribute('aria-label'),'DeepSeek Harness');
      await page.keyboard.press('ArrowRight');
      assert.equal(await selected().getAttribute('aria-label'),'Any agent');
      assert.equal(await selected().evaluate(el=>el===document.activeElement),true);
      // A real tap/click on an exposed side card must select it, not its parent.
      const side=page.getByRole('radio',{name:'Hermes',exact:true});
      await page.waitForTimeout(500);
      await side.click({position:{x:105,y:70}});
      assert.equal(await selected().getAttribute('aria-label'),'Hermes');
      const stage=await page.locator('.agent-deck').boundingBox();
      await page.mouse.move(stage.x+stage.width/2,stage.y+90);
      await page.mouse.down();await page.mouse.move(stage.x+stage.width/2-80,stage.y+95,{steps:5});await page.mouse.up();
      assert.equal(await selected().getAttribute('aria-label'),'OpenClaw');
      await page.getByRole('button',{name:'Copy prompt',exact:true}).click();
      await page.getByRole('button',{name:'Prompt copied',exact:true}).waitFor();
      assert.ok(await page.evaluate(()=>window.copiedPrompt.includes('https://wikshi.xyz/wikshi/skills.md')&&window.copiedPrompt.includes('Keep credentials private')));
      await page.evaluate(()=>{window.failCopy=true;});
      await page.getByRole('button',{name:'Prompt copied',exact:true}).click();
      await page.getByRole('button',{name:'Try copying again',exact:true}).waitFor();
      await page.evaluate(()=>{window.failCopy=false;});
      await page.getByRole('button',{name:'Try copying again',exact:true}).click();
      await page.getByRole('button',{name:'Prompt copied',exact:true}).waitFor();
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await selected().evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
      await selected().focus();await page.keyboard.press('Home');
      for(const name of ['Hermes','OpenClaw','Claude Code','Codex','OpenCode','DeepSeek Harness','Any agent']) {
        await page.keyboard.press('ArrowRight');
        assert.equal(await selected().getAttribute('aria-label'),name);
      }
      assert.equal(await page.locator('.agent-card[tabindex="0"]').count(),1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.ok(await selected().evaluate(el=>el.getBoundingClientRect().width>=44));
      await page.evaluate(()=>window.scrollTo(0,0));
      if(width<768){const copyBox=await page.locator('.agent-copy').boundingBox();assert.ok(copyBox.y+copyBox.height<=height,'Copy prompt must fit in the mobile first view');}
      await page.screenshot({path:`/tmp/wikshi-agent-deck-${engine.name()}-${width}.png`});
      await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
      assert.equal(await selected().getAttribute('aria-label'),'Claude Code');
      const claudeLogo=selected().locator('.agent-card-logo > span img');
      assert.equal(await claudeLogo.evaluate(el=>getComputedStyle(el).width),'32px');
      assert.equal(await claudeLogo.evaluate(el=>el.complete&&el.naturalWidth>0),true);
      await page.screenshot({path:`/tmp/wikshi-agent-deck-claude-${engine.name()}-${width}.png`});
      assert.deepEqual(errors,[]);
      console.log(`PASS ${engine.name()} ${width}: cards, keyboard, swipe, copy, errors, reduced motion, layout`);
      await page.close();
    }
  } finally {await browser.close();}
}
