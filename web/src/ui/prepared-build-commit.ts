import type { BuildToken, RoomResult } from '../rooms/codec.js';
import type { CharacterContactRoster, ContactAppearance, ContactStage } from '../render/character/contact-admission.js';
import type { CharacterPreparationMode } from '../render/character/character-preparation-service.js';

interface PreparedBuildHooks {
  poolRequired(token: BuildToken): RoomResult<boolean>;
  appearances(): readonly ContactAppearance[];
  prepareSceneAssets?(): Promise<void> | undefined;
  pending(active: boolean): void;
}

export type BuildCommitAttempt = (token: BuildToken, adopt: () => RoomResult<void>) =>
  RoomResult<void> | Promise<RoomResult<void> | null>;

export class PreparedBuildCommit {
  private controller: AbortController | null = null;

  constructor(
    private readonly contacts: Pick<CharacterContactRoster, 'mode' | 'stage'>,
    private readonly hooks: PreparedBuildHooks,
  ) {}

  run(token: BuildToken, adopt: () => RoomResult<void>): RoomResult<void> | Promise<RoomResult<void> | null> {
    this.cancel();
    const requirement = this.hooks.poolRequired(token);
    if (!requirement.ok) return requirement;
    const mode = requirement.value ? 'pool-required' : 'base';
    const sceneAssets = this.hooks.prepareSceneAssets?.();
    void sceneAssets?.catch(() => {});
    const stage = this.contacts.mode === mode ? undefined : this.contacts.stage(this.hooks.appearances(), undefined, { current: mode });
    if (!stage && !sceneAssets) return adopt();
    const controller = this.controller = new AbortController();
    this.hooks.pending(true);
    return this.adoptWhenReady(token, mode, adopt, stage, sceneAssets, controller);
  }

  cancel(): boolean {
    if (!this.controller) return false;
    this.controller.abort();
    return true;
  }

  private async adoptWhenReady(token: BuildToken, mode: CharacterPreparationMode,
    adopt: () => RoomResult<void>, stage: ContactStage | undefined, sceneAssets: Promise<void> | undefined,
    controller: AbortController): Promise<RoomResult<void> | null> {
    const { signal } = controller;
    let onAbort = () => {};
    try {
      const canceled = new Promise<void>(resolve => {
        onAbort = () => { stage?.release(); resolve(); };
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      await Promise.race([Promise.all([stage?.ready, sceneAssets]), canceled]);
      if (signal.aborted) return null;
      const current = this.hooks.poolRequired(token);
      if (!current.ok) return current;
      if (current.value !== (mode === 'pool-required')) throw new Error('Prepared Build requirement changed.');
      if (!stage) return adopt();
      let result: RoomResult<void> | null = null;
      stage.commit(() => {
        result = adopt();
        return result.ok;
      });
      return result;
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) return null;
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
      stage?.release();
      if (this.controller === controller) {
        this.controller = null;
        this.hooks.pending(false);
      }
    }
  }
}
