import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { AudioController } from '../src/audio/audio-controller.js';

import {
  AudioControls,
  type AudioEffectsSlider,
  type AudioMuteButton,
  type AudioSettings,
} from '../src/ui/audio-controls.js';

const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

interface RecordedButton extends AudioMuteButton {
  readonly attributes: Map<string, string>;
}

interface RecordedSlider extends AudioEffectsSlider {
  readonly attributes: Map<string, string>;
}

function button(): RecordedButton {
  const attributes = new Map<string, string>();
  return {
    textContent: null,
    attributes,
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

function slider(): RecordedSlider {
  const attributes = new Map<string, string>();
  return {
    value: '',
    attributes,
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

function settings(muted = false, effects = 0.7): AudioSettings & {
  readonly muteWrites: boolean[];
  readonly effectsWrites: number[];
  readonly effectsPreviews: number[];
} {
  let currentMuted = muted;
  let currentEffects = effects;
  let currentVoices = 1;
  let currentAmbience = 0.25;
  const muteWrites: boolean[] = [];
  const effectsWrites: number[] = [];
  const effectsPreviews: number[] = [];
  return {
    muteWrites,
    effectsWrites,
    effectsPreviews,
    isMuted: () => currentMuted,
    setMuted(value) {
      currentMuted = value;
      muteWrites.push(value);
    },
    effectsLevel: () => currentEffects,
    voicesLevel: () => currentVoices,
    ambienceLevel: () => currentAmbience,
    previewAmbienceLevel: value => { currentAmbience = value; },
    setAmbienceLevel: value => { currentAmbience = value; },
    previewVoicesLevel: (value) => { currentVoices = value; },
    setVoicesLevel: (value) => { currentVoices = value; },
    previewEffectsLevel(value) {
      currentEffects = Math.max(0, Math.min(1, value));
      effectsPreviews.push(value);
    },
    setEffectsLevel(value) {
      currentEffects = Math.max(0, Math.min(1, value));
      effectsWrites.push(value);
    },
  };
}

describe('AudioControls', () => {
  it('previews Ambience without unlocking or writing and commits exactly once', () => {
    let saved = JSON.stringify({version: 1, muted: true, effectsLevel: 0.45, voicesLevel: 0.6});
    let writes = 0;
    const controller = new AudioController(() => { throw Error('No slider activation'); }, {
      getItem: () => saved, setItem: (_key, value) => { saved = value; writes++; },
    });
    const ambience = slider(), value = {textContent: null as string | null};
    const controls = new AudioControls(controller, button(), slider(), {textContent: null}, slider(), {textContent: null}, ambience, value);
    expect(ambience.value).toBe('25');
    controls.previewAmbiencePercent('60');
    expect(value.textContent).toBe('60%');
    expect(writes).toBe(0);
    controls.setAmbiencePercent('60');
    expect(writes).toBe(1);
    expect(new AudioController(undefined, {getItem: () => saved, setItem: () => {}}).preferences()).toEqual({muted: true, effectsLevel: 0.45, voicesLevel: 0.6, ambienceLevel: 0.6});
  });
  it('reflects saved Voices and previews silently before persisting a change', () => {
    let saved = JSON.stringify({ version: 1, muted: true, effectsLevel: 0.45, voicesLevel: 0.65 });
    let writes = 0;
    let contextRequests = 0;
    const store = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; writes += 1; } };
    const controller = new AudioController(() => { contextRequests += 1; throw new Error('slider must not unlock audio'); }, store);
    const voices = slider();
    const value = { textContent: null as string | null };
    const effects = slider();
    const controls = new AudioControls(controller, button(), effects, { textContent: null }, voices, value, slider(), { textContent: null });
    expect(voices.value).toBe('65');
    expect(voices.attributes.get('aria-valuetext')).toBe('65%');
    expect(value.textContent).toBe('65%');
    expect(controls.previewVoicesPercent('20')).toBe(0.2);
    expect(writes).toBe(0);
    expect(voices.value).toBe('20');
    expect(value.textContent).toBe('20%');
    expect(controls.setVoicesPercent('20')).toBe(0.2);
    expect(writes).toBe(1);
    expect(new AudioController(undefined, store).preferences()).toEqual({ muted: true, effectsLevel: 0.45, voicesLevel: 0.2, ambienceLevel: 0.25 });
    expect(effects.value).toBe('45');
    expect(controls.setVoicesPercent('broken')).toBe(0.2);
    expect(writes).toBe(1);
    expect(controls.previewVoicesPercent('120')).toBe(1);
    expect(voices.value).toBe('100');
    expect(controls.previewVoicesPercent('-20')).toBe(0);
    expect(voices.attributes.get('aria-valuetext')).toBe('0%');
    expect(contextRequests).toBe(0);
  });

  it('ships one labeled mute control and one touch-sized effects range', () => {
    expect(INDEX_HTML.match(/\bid="audio-mute"/g)).toHaveLength(1);
    expect(INDEX_HTML.match(/\bid="effects-volume"/g)).toHaveLength(1);
    expect(INDEX_HTML).toMatch(
      /id="effects-volume"[\s\S]*?type="range"[\s\S]*?min="0"[\s\S]*?max="100"[\s\S]*?step="5"/,
    );
    expect(INDEX_HTML).toMatch(
      /#effects-volume\s*\{[\s\S]*?min-height:\s*44px/,
    );
    expect(INDEX_HTML).toMatch(
      /<label[^>]+for="effects-volume"[\s\S]*?Effects[\s\S]*?<output[^>]+id="effects-volume-value"/,
    );
    // [OF3]: the sound controls moved into the Options panel, so the phone
    // sidebar keeps speed and no longer lays out audio or actions rows.
    expect(INDEX_HTML.indexOf('id="time-controls"')).toBeLessThan(INDEX_HTML.indexOf('id="options-panel"'));
    expect(INDEX_HTML).not.toMatch(/'audio audio'|'actions actions'/);
    const panel = INDEX_HTML.indexOf('id="options-panel"');
    expect(INDEX_HTML.indexOf('id="audio-controls"')).toBeGreaterThan(panel);
  });

  it('reflects the controller state in readable button and range values', () => {
    const state = settings(true, 0.65);
    const mute = button();
    const effects = slider();
    const value = { textContent: null as string | null };

    new AudioControls(state, mute, effects, value, slider(), { textContent: null }, slider(), { textContent: null });

    expect(mute.textContent).toBe('Sound: off');
    expect(mute.attributes.get('aria-pressed')).toBe('true');
    expect(effects.value).toBe('65');
    expect(effects.attributes.get('aria-valuetext')).toBe('65%');
    expect(value.textContent).toBe('65%');
  });

  it('toggles the controller rather than keeping a second mute state', () => {
    const state = settings();
    const mute = button();
    const effects = slider();
    const controls = new AudioControls(
      state,
      mute,
      effects,
      { textContent: null },
      slider(), { textContent: null },
      slider(), { textContent: null },
    );

    expect(controls.toggleMuted()).toBe(true);
    expect(state.muteWrites).toEqual([true]);
    expect(mute.textContent).toBe('Sound: off');
    expect(mute.attributes.get('aria-pressed')).toBe('true');

    expect(controls.toggleMuted()).toBe(false);
    expect(state.muteWrites).toEqual([true, false]);
    expect(mute.textContent).toBe('Sound: on');
    expect(mute.attributes.get('aria-pressed')).toBe('false');
  });

  it('converts whole percentages to the controller normalized level', () => {
    const state = settings();
    const effects = slider();
    const value = { textContent: null as string | null };
    const controls = new AudioControls(state, button(), effects, value, slider(), { textContent: null }, slider(), { textContent: null });

    expect(controls.setEffectsPercent('35')).toBe(0.35);
    expect(state.effectsWrites).toEqual([0.35]);
    expect(effects.value).toBe('35');
    expect(effects.attributes.get('aria-valuetext')).toBe('35%');
    expect(value.textContent).toBe('35%');
  });

  it('previews range movement separately from the persisted commit', () => {
    const state = settings();
    const controls = new AudioControls(
      state,
      button(),
      slider(),
      { textContent: null },
      slider(), { textContent: null },
      slider(), { textContent: null },
    );

    expect(controls.previewEffectsPercent('45')).toBe(0.45);
    expect(state.effectsPreviews).toEqual([0.45]);
    expect(state.effectsWrites).toEqual([]);

    expect(controls.setEffectsPercent('45')).toBe(0.45);
    expect(state.effectsWrites).toEqual([0.45]);
  });

  it('reflects controller clamping at both ends of the range', () => {
    const state = settings();
    const effects = slider();
    const controls = new AudioControls(
      state,
      button(),
      effects,
      { textContent: null },
      slider(), { textContent: null },
      slider(), { textContent: null },
    );

    expect(controls.setEffectsPercent('125')).toBe(1);
    expect(effects.value).toBe('100');
    expect(controls.setEffectsPercent('-20')).toBe(0);
    expect(effects.value).toBe('0');
    expect(state.effectsWrites).toEqual([1.25, -0.2]);
  });

  it('ignores a malformed range value and restores the current level', () => {
    const state = settings(false, 0.4);
    const effects = slider();
    const value = { textContent: null as string | null };
    const controls = new AudioControls(state, button(), effects, value, slider(), { textContent: null }, slider(), { textContent: null });

    expect(controls.setEffectsPercent('volume')).toBe(0.4);
    expect(state.effectsWrites).toEqual([]);
    expect(effects.value).toBe('40');
    expect(value.textContent).toBe('40%');
  });
});
