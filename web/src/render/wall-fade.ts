import type { RenderSource } from '../frame.js';
import type { EdgeWallPanel } from './edge-walls.js';
import { ACTIVITY_AT_WORK, FLOATS_PER_INSTANCE, KIND_AGENT, OFFSET_WALL_OPACITY, type InstanceArray } from './instances.js';

export const LOW_WALL_OPACITY = .25;
const TRANSITION_MS = 200;
const EXIT_MARGIN = .08;

type WallSource = Pick<RenderSource, 'count' | 'positions' | 'prevPositions' | 'kinds' | 'activities'>;
interface PanelFade { key: string; opacity: number; active: boolean; cells: readonly (readonly [number, number])[] }

/** Presentation-only state. Occupancy is collected once, not once per wall. */
export class WallFade {
  private rows: InstanceArray = new Float32Array();
  private panels: PanelFade[] = [];
  private width = 0;
  private height = 0;
  private occupied = new Uint8Array();
  private retained = new Uint8Array();

  reset(): void {
    for (const panel of this.panels) { panel.active = false; panel.opacity = 1; }
    this.write();
  }

  configure(rows: InstanceArray, panels: readonly EdgeWallPanel[], width: number, height: number): void {
    const old = new Map(this.panels.map(panel => [panel.key, panel]));
    this.rows = rows;
    this.panels = panels.map(panel => {
      const key = `${panel.x},${panel.y},${panel.spriteName}`;
      const previous = old.get(key);
      return { key, opacity: previous?.opacity ?? 1, active: previous?.active ?? false,
        cells: panel.farTiles ?? [] };
    });
    if (width !== this.width || height !== this.height) {
      this.width = width; this.height = height;
      this.occupied = new Uint8Array(width * height);
      this.retained = new Uint8Array(width * height);
    }
    this.write();
  }

  update(source: WallSource, alpha: number, elapsedMs: number, reducedMotion: boolean): void {
    if (this.panels.length === 0) return;
    this.occupied.fill(0); this.retained.fill(0);
    const positions = source.positions(), previous = source.prevPositions();
    const kinds = source.kinds(), activities = source.activities();
    for (let i = 0; i < source.count; i++) {
      if (kinds[i] !== KIND_AGENT || activities[i] === ACTIVITY_AT_WORK) continue;
      // These are resolved actor/socket coordinates, not an occupied sprite's
      // furniture-center registration. Read fresh views after each WASM sync.
      const x = previous[i * 2] + (positions[i * 2] - previous[i * 2]) * alpha;
      const y = previous[i * 2 + 1] + (positions[i * 2 + 1] - previous[i * 2 + 1]) * alpha;
      this.mark(this.occupied, Math.floor(x + .5), Math.floor(y + .5));
      for (let cy = Math.floor(y + .5 - EXIT_MARGIN); cy <= Math.floor(y + .5 + EXIT_MARGIN); cy++) {
        for (let cx = Math.floor(x + .5 - EXIT_MARGIN); cx <= Math.floor(x + .5 + EXIT_MARGIN); cx++) {
          this.mark(this.retained, cx, cy);
        }
      }
    }
    const step = Math.min(Math.max(elapsedMs, 0), TRANSITION_MS) / TRANSITION_MS * (1 - LOW_WALL_OPACITY);
    for (const panel of this.panels) {
      const cells = panel.active ? this.retained : this.occupied;
      panel.active = false;
      for (const cell of panel.cells) {
        const x = cell[0], y = cell[1];
        if (x >= 0 && y >= 0 && x < this.width && y < this.height && cells[y * this.width + x] !== 0) {
          panel.active = true;
          break;
        }
      }
      const target = panel.active ? LOW_WALL_OPACITY : 1;
      panel.opacity = reducedMotion ? target : panel.opacity < target
        ? Math.min(target, panel.opacity + step) : Math.max(target, panel.opacity - step);
    }
    this.write();
  }

  private mark(cells: Uint8Array, x: number, y: number): void {
    if (x >= 0 && y >= 0 && x < this.width && y < this.height) cells[y * this.width + x] = 1;
  }

  private write(): void {
    for (let i = 0; i < this.panels.length; i++) {
      this.rows[i * FLOATS_PER_INSTANCE + OFFSET_WALL_OPACITY] = this.panels[i].opacity;
    }
  }
}
