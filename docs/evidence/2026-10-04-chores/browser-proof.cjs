async (page) => {
  const context=await page.context().browser().newContext({viewport:{width:1280,height:900}});
  const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(String(e)));
  const evidence='D:/VIBES/.worktrees/a8a4/terrilives/docs/evidence/2026-10-04-chores/';
  const result={};
  async function paint(){await p.evaluate(()=>globalThis.__terriStress.step());await p.waitForTimeout(80);}
  async function snap(name){await paint();await p.screenshot({path:evidence+name+'.png'});}
  async function board(){await p.getByRole('button',{name:'Options',exact:true}).click();await p.getByRole('button',{name:'Chores',exact:true}).click();}
  try {
    await p.goto('http://127.0.0.1:5188/?stress=0&audio=0');await p.waitForFunction(()=>!!globalThis.__terriStress);
    await p.getByRole('button',{name:'Got it',exact:true}).click();await p.locator('label[for="speed-0"]').click();
    await p.evaluate(async()=>{const s=globalThis.__terriStress.sim;const response=await fetch('/.tmp/chores.sav');
      if(!response.ok||!s.loadBytes(new Uint8Array(await response.arrayBuffer())))throw Error('Fixture load failed');s.setSpeed(0);s.flushCommands();});
    await snap('grime-before');
    result.before=await p.evaluate(()=>({rows:[...globalThis.__terriStress.sim.choreRows()],floors:[...globalThis.__terriStress.sim.floorGrime()]}));
    await board();await p.getByLabel('Responsibility',{exact:true}).fill('91');await p.getByLabel('Floor cleaning preference',{exact:true}).fill('83');
    await p.getByRole('button',{name:'Apply preferences',exact:true}).click();await paint();
    result.profile=await p.evaluate(()=>[...globalThis.__terriStress.sim.choreProfileOf(globalThis.__terriStress.sim.selectedIndex())]);
    if(result.profile[0]!==91||result.profile[3]!==83)throw Error('Profile edit did not drain');
    await snap('profiles');
    const floor=p.locator('.chore-row').filter({hasText:'Clean floor: room at (0, 0)'});
    await floor.getByRole('button',{name:'Do now',exact:true}).click();
    result.floorWork=await p.evaluate(()=>{const s=globalThis.__terriStress.sim,a=s.selectedIndex();for(let i=0;i<1800;i++){s.tick();const status=s.chainStatusOf(a);if(status?.includes('Clean floor')&&s.visualActions()[[...s.ids()].indexOf(a)]!==5){const hash=s.worldHash();if(!s.loadBytes(s.saveBytes())||s.worldHash()!==hash)throw Error('Floor save mismatch');return {tick:s.clockTick(),status};}}throw Error('Floor did not start');});
    await snap('floor-working');
    result.floorDone=await p.evaluate(()=>{const s=globalThis.__terriStress.sim,a=s.selectedIndex();for(let i=0;i<2500;i++){s.tick();if(!s.chainStatusOf(a)?.includes('Clean floor')){const map=[...s.floorGrime()];for(const cell of [81,82,83]){const at=map.indexOf(cell);if(at>=0&&map[at+1]>=850)throw Error('Floor unchanged');}return {tick:s.clockTick(),floors:map};}}throw Error('Floor did not finish');});
    await snap('floor-cleaned');
    for(const [kind,label,name] of [[2,'Wipe surface','surface'],[3,'Empty bin','bin']]){
      await board();const row=p.locator('.chore-row').filter({hasText:label+':'}).filter({has:p.getByRole('button',{name:'Do now',exact:true})});
      const candidates=await row.all();let chosen=null;for(const r of candidates){if(await r.getByRole('button',{name:'Do now',exact:true}).isEnabled()){chosen=r;break;}}
      if(!chosen)throw Error('Missing dirty '+name);await chosen.getByRole('button',{name:'Do now',exact:true}).click();
      result[name+'Work']=await p.evaluate(({label})=>{const s=globalThis.__terriStress.sim,a=s.selectedIndex();for(let i=0;i<1800;i++){s.tick();const status=s.chainStatusOf(a);if(status?.includes(label)&&s.visualActions()[[...s.ids()].indexOf(a)]!==5)return {tick:s.clockTick(),status};}throw Error('No '+label);},{label});
      await snap(name+'-working');
      result[name+'Done']=await p.evaluate(({kind,label})=>{const s=globalThis.__terriStress.sim,a=s.selectedIndex();for(let i=0;i<1800;i++){s.tick();if(!s.chainStatusOf(a)?.includes(label)){const rows=[...s.choreRows()];if(rows.some((_,j)=>j%5===0&&rows[j]===kind&&rows[j+3]>=850))throw Error('Dirt unchanged');return {tick:s.clockTick(),rows};}}throw Error('Unfinished '+label);},{kind,label});
      await snap(name+'-cleaned');
    }
    await board();await p.getByLabel('Automatic weekly assignments',{exact:true}).check();await paint();
    await p.getByRole('button',{name:'Close',exact:true}).click();await p.evaluate(()=>{globalThis.__terriStress.sim.tick();});
    await board();result.board=await p.locator('#chores-dialog').innerText();
    result.assignments=await p.evaluate(()=>({rows:[...globalThis.__terriStress.sim.choreRows()],history:[...globalThis.__terriStress.sim.choreHistory()],enabled:globalThis.__terriStress.sim.choreBoardEnabled()}));
    if(!result.assignments.enabled||!result.assignments.rows.some((v,i)=>i%5===2&&v!==4294967295))throw Error('Assignments missing');
    await p.getByText('Recent daily outcomes',{exact:true}).click();await snap('weekly-board');await p.locator('#chores-dialog').evaluate(e=>e.scrollTop=0);await snap('weekly-board-top');
    const bounds=await p.locator('#chores-dialog').boundingBox();if(!bounds||bounds.x<0||bounds.x+bounds.width>1280)throw Error('Board overflow');
    result.errors=errors;if(errors.length)throw Error(errors.join('\n'));return result;
  } finally {await context.close();}
}
