export interface AudioSettings {
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  effectsLevel(): number;
  previewEffectsLevel(level: number): void;
  setEffectsLevel(level: number): void;
  voicesLevel(): number;
  previewVoicesLevel(level: number): void;
  setVoicesLevel(level: number): void;
  ambienceLevel(): number;
  previewAmbienceLevel(level: number): void;
  setAmbienceLevel(level: number): void;
}

export interface AudioMuteButton {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
}

export interface AudioEffectsSlider {
  value: string;
  setAttribute(name: string, value: string): void;
}

export interface AudioEffectsValue {
  textContent: string | null;
}

/**
 * Keeps the accessible audio controls synchronized with one settings owner.
 *
 * The controller stores normalized 0..1 levels. Each range input uses
 * whole percentages because that is what a player can read and adjust without
 * deciphering a decimal that exists only for the implementation's benefit.
 */
export class AudioControls {
  constructor(
    private readonly settings: AudioSettings,
    private readonly muteButton: AudioMuteButton,
    private readonly effectsSlider: AudioEffectsSlider,
    private readonly effectsValue: AudioEffectsValue,
    private readonly voicesSlider: AudioEffectsSlider,
    private readonly voicesValue: AudioEffectsValue,
    private readonly ambienceSlider: AudioEffectsSlider,
    private readonly ambienceValue: AudioEffectsValue,
  ) {
    this.reflect();
  }

  /** Toggles master mute and returns the resulting muted state. */
  toggleMuted(): boolean {
    this.settings.setMuted(!this.settings.isMuted());
    this.reflect();
    return this.settings.isMuted();
  }

  /** Applies the range input's whole-percent value through the settings owner. */
  setEffectsPercent(value: string): number {
    return this.applyEffectsPercent(value, false);
  }

  /** Applies live gain while dragging without persisting every input event. */
  previewEffectsPercent(value: string): number {
    return this.applyEffectsPercent(value, true);
  }

  private applyEffectsPercent(value: string, preview: boolean): number {
    const percent = Number(value);
    if (Number.isFinite(percent)) {
      if (preview) this.settings.previewEffectsLevel(percent / 100);
      else this.settings.setEffectsLevel(percent / 100);
    }
    this.reflect();
    return this.settings.effectsLevel();
  }

  setVoicesPercent(value: string): number {
    return this.applyVoicesPercent(value, false);
  }

  previewVoicesPercent(value: string): number {
    return this.applyVoicesPercent(value, true);
  }

  private applyVoicesPercent(value: string, preview: boolean): number {
    const percent = Number(value);
    if (Number.isFinite(percent)) {
      if (preview) this.settings.previewVoicesLevel(percent / 100);
      else this.settings.setVoicesLevel(percent / 100);
    }
    this.reflect();
    return this.settings.voicesLevel();
  }

  setAmbiencePercent(value: string): number { return this.applyAmbiencePercent(value, false); }
  previewAmbiencePercent(value: string): number { return this.applyAmbiencePercent(value, true); }
  private applyAmbiencePercent(value: string, preview: boolean): number {
    const percent = Number(value);
    if (Number.isFinite(percent)) {
      if (preview) this.settings.previewAmbienceLevel(percent / 100);
      else this.settings.setAmbienceLevel(percent / 100);
    }
    this.reflect();
    return this.settings.ambienceLevel();
  }

  /** Re-reads the controller after storage, lifecycle, or external changes. */
  reflect(): void {
    const muted = this.settings.isMuted();
    const percent = Math.round(this.settings.effectsLevel() * 100);
    this.muteButton.textContent = muted ? 'Sound: off' : 'Sound: on';
    this.muteButton.setAttribute('aria-pressed', String(muted));
    this.effectsSlider.value = String(percent);
    this.effectsSlider.setAttribute('aria-valuetext', `${percent}%`);
    this.effectsValue.textContent = `${percent}%`;
    const voicesPercent = Math.round(this.settings.voicesLevel() * 100);
    this.voicesSlider.value = String(voicesPercent);
    this.voicesSlider.setAttribute('aria-valuetext', `${voicesPercent}%`);
    this.voicesValue.textContent = `${voicesPercent}%`;
    const ambiencePercent = Math.round(this.settings.ambienceLevel() * 100);
    this.ambienceSlider.value = String(ambiencePercent);
    this.ambienceSlider.setAttribute('aria-valuetext', `${ambiencePercent}%`);
    this.ambienceValue.textContent = `${ambiencePercent}%`;
  }
}
