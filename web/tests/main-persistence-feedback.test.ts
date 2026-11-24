import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { SceneFeedback, operationFeedback } from '../src/ui/operation-feedback.js';
import { PersistenceSceneFeedback } from '../src/ui/persistence-feedback.js';
import { PersistenceController, restorePersistenceFocus } from '../src/ui/persistence-controller.js';

/** Execute the maintained listener, including its complete asynchronous world cleanup. */
function confirmedLoadSource(): string {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
  const body = file.statements.filter(ts.isFunctionDeclaration).find(node => node.name?.text === 'main')!.body!;
  const registration = body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(file) === 'confirmLoadGame.addEventListener');
  if (!registration) throw new Error('Missing maintained confirmed-Load listener');
  const helpers = ['refreshHudPanels', 'adoptLoadedWorld'].map(name => {
    const statement = body.statements.find(node => ts.isVariableStatement(node)
      && node.declarationList.declarations.some(declaration => declaration.name.getText(file) === name));
    if (!statement) throw new Error(`Missing Load helper ${name}`);
    return statement.getText(file);
  });
  return ts.transpile([...helpers, registration.getText(file)].join('\n'), { target: ts.ScriptTarget.ES2022 });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((pass, fail) => { resolve = pass; reject = fail; });
  return { promise, resolve, reject };
}

function fixture() {
  const attributes = new Map<string, string>();
  const element = { textContent: '', dataset: {}, style: {},
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    removeAttribute: (key: string) => attributes.delete(key),
    getAttribute: (key: string) => attributes.get(key) ?? null };
  const sceneFeedback = new SceneFeedback(element as unknown as HTMLElement);
  const hint = { hidden: true, textContent: '', setAttribute: vi.fn(), removeAttribute: vi.fn() };
  const presentation = new PersistenceSceneFeedback(sceneFeedback, hint);
  const waiting = deferred<Uint8Array | null>(), finished = deferred<void>();
  const loadGameDialog = { open: true, close: vi.fn(() => { loadGameDialog.open = false; }), contains: () => false };
  const store = { load: vi.fn(() => { expect(loadGameDialog.open).toBe(false); return waiting.promise; }),
    lastGoodCopy: async () => null, restoreLastGood: async () => false,
    save: async () => {}, clear: async () => {}, close: () => {} };
  const persistence = new PersistenceController(store, {
    saveBytes: () => new Uint8Array([1]), loadBytes: () => true, clockTick: () => 0, dayTicks: () => 100,
  }, hint, vi.fn(), undefined, event => presentation.present(event));
  const optionsToggle = { disabled: false, focus: vi.fn() }, body = {};
  const resettable = () => ({ resetAfterLoad: vi.fn(), update: vi.fn() });
  let listener!: (event: { preventDefault(): void }) => void;
  const context = {
    confirmLoadGame: { addEventListener: (_event: string, handler: typeof listener) => { listener = handler; } },
    loadingGame: false, loadGameDialog, persistence, sceneFeedback, commandStatus: sceneFeedback.status,
    syncPersistenceButtons: vi.fn(() => { expect(loadGameDialog.open).toBe(false); }),
    wallFade: { reset: vi.fn() }, adoptLotShape: vi.fn(), lot: { architecture: {} },
    sim: { wallTiles: () => [], wallEdges: () => [], windowLines: () => [], windowPlacements: () => [],
      floorTiles: () => [], worldSurfaces: () => [], interiorDoorLines: () => [], interiorHorizontalDoorLines: () => [],
      frontDoorLines: () => [], streetColumn: () => null, orderEventsSince: () => ({ nextCursor: '9' }) },
    decodeWindowPlacements: () => [], lightingDirty: false, cameraDirty: false,
    menu: { close: vi.fn() }, keyboardTargets: { clear: vi.fn() }, bookResults: resettable(),
    orderDiagnostics: resettable(), bookCommerce: resettable(), builder: resettable(),
    activityLogStore: resettable(), activityLogPanel: resettable(),
    careerReviewWindow: { close: vi.fn() }, adminPanel: { close: vi.fn() },
    housemateDialog: { open: false, close: vi.fn() }, housemateView: undefined, creatorSession: undefined,
    characterWorld: { reset: vi.fn(), prepareFixtures: vi.fn() }, bedAssignmentPanel: resettable(),
    careerPanel: resettable(), syncNewHousemateButton: vi.fn(), syncEditHousemateButton: vi.fn(),
    wallTool: resettable(), windowTool: resettable(), buyTool: resettable(), roomTool: resettable(),
    floorTool: resettable(), landTool: resettable(), lotWidth: 5, lotHeight: 5, audio: { reset: vi.fn() },
    householdRoster: resettable(), peoplePanel: resettable(), moodPanel: resettable(), traitsPanel: resettable(),
    personalDetailsPanel: resettable(), skillsPanel: resettable(), affinitiesPanel: resettable(),
    document: { activeElement: body, body }, restorePersistenceFocus, optionsToggle, persistenceFocusFallbacks: [optionsToggle],
    overlayPause: { resume: vi.fn(() => { finished.resolve(); }) },
  };
  new Function('ctx', `with(ctx){${confirmedLoadSource()}}`)(context);
  return { element, attributes, sceneFeedback, persistence, waiting, finished, context, optionsToggle,
    click: () => { const event = { preventDefault: vi.fn() }; listener(event); return event; } };
}

