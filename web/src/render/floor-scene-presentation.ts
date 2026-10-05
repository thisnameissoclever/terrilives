/** A loaded scene is presented only when every placed finish is resident. */
export class FloorScenePresentation {
  private blocked = false;
  private error: string | null = null;
  constructor(private readonly hooks: {
    suspend(): void; resume(): void;
    status(blocked: boolean, error: string | null): void;
  }) {}

  update(required: readonly string[], resident: readonly string[], error: string | null): void {
    const blocked = required.some(key => !resident.includes(key));
    const sceneError = blocked ? error : null;
    if (blocked === this.blocked && sceneError === this.error) return;
    this.blocked = blocked;
    this.error = sceneError;
    if (blocked) this.hooks.suspend(); else this.hooks.resume();
    this.hooks.status(blocked, sceneError);
  }

  /** Camera/static upload and dynamic packing/draw form one presentation. */
  get visible(): boolean { return !this.blocked; }
}
