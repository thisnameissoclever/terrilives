import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import init, { SimHandle } from '../src/wasm/terri_wasm.js';
import { SimBridge } from '../src/bridge.js';
import { WindowTool } from '../src/ui/window-tool.js';
import { DOORWAY, OPEN, WALL, WallTool, stateOf } from '../src/ui/wall-tool.js';
import { coveredWindowLines } from '../src/architecture/windows.js';
import { WallToolControls } from '../src/ui/wall-tool-controls.js';
import { WindowToolControls, drawWindowThumbnails } from '../src/ui/window-tool-controls.js';
import { BuildToolSwitch } from '../src/ui/build-tools.js';
import { architectureSprite } from '../src/render/architecture.js';

let memory: WebAssembly.Memory;
beforeAll(async () => { ({ memory } = await init({ module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm') })); });
class Element {
  hidden = false; disabled = false; textContent = ''; type = ''; className = ''; width = 0; height = 0;
  readonly children: Element[] = []; readonly attributes = new Map<string, string>();
  readonly events = new Map<string, (() => void)[]>();
  classList = { toggle: vi.fn() }; focused = false;
  constructor(readonly tag = 'div') {}
  append(...children: Element[]) { this.children.push(...children); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void) { this.events.set(name, [...this.events.get(name) ?? [], listener]); }
  click() { if (!this.disabled) this.events.get('click')?.forEach(listener => listener()); }
  focus() { this.focused = true; }
  closest() { return this; }
}
function fixture() {
  const handle = SimHandle.from_lot(), bridge = new SimBridge(handle, memory), elements = new Map<string, Element>();
  const element = (selector: string): Element => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector)!;
  };
  const document = { querySelector: element, createElement: (tag: string) => new Element(tag) } as unknown as Document;
  const tool = new WindowTool(bridge, handle.lot_width(), handle.lot_height(), { changed() {} });
  const walls = new WallTool(bridge, handle.lot_width(), handle.lot_height(), { changed() {} }, tool);
  const thumbnails = vi.fn(async (_samples: Parameters<typeof drawWindowThumbnails>[0]) => {});
  const controls = new WindowToolControls(document, tool, walls, thumbnails);
  return { handle, bridge, document, element, tool, walls, controls, thumbnails };
}
describe('window chooser', () => {
  it('Back exposes enabled wall actions for the selected window unit without editing it', () => {
    for (const axis of [0, 1] as const) for (const model of [1, 4, 7] as const) {
      for (const [button, target] of [['#wall-build', WALL], ['#wall-doorway', DOORWAY], ['#wall-remove', OPEN]] as const) {
        const f = fixture();
        try {
          const start = { axis, x: axis === 0 ? 18 : 3, y: axis === 0 ? 4 : 14 };
          const lines = coveredWindowLines({ ...start, model }, f.tool.catalogue);
          for (const line of lines) { f.bridge.setWallEdge(axis, line.x, line.y, WALL); f.bridge.flushCommands(); }
          f.bridge.fitWindow(axis, start.x, start.y, model); f.bridge.flushCommands();
          const wallControls = new WallToolControls(f.document, f.walls);
          f.walls.enter(); f.walls.choose(lines.at(-1)!); f.controls.render(); wallControls.render();
          expect(f.element('#wall-actions').hidden).toBe(true);
          const before = f.bridge.saveBytes();
          f.element('#window-back').click(); f.controls.render(); wallControls.render();
          expect(f.bridge.saveBytes()).toEqual(before); expect(f.walls.line).toEqual(lines.at(-1));
          expect(f.element('#window-choices').hidden).toBe(true); expect(f.element('#wall-actions').hidden).toBe(false);
          expect(f.element(button).disabled).toBe(false); f.element(button).click();
          expect(f.walls.pending).toBe(target);
          f.bridge.flushCommands(); f.walls.afterCommands(); f.tool.afterCommands();
          expect(f.bridge.windowPlacements()).toHaveLength(0);
          expect(lines.map(line => stateOf(f.bridge.wallEdges()!, line))).toEqual(
            lines.map((_, i) => target === DOORWAY && i !== lines.length - 1 ? WALL : target));
        } finally { f.handle.free(); }
      }
    }
  });
  it('groups the Rust catalogue by width with actual model samples and literal labels', () => {
    const f = fixture();
    try {
      const groups = f.element('#window-models').children;
      expect(groups.map(group => group.children[0].textContent)).toEqual(['1-unit windows', '2-unit windows', '3-unit windows']);
      expect(groups.flatMap(group => group.children.slice(1)).map(button => button.children.slice(1).map(child => child.textContent)))
        .toEqual(f.tool.catalogue.map(model => [model.label, `${model.width}-unit`]));
      expect(f.thumbnails).toHaveBeenCalledTimes(1);
      expect(f.thumbnails.mock.calls[0][0]).toHaveLength(9);
      f.walls.enter(); f.walls.selectWindows();
      const chosen = groups[2].children[3]; chosen.click(); f.controls.render();
      expect(f.tool.chosen).toBe(9); expect(chosen.attributes.get('aria-pressed')).toBe('true');
      expect(f.element('#window-choices').hidden).toBe(false); expect(f.element('#wall-actions').hidden).toBe(true);
    } finally { f.handle.free(); }
  });
  it('keeps fit/remove controls literal and disabled while loading or awaiting an authoritative result', () => {
    const f = fixture();
    try {
      f.walls.enter(); f.walls.selectWindows(); f.tool.choose({ axis: 1, x: 10, y: 0 }); f.controls.render();
      expect(f.element('#window-fit').disabled).toBe(false); expect(f.element('#window-remove').hidden).toBe(true);
      f.element('#window-fit').click(); f.controls.render();
      expect(f.element('#window-fit').disabled).toBe(true); expect(f.element('#window-back').disabled).toBe(true);
      expect(f.element('#window-status').textContent).toBe('Applying window change.');
      f.bridge.flushCommands(); f.tool.afterCommands(); f.controls.render();
      expect(f.element('#window-fit').textContent).toBe('Replace window'); expect(f.element('#window-remove').hidden).toBe(false);
      f.tool.setBlocked(true); f.controls.render(); expect(f.element('#window-remove').disabled).toBe(true);
      expect(f.element('#window-models').children.every(group => group.children.slice(1).every(button => button.disabled))).toBe(true);
      f.tool.setBlocked(false); f.controls.render(); f.element('#window-remove').click();
      Object.defineProperty(f.document, 'activeElement', { value: f.element('#window-remove') });
      f.bridge.flushCommands(); f.tool.afterCommands(); f.controls.render();
      expect(f.bridge.windowPlacements()).toHaveLength(0); expect(f.element('#window-fit').focused).toBe(true);
    } finally { f.handle.free(); }
  });
  it('changes help at the responsive breakpoint without losing selection and returns focus to Wall controls', () => {
    const f = fixture();
    try {
      f.walls.enter(); new WallToolControls(f.document, f.walls);
      f.element('#wall-window').click();
      expect(f.element('#window-models button[aria-pressed="true"]').focused).toBe(true);
      f.tool.chooseModel(8); f.tool.choosePoint(10, -.5);
      const candidate = f.tool.preview();
      for (const compact of [true, false, true]) {
        f.controls.setCompact(compact);
        expect(f.element('#window-keyboard-help').hidden).toBe(compact);
        expect(f.element('#window-touch-help').hidden).toBe(!compact);
        expect(f.tool.preview()).toBe(candidate);
      }
      f.element('#window-back').click(); expect(f.tool.active).toBe(false); expect(f.element('#wall-window').focused).toBe(true);
      let allowed = false;
      const focus = vi.fn();
      const chooser = new BuildToolSwitch(f.document, [{ tool: f.walls, button: 'walls', panel: 'wall-tool' }],
        { leaveFurniture: () => allowed, focusView: focus });
      expect(chooser.select('walls')).toBe(false); expect(focus).not.toHaveBeenCalled();
      allowed = true; expect(chooser.select('walls')).toBe(true); expect(focus).toHaveBeenCalledOnce();
    } finally { f.handle.free(); }
  });
  it('shares one atlas decode and composites registered pieces without stretching', async () => {
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob() }));
    const bitmap = { close: vi.fn() }, decode = vi.fn(async () => bitmap);
    vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('createImageBitmap', decode);
    vi.stubGlobal('location', { href: 'https://example.test/game/' });
    const draws: number[][] = [];
    const samples = ([1, 4, 7] as const).map(model => ({ model, canvas: { width: 144, height: 120,
      getContext: () => ({ imageSmoothingEnabled: true, drawImage: (_image: unknown, ...args: number[]) => draws.push(args) }) } as unknown as HTMLCanvasElement }));
    try {
      await drawWindowThumbnails(samples);
      expect(fetchMock).toHaveBeenCalledOnce(); expect(decode).toHaveBeenCalledOnce(); expect(bitmap.close).toHaveBeenCalledOnce();
      expect(draws).toHaveLength(6);
      const pieces = samples.flatMap(sample => architectureSprite(sample.model, 1, 'front', false));
      pieces.forEach((piece, i) => {
        expect(draws[i].slice(0, 4)).toEqual([piece.x, piece.y, piece.w, piece.h]);
        expect(draws[i][6] / draws[i][7]).toBeCloseTo(piece.w / piece.h);
      });
    } finally {
      vi.unstubAllGlobals();
      if (originalLocation) Object.defineProperty(globalThis, 'location', originalLocation);
    }
  });
  it('keeps N scoped to game-view keyboard focus and uses the existing scrolling dock', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const start = main.indexOf("canvas.addEventListener('keydown', (event) => {", main.indexOf('toolSwitch = new BuildToolSwitch'));
    const keyboard = main.slice(start, main.indexOf("window.addEventListener('resize', () => menu.close())", start));
    expect(keyboard).toContain("event.key.toLowerCase() === 'n'");
    expect(keyboard).toContain("toolSwitch?.select('build-tool-walls')");
    expect(keyboard).toContain('!event.ctrlKey && !event.metaKey && !event.altKey');
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toContain('#wall-tool.window-editing .builder-choices { min-height: 52px; }');
    expect(html).toContain('id="wall-remove" class="hud-button" type="button">Remove wall');
    expect(html).toContain('id="window-remove" class="hud-button" type="button" hidden>Remove window');
    expect(html).toContain('grid-template-columns: repeat(auto-fit, minmax(min(100%, 5.625rem), 1fr))');
    expect(html).toContain('height: 80px; object-fit: contain');
    expect(html).toContain('padding: 4px; overflow-wrap: normal;');
  });
});
