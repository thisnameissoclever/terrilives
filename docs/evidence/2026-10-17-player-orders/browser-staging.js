// Browser-context helper for an isolated displayed game tab at ?stress=0&debug=1.
// Evaluate this file's contents once; it installs globalThis.issue273Qa.
(() => {
  const stress = globalThis.__terriStress;
  if (!stress) throw new Error('Open the displayed game with ?stress=0&debug=1 and wait for loading to finish.');
  const sim = stress.sim;
  const baseline = Uint8Array.from(sim.saveBytes());
  const el = selector => {
    const node = document.querySelector(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node;
  };
  const paint = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
  const people = () => {
    const ids = Array.from(sim.ids()), kinds = Array.from(sim.kinds()), simIds = Array.from(sim.simIds());
    return ids.flatMap((entity, row) => kinds[row] === 0 && simIds[row] !== 0xffffffff
      ? [{entity, simId: simIds[row], name: sim.simName(entity), career: sim.careerOf(entity)}] : []);
  };
  const person = name => {
    const found = people().find(row => row.name === name);
    if (!found) throw new Error(`No household member named ${name}`);
    return found;
  };
  const objects = () => {
    const ids = Array.from(sim.ids()), kinds = Array.from(sim.kinds());
    return ids.flatMap((entity, row) => kinds[row] !== 0
      ? [{entity, model: sim.objectModel(entity)?.id, type: sim.objectModel(entity)?.typeLabel, actions: sim.interactionLabels(entity)}] : []);
  };
  const speed = async n => { el(`#speed-${n}`).click(); sim.flushCommands(); await paint(); };
  const ready = async () => {
    if (el('#help-panel').open) el('#close-help').click();
    if (el('#audio-mute').getAttribute('aria-pressed') !== 'true') el('#audio-mute').click();
    await speed(0);
    if (document.querySelector('dialog[open]')) throw new Error('Close the existing dialog before staging QA.');
    return {tick: sim.clockTick(), people: people(), bike: objects().find(row => row.model === 'moving_box')};
  };
  const select = async name => {
    const collapse = el('#sim-dock-collapse');
    if (collapse.getAttribute('aria-expanded') === 'false') collapse.click();
    const button = Array.from(document.querySelectorAll('#household-roster-members .household-member')).find(node => node.textContent === name);
    if (!button || button.getClientRects().length === 0) throw new Error(`Household button for ${name} is not visible.`);
    button.click(); sim.flushCommands(); await paint();
    if (sim.selectedIndex() !== person(name).entity) throw new Error(`Selection did not reach ${name}`);
    return person(name);
  };
  const queue = async name => { await select(name); el('#dock-queue').click(); await paint(); return state(); };
  const career = async name => {
    await select(name);
    if (el('#sim-sheet').hidden) el('#sim-details').click();
    el('#sim-sheet-header [data-open-sim-panel="career"]').click(); await paint();
  };
  const state = () => ({tick: sim.clockTick(), selected: sim.selectedIndex(), people: people(),
    queues: people().map(row => ({name: row.name, rows: sim.actionQueueRowsOf(row.entity)})),
    modal: el('#work-order-dialog').open, warning: el('#work-order-message').textContent,
    status: el('#command-feedback').textContent, events: sim.orderEventsSince('0')});
  const advanceUntil = async (test, maxTicks) => {
    await speed(0);
    let ticks = 0;
    while (!test() && ticks < maxTicks) { sim.tick(); ticks++; }
    await paint();
    if (!test()) throw new Error(`QA condition not reached within ${maxTicks} public simulation ticks.`);
    return ticks;
  };
  const prepareBusy = async () => {
    await ready();
    const bill = person('Bill'), casey = person('Casey');
    if (sim.workConflictsOf([bill.entity, casey.entity]).people.length) throw new Error('Restore baseline: Bill/Casey already have a work conflict.');
    const bike = objects().find(row => row.model === 'moving_box');
    if (!bike) throw new Error('Shipped exercise bike moving_box is absent. Inspect issue273Qa.objects().');
    const action = bike.actions.indexOf('Use the exercise bike');
    if (action < 0) throw new Error('The inspected exercise interaction is absent.');
    for (const actor of [bill, casey]) sim.cancelIntents(actor.entity);
    sim.flushCommands();
    if (!sim.useObjectFirst(bill.entity, bike.entity, action)) throw new Error('Exercise order refused.');
    sim.flushCommands();
    await advanceUntil(() => {
      const ids = Array.from(sim.ids()), row = ids.indexOf(bill.entity);
      return row >= 0 && sim.activities()[row] === 9;
    }, 300);
    await select('Casey');
    if (!el('#sim-sheet').hidden) el('#sim-sheet-close').click();
    await paint();
    return {initiator: casey, recipient: bill, bike, recipientPoint: await point(bill.entity), state: state()};
  };
  const point = async entity => {
    await paint();
    const snapshot = stress.characters.snapshot(), actor = snapshot.actors.find(row => row.entity === entity), view = snapshot.view;
    if (!actor || !view) throw new Error(`Entity ${entity} is not currently rendered.`);
    const project = p => ({x: (p[0] - p[1]) * 32 * view.scale + view.originX,
      y: (p[0] + p[1]) * 21 * view.scale + view.originY - p[2] * Math.sqrt(1166) * view.scale});
    const head = project(actor.head), feet = project(actor.feet), rect = el('#stage').getBoundingClientRect();
    // Bounded actual GPU picking avoids clicking a chair or transparent hair.
    for (const blend of [.45,.3,.6,.15,.75]) for (const dx of [0,-4,4,-8,8]) {
      const x = Math.round(head.x + (feet.x - head.x) * blend + dx * view.scale);
      const y = Math.round(head.y + (feet.y - head.y) * blend);
      if (x < 0 || y < 0 || x >= view.width || y >= view.height) continue;
      const hit = await stress.characters.pick(x, y);
      if (hit?.kind === 'person' && hit.entity === entity) return {x: rect.left + x * rect.width / view.width, y: rect.top + y * rect.height / view.height};
    }
    throw new Error(`No visible person-owned pixel found for entity ${entity}; pan or zoom the actual view.`);
  };
  const openPersonMenu = async name => {
    const p = await point(person(name).entity);
    el('#stage').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,button:2,buttons:2,clientX:p.x,clientY:p.y}));
    for (let frame = 0; frame < 40 && el('#object-menu').hidden; frame++) await paint();
    if (el('#object-menu').hidden) throw new Error('The real context-menu handler did not open a menu.');
    return Array.from(document.querySelectorAll('#object-menu button')).map(button => ({text:button.textContent,disabled:button.disabled,index:button.dataset.menuIndex}));
  };
  const clickChat = async () => {
    const button = Array.from(document.querySelectorAll('#object-menu button[data-menu-index]')).find(node => node.querySelector('span')?.textContent === 'Chat');
    if (!button || button.disabled) throw new Error('The actual Chat flyout button is unavailable.');
    button.click(); sim.flushCommands(); await paint(); return state();
  };
  const prepareWork = async () => {
    await ready();
    for (const row of people()) sim.cancelIntents(row.entity);
    sim.setCareerAutonomy(false,false);
    for (const name of ['Tim','Bill']) if (!sim.assignCareer(person(name).entity,0)) throw new Error(`Cannot assign ${name} to Office.`);
    sim.flushCommands();
    const schedule = sim.careerScheduleOf(person('Tim').entity);
    const dayTicks = sim.dayTicks(), now = sim.clockTick(), dayStart = Math.floor(now/dayTicks)*dayTicks;
    if (now > dayStart + schedule.shiftStart) throw new Error('Restore baseline before work staging; today\'s start has passed.');
    await advanceUntil(() => sim.clockTick() >= dayStart + schedule.shiftStart, dayTicks);
    const quote = sim.workConflictsOf([person('Tim').entity,person('Bill').entity]);
    if (quote.people.length !== 2) throw new Error(`Expected two due workers; got ${quote.people.length}.`);
    await select('Tim');
    if (!el('#sim-sheet').hidden) el('#sim-sheet-close').click();
    await paint();
    return {quote, recipientPoint:await point(person('Bill').entity), state:state()};
  };
  globalThis.issue273Qa = {ready,people,person,objects,state,select,queue,career,speed,point,openPersonMenu,clickChat,
    prepareBusy,prepareWork,advanceUntil,paint,
    restore:async()=>{await speed(0); if(el('#work-order-dialog').open)el('#work-order-cancel').click();
      const loaded=await stress.characters.loadBytes(Uint8Array.from(baseline)); if(!loaded)throw new Error('Baseline restore refused.');sim.flushCommands();await paint();return state();}};
  return {installed:true,tick:sim.clockTick(),people:people(),usage:'await issue273Qa.ready(); await issue273Qa.prepareBusy(); then real right-click Bill at returned recipientPoint and click Chat.'};
})()
