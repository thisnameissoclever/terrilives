import type { GameAudioEventSink } from './audio-controller.js';

export interface CompletionAudioSource {
  readonly completionSoundCount: number;
  completionSounds(): Uint32Array;
  clearCompletionSounds(): void;
}

/** Every fixed tick consumes its presentation events, including silent ticks. */
export function drainCompletionAudioAfterTick(
  source: CompletionAudioSource, sink: GameAudioEventSink, samplingEnabled: boolean,
): void {
  try {
    if (!samplingEnabled) return;
    const count = source.completionSoundCount;
    const events = source.completionSounds();
    for (let row = 0; row < Math.min(count, 64, events.length / 2); row++) {
      sink.emit({ type: 'object.completed', action: events[row * 2], sourceId: events[row * 2 + 1] });
    }
  } finally {
    source.clearCompletionSounds();
  }
}
