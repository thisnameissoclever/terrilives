/**
 * Plays the recorded Sim voice clips that make up a conversation.
 *
 * A conversation is exactly two clips, one after the other, and the
 * simulation chose which two before any of this ran. It also made the
 * conversation last exactly as long as those two clips together, so at normal
 * speed the talking and the sound end on the same tick without anything here
 * having to measure or trim. See `content/voice.toml`.
 *
 * **This player never chooses a clip.** The choice is a simulation decision
 * drawn from the seeded generator, because a choice made here could not be
 * replayed and would differ between a muted and an unmuted player. What
 * arrives is two indices; what this does is play them.
 *
 * Kept beside `ProceduralCuePlayer` rather than folded into it. The two share
 * a shape - own every node until it ends, cap the voices, never let an audio
 * failure escape - but not an implementation: one builds a sound from an
 * oscillator and the other plays a recording, and the branching required to
 * make one class do both would obscure both halves.
 */

import type { AudioNodePort, AudioParamPort, GainNodePort } from './procedural-cues.js';

/** A decoded recording. Only the fields this module reads are named. */
export interface AudioBufferPort {
  readonly duration: number;
}

export interface AudioBufferSourcePort extends AudioNodePort {
  buffer: AudioBufferPort | null;
  readonly playbackRate: AudioParamPort;
  onended: (() => void) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export interface VoiceAudioContext {
  readonly currentTime: number;
  createGain(): GainNodePort;
  createBufferSource(): AudioBufferSourcePort;
}

/**
 * How loud the recordings sit in the mix.
 *
 * Separate from the level baked into the files, and deliberately so. The
 * clips are matched to each other at the loudness of the quietest recording,
 * which stops one jumping out when the draw picks it; how loud Sims are
 * against footsteps and everything else is this number, and retuning it must
 * not mean reprocessing the audio.
 *
 * Low on purpose. The clips are nonverbal babble with nothing to understand,
 * so they should sit under the game rather than compete with it.
 */
export const VOICE_CLIP_GAIN = 0.28;

/**
 * Seconds of ramp at each end of a clip.
 *
 * The fade in is a formality; the recordings already start at their first
 * audible sample. The fade OUT is not: a conversation that is cut short stops
 * mid-waveform, and cutting a waveform at an arbitrary sample is a step, and
 * a step is an audible click.
 */
const EDGE_FADE_SECONDS = 0.012;

/**
 * The most conversations that may sound at once.
 *
 * Two clips share one gain, so this counts conversations rather than
 * recordings. Smaller than the procedural cap because these are long: eight
 * overlapping conversations would be a wall of babble no player could parse,
 * and the oldest is the one least worth keeping.
 */
export const MAX_ACTIVE_VOICE_CONVERSATIONS = 3;

interface ActiveConversation {
  readonly gain: GainNodePort;
  readonly sources: AudioBufferSourcePort[];
  ended: boolean;
}

/**
 * Owns the decoded clips and every node currently playing one.
 */
export class VoiceClipPlayer {
  private readonly active: ActiveConversation[] = [];
  private clips: readonly AudioBufferPort[] = [];

  constructor(
    private readonly context: VoiceAudioContext,
    private readonly output: unknown,
  ) {}

  /** Installs the decoded library. Indices are the simulation's clip indices. */
  setClips(clips: readonly AudioBufferPort[]): void {
    this.clips = clips;
  }

  clipCount(): number {
    return this.clips.length;
  }

