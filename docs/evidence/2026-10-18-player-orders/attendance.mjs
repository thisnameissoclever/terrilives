export async function runAttendance({chromium, fs, qaRoot, helperPath}) {
  let browser;
  try {
    browser = await chromium.launch({headless:false, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', args:['--mute-audio']});
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5198/?stress=0&debug=1');
    await page.locator('#startup-loading').waitFor({state:'hidden', timeout:45000});
    await page.evaluate(await fs.readFile(helperPath,'utf8'));
    const receipt = await page.evaluate(async()=>{
      await issue273Qa.ready();
      const sim=__terriStress.sim, tim=issue273Qa.person('Tim');
      sim.setCareerAutonomy(false,false);
      if(!sim.assignCareer(tim.entity,0)) throw new Error('Office assignment failed');
      sim.cancelIntents(tim.entity); sim.flushCommands();
      const bike=issue273Qa.objects().find(row=>row.model==='moving_box');
      const action=bike.actions.indexOf('Use the exercise bike');
      for(let i=0;i<60;i++) if(!sim.useObject(tim.entity,bike.entity,action)) throw new Error('Queued exercise refused');
      sim.flushCommands();
      const schedule=sim.careerScheduleOf(tim.entity);
      await issue273Qa.advanceUntil(()=>sim.clockTick()>=schedule.shiftStart+190,1000);
      const delayed={tick:sim.clockTick(), attendance:Array.from(sim.careerAttendanceOf(tim.entity)), queue:sim.actionQueueRowsOf(tim.entity)};
      if(!delayed.queue.length) throw new Error('Preaccepted orders did not delay departure');
      sim.cancelIntents(tim.entity);sim.flushCommands();
      await issue273Qa.advanceUntil(()=>sim.clockTick()>=schedule.shiftStart+schedule.shiftTicks+60,1000);
      await issue273Qa.career('Tim');
      const attendance=Array.from(sim.careerAttendanceOf(tim.entity));
      if(attendance.length!==8||attendance[1]===0||attendance[4]<=0||attendance[7]!==1) throw new Error('Expected settled partial attendance and deduction: '+attendance);
      return {schedule,delayed,settled:{tick:sim.clockTick(),attendance},text:document.querySelector('.career-attendance')?.textContent};
    });
    if(await page.locator('#debug-details').evaluate(node=>node.open)) await page.getByText('debug stats',{exact:true}).click();
    await page.locator('.career-attendance').scrollIntoViewIfNeeded();
    await page.screenshot({path:qaRoot+'/final-desktop-attendance.png'});
    await fs.writeFile(qaRoot+'/final-attendance.json',JSON.stringify(receipt,null,2));
    return receipt;
  } finally {await browser?.close();}
}

