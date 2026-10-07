const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const output = 'docs/assets/review-evidence/object-copy/2026-10-05';
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true,args:['--enable-unsafe-webgpu','--mute-audio']});
  const checks = [], errors = [];
  let page;
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},hasTouch:mobile,isMobile:mobile});
      page = await context.newPage();
      page.setDefaultTimeout(8000);
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto('http://127.0.0.1:4173/');
      await page.locator('#household-roster-members button').first().waitFor({timeout:30000});
      await page.getByRole('button',{name:'Got it',exact:true}).click();
      await page.locator('label[for="speed-0"]').click();
      assert(await page.getByLabel('Pause',{exact:true}).isChecked());
      await page.locator('#household-roster-members button').filter({hasText:'Tim'}).click();
      async function openObject(type) {
        await page.locator('canvas').first().focus();
        for(let i=0;i<50;i++) {
          await page.keyboard.press('ArrowRight');
          if((await page.locator('#keyboard-target').innerText())===`Target: ${type}.`) {
            await page.keyboard.press('Enter');
            await page.locator('#object-menu').waitFor({state:'visible'});
            assert.equal(await page.locator('#object-menu .object-type').innerText(),type);
            return;
          }
        }
        throw Error(`No keyboard target for ${type}`);
      }
      const prefix = mobile?'phone':'desktop';
      await page.screenshot({path:`${output}/${prefix}-game.png`});
      if(!mobile) {
        // Fridge body observed in desktop-game.png at this viewport.
        await page.mouse.click(650,245,{button:'right'});
        assert.equal(await page.locator('#object-menu .object-type').innerText(),'Fridge');
        assert.equal(await page.locator('#object-menu details').evaluate(element=>element.open),false);
        await page.locator('#object-menu summary').hover();
        assert.equal(await page.locator('#object-menu details').evaluate(element=>element.open),false);
        await page.screenshot({path:`${output}/right-click-closed.png`});
        await page.locator('#object-menu summary').click();
        assert.equal(await page.locator('#object-menu details').evaluate(element=>element.open),true);
        await page.screenshot({path:`${output}/right-click-expanded.png`});
        await page.keyboard.press('Escape');
      }
      await openObject('Fridge');
      const details=page.locator('#object-menu details'),summary=page.locator('#object-menu summary');
      const isOpen=()=>details.evaluate(element=>element.open);
      assert.equal(await isOpen(),false);
      if(!mobile) {
        await summary.hover();
        assert.equal(await isOpen(),false);
        await page.keyboard.press('Shift+Tab');
        assert(await summary.evaluate(element=>element===document.activeElement));
        assert.equal(await isOpen(),false);
      }
      await page.screenshot({path:`${output}/${prefix}-closed.png`});
      if(mobile) await summary.tap(); else await summary.click();
      assert.equal(await isOpen(),true);
      assert.equal(await page.locator('#object-menu .object-description').innerText(),'Food storage for cooking, with snacks available between meals.');
      const action=page.locator('#object-menu .menu-entry').first();
      const before=await action.boundingBox();
      if(!mobile) await action.hover();
      assert.deepEqual(await action.boundingBox(),before);
      assert.equal(await isOpen(),true);
      const bounds=await page.locator('#object-menu').boundingBox(),viewport=page.viewportSize();
      assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height);
      await page.screenshot({path:`${output}/${prefix}-expanded.png`});
      if(mobile) await summary.tap(); else await summary.click();
      assert.equal(await isOpen(),false);
      if(!mobile) for(const key of ['Enter','Space']) {
        await summary.focus();
        await page.keyboard.press(key);
        assert.equal(await isOpen(),true);
        await page.keyboard.press(key);
        assert.equal(await isOpen(),false);
      }
      await summary.click();
      await page.keyboard.press('Escape');
      assert(await page.locator('#object-menu').isHidden());
      await openObject('Fridge');
      assert.equal(await isOpen(),false);
      await page.locator('#object-menu .menu-entry').first().click();
      assert(await page.locator('#object-menu').isHidden());
      if(!mobile) {
        const copy=JSON.parse(fs.readFileSync(`${output}/copy.json`,'utf8'));
        for(const object of copy) {
          await openObject(object.type);
          assert.equal(await isOpen(),false);
          assert.equal(await page.locator('#object-menu .object-model').textContent(),object.model+'›');
          await summary.click();
          assert.equal(await page.locator('#object-menu .object-description').innerText(),object.description);
          assert.equal(await isOpen(),true);
          if(object.type==='Stove') await page.screenshot({path:`${output}/stove-description.png`});
          await page.keyboard.press('Escape');
        }
      }
      checks.push({viewport:mobile?'390x844':'1440x1000',activation:mobile?'touch':'mouse, Enter, Space',hoverAndFocusClosed:mobile?'not tested':true, rightClick:mobile?'not tested':true, catalogueCopiesChecked:mobile?0:JSON.parse(fs.readFileSync(`${output}/copy.json`,'utf8')).length,reopenClosed:true,actionWorks:true,expandedWithinViewport:true});
      await context.close();
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(`${output}/browser-results.json`,JSON.stringify({checks,errors},null,2)+'\n');
    console.log(JSON.stringify({checks,errors},null,2));
  } catch(error) {
    if(page&&!page.isClosed()) await page.screenshot({path:`${output}/failure.png`});
    throw error;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
