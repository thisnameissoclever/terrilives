import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

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
    expect(INDEX_HTML).toMatch(
      /grid-template-areas:[\s\S]*?'speed speed'[\s\S]*?'audio audio'[\s\S]*?'actions actions'/,
    );
  });

  it('reflects the controller state in readable button and range values', () => {
    const state = settings(true, 0.65);
    const mute = button();
    const effects = slider();
    const value = { textContent: null as string | null };

    new AudioControls(state, mute, effects, value);

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
    const controls = new AudioControls(state, button(), effects, value);

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
    const controls = new AudioControls(state, button(), effects, value);

    expect(controls.setEffectsPercent('volume')).toBe(0.4);
    expect(state.effectsWrites).toEqual([]);
    expect(effects.value).toBe('40');
    expect(value.textContent).toBe('40%');
  });
});
