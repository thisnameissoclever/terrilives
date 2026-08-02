export interface MoodPanelSource {
  selectedIndex(): number | null;
  moodSnapshotOf(entity: number): Float32Array;
  moodSummaryOf(entity: number): string[];
}

export type MoodTone = 'negative' | 'neutral' | 'positive';

export interface MoodValueView {
  readonly label: string;
  readonly score: number;
  readonly percent: number;
  readonly tone: MoodTone;
}

export interface MoodletView extends MoodValueView {
  readonly key: string;
}

export interface MoodPanelView {
  readonly overall: MoodValueView;
  readonly moodlets: readonly MoodletView[];
}

export interface MoodPanelSurface {
  render(view: MoodPanelView | null): void;
}

interface MoodDescription {
  readonly score: number;
  readonly percent: number;
  readonly tone: MoodTone;
}

interface MoodletRow {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  readonly score: HTMLElement;
}

const MIN_SCORE = -100;
const MAX_SCORE = 100;
const NEUTRAL_PERCENT = 50;

function clampScore(score: number): number {
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, score));
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function describeFiniteMood(score: number): MoodDescription {
  const boundedScore = clampScore(score);
  return {
    score: boundedScore,
    percent: roundToTenth((boundedScore - MIN_SCORE) / 2),
    tone: boundedScore < 0 ? 'negative' : boundedScore > 0 ? 'positive' : 'neutral',
  };
}

function moodletKey(label: string, occurrence: number): string {
  return `${label}\u0000${occurrence}`;
}

function formatScore(score: number): string {
  const rounded = roundToTenth(score);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function moodPanelView(source: MoodPanelSource): MoodPanelView | null {
  const selected = source.selectedIndex();
  if (selected === null) {
    return null;
  }

  // The bridge may return a view into WebAssembly memory. Copy it before the
  // next bridge call, which is allowed to grow memory and detach the view.
  const scores = Array.from(source.moodSnapshotOf(selected));
  const summaries = Array.from(source.moodSummaryOf(selected));

  if (scores.length === 0 || scores.length !== summaries.length) {
    return null;
  }

  const labels: string[] = [];
  for (const summary of summaries) {
    if (typeof summary !== 'string' || summary.trim().length === 0) {
      return null;
    }
    labels.push(summary.trim());
  }

  if (scores.some((score) => !Number.isFinite(score))) {
    return null;
  }

  const overallDescription = describeFiniteMood(scores[0]);
  const occurrences = new Map<string, number>();
  const moodlets: MoodletView[] = [];

  for (let index = 1; index < scores.length; index += 1) {
    const label = labels[index];
    const occurrence = occurrences.get(label) ?? 0;
    occurrences.set(label, occurrence + 1);
    const description = describeFiniteMood(scores[index]);

    moodlets.push({
      key: moodletKey(label, occurrence),
      label,
      ...description,
    });
  }

  return {
    overall: {
      label: labels[0],
      ...overallDescription,
    },
    moodlets,
  };
}

export class MoodPanel {
  private lastRenderMs: number | null = null;

  constructor(
    private readonly source: MoodPanelSource,
    private readonly surface: MoodPanelSurface,
    private readonly refreshMs: number,
  ) {
    if (!Number.isFinite(refreshMs) || refreshMs <= 0) {
      throw new Error('Mood panel refresh interval must be a positive finite number');
    }
  }

  update(nowMs: number, force = false): boolean {
    if (
      !force &&
      this.lastRenderMs !== null &&
      nowMs - this.lastRenderMs < this.refreshMs
    ) {
      return false;
    }

    this.surface.render(moodPanelView(this.source));
    this.lastRenderMs = nowMs;
    return true;
  }
}

function createMoodletRow(doc: Document): MoodletRow {
  const root = doc.createElement('li');
  root.className = 'moodlet-row';

  const label = doc.createElement('span');
  label.className = 'moodlet-label';

  const score = doc.createElement('span');
  score.className = 'moodlet-score';

  root.append(label, score);
  return { root, label, score };
}

function updateMoodletRow(row: MoodletRow, moodlet: MoodletView): void {
  row.root.dataset.tone = moodlet.tone;
  row.root.setAttribute('aria-label', `${moodlet.label}: ${formatScore(moodlet.score)}`);
  row.label.textContent = moodlet.label;
  row.score.textContent = formatScore(moodlet.score);
}

function resetOverallMeter(
  overallLabel: HTMLElement,
  overallMeter: HTMLElement,
  marker: HTMLElement,
): void {
  overallLabel.textContent = '';
  overallMeter.dataset.tone = 'neutral';
  overallMeter.setAttribute('aria-valuenow', '0');
  overallMeter.setAttribute('aria-valuetext', 'Mood unavailable');
  marker.style.left = `${NEUTRAL_PERCENT}%`;
}

export function createMoodPanelSurface(
  doc: Document,
  empty: HTMLElement,
  content: HTMLElement,
  overallLabel: HTMLElement,
  overallMeter: HTMLElement,
  marker: HTMLElement,
  list: HTMLElement,
): MoodPanelSurface {
  const rowByKey = new Map<string, MoodletRow>();
  const noMoodlets = doc.createElement('li');
  noMoodlets.className = 'moodlet-empty';
  noMoodlets.textContent = 'No active moodlets.';

  overallMeter.setAttribute('role', 'meter');
  overallMeter.setAttribute('aria-label', 'Overall mood');
  overallMeter.setAttribute('aria-valuemin', String(MIN_SCORE));
  overallMeter.setAttribute('aria-valuemax', String(MAX_SCORE));
  resetOverallMeter(overallLabel, overallMeter, marker);

  function clearRows(): void {
    for (const row of rowByKey.values()) {
      row.root.remove();
    }
    rowByKey.clear();
    noMoodlets.remove();
  }

  return {
    render(view: MoodPanelView | null): void {
      if (view === null) {
        clearRows();
        empty.hidden = false;
        empty.textContent = 'Mood unavailable';
        content.hidden = true;
        list.hidden = true;
        resetOverallMeter(overallLabel, overallMeter, marker);
        return;
      }

      empty.hidden = true;
      content.hidden = false;
      overallLabel.textContent = view.overall.label;
      overallMeter.dataset.tone = view.overall.tone;
      overallMeter.setAttribute('aria-valuenow', String(roundToTenth(view.overall.score)));
      overallMeter.setAttribute('aria-valuetext', view.overall.label);
      marker.style.left = `${view.overall.percent}%`;

      noMoodlets.remove();
      const liveKeys = new Set(view.moodlets.map((moodlet) => moodlet.key));
      for (const [key, row] of rowByKey) {
        if (!liveKeys.has(key)) {
          row.root.remove();
          rowByKey.delete(key);
        }
      }

      for (let index = 0; index < view.moodlets.length; index += 1) {
        const moodlet = view.moodlets[index];
        let row = rowByKey.get(moodlet.key);
        if (row === undefined) {
          row = createMoodletRow(doc);
          rowByKey.set(moodlet.key, row);
        }
        updateMoodletRow(row, moodlet);

        const current = list.children.item(index);
        if (current !== row.root) {
          list.insertBefore(row.root, current);
        }
      }

      list.hidden = false;
      if (view.moodlets.length === 0) {
        list.append(noMoodlets);
      }
    },
  };
}