  /**
   * Starts one conversation: `first`, then `second` the instant it ends.
   *
   * Both are scheduled up front against the audio clock rather than the
   * second being started when the first reports it finished. The audio clock
   * is sample-accurate and the callback is not, so scheduling is what makes
   * the join seamless instead of leaving a gap whose size depends on how busy
   * the main thread was.
   *
   * `rate` is the playback speed. At 1 it is exactly the recording. Above it,
   * the clips play faster and a little higher, which is what fast-forward
   * uses; the pitch rise is deliberately far smaller than the speed-up,
   * because nothing here has to fit a deadline - a conversation that outlasts
   * its fast-forwarded slot is cut by `stopAll`.
   *
   * Returns false when the clips are missing or the audio hardware refuses,
   * and never throws: a sound failing is not a reason for the frame to fail.
   */
  play(first: number, second: number, rate = 1): boolean {
    const firstClip = this.clips[first];
    const secondClip = this.clips[second];
    if (firstClip === undefined || secondClip === undefined) return false;
    if (!(rate > 0)) return false;

    const now = this.context.currentTime;
    let gain: GainNodePort | null = null;
    let conversation: ActiveConversation | null = null;

    try {
      while (this.active.length >= MAX_ACTIVE_VOICE_CONVERSATIONS) {
        this.finish(this.active[0], true);
      }

      gain = this.context.createGain();
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(VOICE_CLIP_GAIN, now + EDGE_FADE_SECONDS);

      const firstSeconds = firstClip.duration / rate;
      const secondSeconds = secondClip.duration / rate;
      const totalSeconds = firstSeconds + secondSeconds;
      gain.gain.linearRampToValueAtTime(
        VOICE_CLIP_GAIN,
        now + Math.max(EDGE_FADE_SECONDS, totalSeconds - EDGE_FADE_SECONDS),
      );
      gain.gain.linearRampToValueAtTime(0, now + totalSeconds);

      const record: ActiveConversation = { gain, sources: [], ended: false };
      conversation = record;

      const starts: readonly [AudioBufferPort, number][] = [
        [firstClip, now],
        [secondClip, now + firstSeconds],
      ];
      for (const [clip, when] of starts) {
        const source = this.context.createBufferSource();
        source.buffer = clip;
        source.playbackRate.cancelScheduledValues(now);
        source.playbackRate.setValueAtTime(rate, now);
        source.connect(gain);
        record.sources.push(source);
        source.start(when);
        source.stop(when + clip.duration / rate);
      }

      // Only the LAST source reports the conversation over. The first ending
      // is the halfway point, and treating it as the end would tear down the
      // gain the second clip is still playing through.
      const last = record.sources[record.sources.length - 1];
      last.onended = () => this.finish(record, false);

      gain.connect(this.output);
      this.active.push(record);
      return true;
    } catch {
      if (conversation !== null) {
        this.finish(conversation, true);
      } else if (gain !== null) {
        safeDisconnect(gain);
      }
      return false;
    }
  }

  /**
   * Stops everything, fading rather than cutting.
   *
   * Called when a conversation ends before its audio does, which is what
   * fast-forward makes routine: the world runs two or three times real time
   * while the recordings do not, so the talking finishes first.
   */
  stopAll(): void {
    for (const conversation of [...this.active]) this.finish(conversation, true);
  }

  activeConversationCount(): number {
    return this.active.length;
  }

  private finish(conversation: ActiveConversation, stop: boolean): void {
    if (conversation.ended) return;
    conversation.ended = true;

    const index = this.active.indexOf(conversation);
    if (index >= 0) this.active.splice(index, 1);

    for (const source of conversation.sources) source.onended = null;

    if (stop) {
      const now = this.context.currentTime;
      // Ramp the shared gain down before stopping the sources, so a cut
      // lands on silence instead of on a step partway through a waveform.
      try {
        conversation.gain.gain.cancelScheduledValues(now);
        conversation.gain.gain.linearRampToValueAtTime(0, now + EDGE_FADE_SECONDS);
      } catch {
        // A context that is already closed cannot be ramped; the stop below
        // and the disconnect still have to happen.
      }
      for (const source of conversation.sources) {
        try {
          source.stop(now + EDGE_FADE_SECONDS);
        } catch {
          // A source may never have reached a startable state, or may have
          // passed its stop time already.
        }
      }
    }

    for (const source of conversation.sources) safeDisconnect(source);
    safeDisconnect(conversation.gain);
  }
}

function safeDisconnect(node: AudioNodePort): void {
  try {
    node.disconnect();
  } catch {
    // Audio hardware failure must not escape into the simulation frame.
  }
}

/** Where a clip id resolves to, relative to the served root. */
export function voiceClipUrl(id: string): string {
  return `audio/voice/${id}.wav`;
}

export interface VoiceClipFetcher {
  (url: string): Promise<ArrayBuffer>;
}

export interface VoiceClipDecoder {
  (bytes: ArrayBuffer): Promise<AudioBufferPort>;
}

/**
 * Fetches and decodes the whole library, in the index order the simulation
 * uses.
 *
 * **A clip that fails to load leaves a hole rather than failing the load.**
 * The library is presentation: a missing recording should cost that one
 * conversation its sound, not stop the game from starting. `play` treats an
 * absent index as "nothing to play" for exactly this reason.
 *
 * The ids come from the compiled content pack across the boundary, never from
 * a list written here. A list in this file would be a second copy of
 * `content/voice.toml`, stale from the first clip anybody added.
 */
export async function loadVoiceClips(
  ids: readonly string[],
  fetchBytes: VoiceClipFetcher,
  decode: VoiceClipDecoder,
): Promise<(AudioBufferPort | undefined)[]> {
  return Promise.all(
    ids.map(async (id) => {
      try {
        return await decode(await fetchBytes(voiceClipUrl(id)));
      } catch {
        return undefined;
      }
    }),
  );
}
