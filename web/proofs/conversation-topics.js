// Pause a task-owned ?stress=0&audio=0 page, then close it after capture.
export async function conversationTopicProof() {
  const harness = globalThis.__terriStress;
  if (!harness) throw Error('The conversation proof needs the stress harness');
  if (!document.querySelector('#speed-0')?.checked) {
    throw Error('Pause the game before capturing a conversation');
  }
  const sim = harness.sim;
  const base = sim.saveBytes().slice();
  const stage = document.querySelector('#stage');
  const people = Array.from(sim.ids()).filter((_, row) => sim.kinds()[row] === 0);
  if (people.length < 2) throw Error('The proof needs two household members');
  const pair = people.slice(0, 2);
  try {
    if (!sim.talkToFirst(pair[0], pair[1], 0)) throw Error('Talk order refused');
    let talking = false;
    for (let tick = 0; tick < 900; tick++) {
      sim.tick();
      if (pair.every(person => sim.activityOf(person) === 4)) {
        talking = true;
        break;
      }
    }
    if (!talking) throw Error('Conversation did not start');
    const rows = pair.map(person => Array.from(sim.ids()).indexOf(person));
    const topics = rows.map(row => sim.conversationTopics()[row]);
    const preferences = rows.map(row => sim.conversationPreferences()[row]);
    if (!topics[0] || topics[0] !== topics[1] || preferences[0] < 0) {
      throw Error('Conversation topic or initiator preference is invalid');
    }
    const saved = sim.saveBytes().slice();
    const hash = String(sim.worldHash());
    sim.tick();
    if (!sim.loadBytes(saved) || String(sim.worldHash()) !== hash) {
      throw Error('Conversation save did not restore exactly');
    }
    harness.step(performance.now() + 250);
    await new Promise(requestAnimationFrame);
    const capture = document.createElement('canvas');
    capture.id = 'conversation-proof';
    capture.width = stage.width;
    capture.height = stage.height;
    capture.style = 'position:fixed;inset:0;width:100%;height:100%;z-index:10000;object-fit:contain;background:#18181b';
    capture.getContext('2d').drawImage(stage, 0, 0);
    document.body.append(capture);
    return {pair, topics, preferences, schema: saved[8], hash, tick: sim.clockTick()};
  } finally {
    if (!sim.loadBytes(base)) throw Error('Proof failed to restore its initial world');
    harness.step(performance.now() + 250);
  }
}
