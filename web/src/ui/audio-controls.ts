export interface AudioSettings {
  isMuted(): boolean;
  setMuted(muted: boolean): void;
  effectsLevel(): number;
  previewEffectsLevel(level: number): void;
  setEffectsLevel(level: number): void;
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
 * The controller stores normalized 0..1 effects levels. The range input uses
 * whole percentages because that is what a player can read and adjust without
 * deciphering a decimal that exists only for the implementation's benefit.
 */
export class AudioControls {
  constructor(
    private readonly settings: AudioSettings,
    private readonly muteButton: AudioMuteButton,
    private readonly effectsSlider: AudioEffectsSlider,
    private readonly effectsValue: AudioEffectsValue,
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

  /** Re-reads the controller after storage, lifecycle, or external changes. */
  reflect(): void {
    const muted = this.settings.isMuted();
    const percent = Math.round(this.settings.effectsLevel() * 100);
    this.muteButton.textContent = muted ? 'Sound: off' : 'Sound: on';
    this.muteButton.setAttribute('aria-pressed', String(muted));
    this.effectsSlider.value = String(percent);
    this.effectsSlider.setAttribute('aria-valuetext', `${percent}%`);
    this.effectsValue.textContent = `${percent}%`;
  }
}
