import { ActivityCueScheduler, conversationVoiceKey } from '../src/audio/activity-cues.ts';
import { VoiceClipPlayer } from '../src/audio/voice-clips.ts';

// Render real samples silently. The first recording rises with sample time,
// so a restarted source cannot masquerade as continuous playback.
export async function proveConversationOwnership() {
  const sampleRate = 48_000;
  const context = new OfflineAudioContext(1, sampleRate * 3, sampleRate);
  const clips = [0, 1, 2, 3].map((clip) => {
    const buffer = context.createBuffer(1, sampleRate, sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = clip === 0 ? index / sampleRate : clip === 1 ? 1 : 0.5;
    }
    return buffer;
  });
  const player = new VoiceClipPlayer(context, context.destination);
  player.setClips(clips);
  const events = [];
  const scheduler = new ActivityCueScheduler({
    emit(event) {
      events.push({ ...event, at: context.currentTime });
      const key = conversationVoiceKey(event.voice);
      if (event.type === 'sim.conversation-started') {
        if (!player.play(event.voice.first, event.voice.second, 1, key)) {
          throw new Error('Recording failed to start');
        }
      } else if (event.type === 'sim.conversation-ended') {
        player.stopConversation(key);
      }
    },
  });
  const a = { owner: 31, endHigh: 2_097_152, endLow: 0, first: 0, second: 1 };
  const b = { owner: 32, endHigh: 2_097_152, endLow: 0, first: 2, second: 3 };
  const nextA = { ...a, endLow: 1 };
  function frame(voices) {
    scheduler.beginFrame();
    for (const voice of voices) {
      scheduler.observe(voice.owner, 'conversation', voice);
      scheduler.observe(voice.owner + 100, 'conversation', voice);
    }
    scheduler.endFrame();
  }
  frame([a]);
  const changes = [
    [0.25, [b, a]],
    [0.5, [a]],
    [1.5, [nextA]],
    [2, []],
  ].map(([time, voices]) => ({ suspended: context.suspend(time), voices }));
  const rendering = context.startRendering();
  for (const { suspended, voices } of changes) {
    await suspended;
    frame(voices);
    await context.resume();
  }
  const samples = (await rendering).getChannelData(0);
  const starts = events.filter((event) => event.type === 'sim.conversation-started');
  const ends = events.filter((event) => event.type === 'sim.conversation-ended');
  if (starts.length !== 3 || ends.length !== 3) {
    throw new Error(`Unexpected independent transitions: ${JSON.stringify(events)}`);
  }
  const replacementStart = starts[2].at;
  const checks = [
    [0.2, 0.0448],
    [0.4, 0.2016],
    [0.75, 0.168],
    [1.25, 0.224],
    [1.75, 0.224 * (1.75 - replacementStart)],
    [2.05, 0],
  ].map(([time, expected]) => {
    const actual = samples[Math.round(time * sampleRate)];
    if (Math.abs(actual - expected) > 0.00002) {
      throw new Error(`At ${time}s: expected ${expected}, rendered ${actual}`);
    }
    return { time, expected, actual };
  });
  return { starts: starts.length, ends: ends.length, checks };
}