afterEach(() => { vi.restoreAllMocks(); });

it('retains the successful confirmed-Load receipt through actual world cleanup and its normal lifetime', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const f = fixture();
  f.sceneFeedback.status.textContent = 'Obsolete command';
  f.sceneFeedback.status.setAttribute('data-kind', 'error');
  const click = f.click(); expect(click.preventDefault).toHaveBeenCalledOnce();
  expect(f.context.loadGameDialog.close).toHaveBeenCalledWith('confirm');
  expect(f.element.textContent).toBe('Loading'); expect(f.attributes.get('data-pending')).toBe('true');
  expect(f.persistence.controlState().confirmationDisabled).toBe(true);
  f.waiting.resolve(new Uint8Array([1])); await f.finished.promise;
  expect(f.context.builder.resetAfterLoad).toHaveBeenCalledOnce();
  expect(f.context.orderDiagnostics.resetAfterLoad).toHaveBeenCalledWith('9');
  expect(f.context.audio.reset).toHaveBeenCalledWith('load');
  expect(f.context.cameraDirty).toBe(true); expect(f.context.lightingDirty).toBe(true);
  expect(f.optionsToggle.focus).toHaveBeenCalledOnce(); expect(f.context.loadingGame).toBe(false);
  expect(f.context.overlayPause.resume).toHaveBeenCalledWith('load-game');
  expect(f.persistence.controlState().confirmationDisabled).toBe(false);
  expect(f.attributes.has('data-pending')).toBe(false);
  expect(f.element.textContent).toBe('Saved game loaded');
  f.sceneFeedback.frame(3999); expect(f.element.textContent).toBe('Saved game loaded');
  f.sceneFeedback.frame(4000); expect(f.element.textContent).toBe('');
});

it('retains the actual confirmed-Load failure and releases its controls and focus', async () => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  const f = fixture();
  f.sceneFeedback.present('build', operationFeedback('place', 'failure', 'Chair', 'Occupied.'));
  f.click(); f.waiting.reject(new Error('Storage unavailable')); await f.finished.promise;
  expect(f.context.builder.resetAfterLoad).not.toHaveBeenCalled();
  expect(f.element.textContent).toContain('Load failed. Saving paused. Retry Load');
  f.sceneFeedback.frame(99000); expect(f.element.textContent).toContain('Saving paused');
  expect(f.attributes.has('data-pending')).toBe(false);
  expect(f.context.loadingGame).toBe(false); expect(f.optionsToggle.focus).toHaveBeenCalledOnce();
  expect(f.persistence.controlState().confirmationDisabled).toBe(false);
});
