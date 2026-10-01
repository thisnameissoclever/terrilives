// Run through the production stress harness on a task-owned review page.
// The caller closes that page after capturing the board; no save is written.
export async function activityBubbleProof() {
  const harness = globalThis.__terriStress;
  const sim = harness.sim;
  const stage = document.querySelector('#stage');
  const base = sim.saveBytes().slice();
  const records = [];
  const board = document.createElement('div');
  board.id = 'activity-proof';
  board.style = 'position:absolute;top:0;left:0;z-index:10000;width:1560px;display:grid;grid-template-columns:repeat(6,260px);background:#202128;color:#eee;font:12px sans-serif';
  document.body.append(board);
  // The production camera opens at scale one. These captures use its live
  // origin; the full-scene pass separately exercises camera zoom.
  const capture = async (label, person, expected, target) => {
    if (sim.activityOf(person) !== expected) throw Error(`${label}: wrong activity`);
    harness.step(performance.now() + 250);
    await new Promise(requestAnimationFrame);
    const row = Array.from(sim.ids()).indexOf(person);
    const wx = sim.positions()[row * 2], wy = sim.positions()[row * 2 + 1];
    const x = harness.origin.x + (wx - wy) * 32;
    const y = harness.origin.y + (wx + wy) * 21;
    const canvas = document.createElement('canvas');
    canvas.width = 260; canvas.height = 190;
    canvas.getContext('2d').drawImage(stage, x - 130, y - 150, 260, 190, 0, 0, 260, 190);
    const title = document.createElement('div'); title.textContent = `${label} | code ${expected}`;
    title.style = 'height:32px;padding:6px';
    const section = document.createElement('section'); section.append(title, canvas); board.append(section);
    records.push({label, person, target, expected, tick:sim.clockTick(),
      queue:sim.actionQueueOf(person), position:[wx,wy], bodyAction:sim.visualActions()[row]});
  };
  const ordinary = [
    [0,3,'Snack'],[25,5,'Bunk sleep'],[30,12,'Shower'],[29,13,'Toilet'],
    [17,14,'Television'],[18,11,'Sofa sitting'],[32,16,'Wash hands'],
    [10,8,'Bookshelf reading'],[4,17,'Wash dishes'],[7,11,'Table sitting'],
    [11,15,'Lie on couch'],[12,11,'Armchair sitting'],[16,18,'Radio'],
    [19,5,'Double-bed sleep'],[22,9,'Exercise bike'],[23,19,'Correspondence'],
    [26,8,'Seated reading'],[27,10,'Watch fish'],[31,20,'Bath'],
  ];
  try {
    for (const [target, expected, label] of ordinary) {
      if (!sim.loadBytes(base)) throw Error('Review restore failed');
      sim.useObjectFirst(34,target,0);
      let found = false;
      for (let tick=0; tick<600; tick++) {
        sim.tick();
        if (sim.activityOf(34) === expected && sim.actionQueueOf(34)[0]?.endsWith(sim.objectName(target))) {
          found=true; break;
        }
      }
      if (!found) throw Error(`${label}: activity never started`);
      await capture(label,34,expected,target);
    }
    if (!sim.loadBytes(base)) throw Error('Review restore failed');
    sim.useObjectFirst(34,0,1);
    let next=0;
    const stages=[[21,'Get ingredients'],[22,'Prepare food'],[23,'Cook'],[3,'Eat dinner']];
    for (let tick=0;tick<1000&&next<stages.length;tick++) {
      sim.tick();
      if (sim.activityOf(34) !== stages[next][0]) continue;
      await capture(stages[next][1],34,stages[next][0],'cook_dinner'); next++;
    }
    if (next !== stages.length) throw Error('Dinner stages incomplete');
    if (!sim.loadBytes(base)) throw Error('Review restore failed');
    sim.useObjectFirst(34,27,0); sim.tick();
    await capture('Walking to fish',34,1,27);
    if (!sim.loadBytes(base)) throw Error('Review restore failed');
    sim.talkToFirst(34,35,0);
    let waiting = false, talking = false;
    for (let tick=0;tick<600&&(!waiting||!talking);tick++) {
      sim.tick();
      if (!waiting && sim.activityOf(35) === 2) {await capture('Waiting for chat',35,2,34); waiting=true;}
      if (!talking && sim.activityOf(34) === 4) {await capture('Conversation',34,4,35); talking=true;}
    }
    if (!waiting || !talking) throw Error('Conversation stages incomplete');
    return records;
  } finally {
    sim.loadBytes(base);
    harness.step(performance.now() + 250);
  }
}
