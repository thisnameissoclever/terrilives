export type ShortcutTool = 'furniture' | 'walls' | 'room' | 'buy' | 'floors';
interface ShortcutRow { readonly label: string; readonly keys: readonly string[]; readonly alternatives?: boolean }
interface ShortcutGroup { readonly label: string; readonly rows: readonly ShortcutRow[] }
const MOVE: ShortcutRow = { label: 'Move selection', keys: ['↑', '↓', '←', '→'], alternatives: true };
const CANCEL: ShortcutRow = { label: 'Cancel selection', keys: ['Esc'] };
const ROTATE: ShortcutRow = { label: 'Rotate clockwise', keys: ['R'] };

export function shortcutGroups(tool: ShortcutTool, coverings: readonly string[]): readonly ShortcutGroup[] {
  if (tool === 'walls') return [
    { label: 'Select an edge', rows: [MOVE, { label: 'Vertical edge', keys: ['V'] }, { label: 'Horizontal edge', keys: ['H'] }] },
    { label: 'Edit the edge', rows: [{ label: 'Wall', keys: ['W'] }, { label: 'Doorway', keys: ['D'] },
      { label: 'Window', keys: ['N'] }, { label: 'Remove', keys: ['Backspace', 'Delete'], alternatives: true }, CANCEL] },
  ];
  if (tool === 'room') return [{ label: 'Outline', rows: [MOVE, { label: 'Set first corner', keys: ['Enter'] },
    { label: 'Set opposite corner', keys: ['Enter'] }, { label: 'Build completed outline', keys: ['Enter'] },
    { label: 'Cycle doorway', keys: ['D'] }, CANCEL] }];
  if (tool === 'floors') return [{ label: 'Apply to the selected tile', rows: [
    ...coverings.slice(0, 9).map((label, index) => ({ label, keys: [String(index + 1)] })),
    { label: 'Restore original floor', keys: ['0'] }, CANCEL,
  ] }];
  return [{ label: 'Choose and position', rows: [{ label: 'Previous item', keys: ['['] },
    { label: 'Next item', keys: [']'] }, MOVE, ROTATE] },
    { label: 'Finish', rows: [{ label: tool === 'buy' ? 'Buy' : 'Confirm', keys: ['Enter'] },
      ...(tool === 'furniture' ? [{ label: 'Sell', keys: ['Delete', 'Backspace'], alternatives: true }] : []), CANCEL] }];
}

function appendGroups(doc: Document, root: HTMLElement, groups: readonly ShortcutGroup[]): void {
  for (const group of groups) {
    const section = doc.createElement('section'); section.className = 'shortcut-group';
    const heading = doc.createElement('h3'); heading.textContent = group.label; section.append(heading);
    const list = doc.createElement('dl');
    for (const row of group.rows) {
      const label = doc.createElement('dt'); label.textContent = row.label;
      const keys = doc.createElement('dd');
      row.keys.forEach((value, index) => {
        if (index > 0 && row.alternatives) keys.append(doc.createTextNode(' or '));
        const key = doc.createElement('kbd'); key.textContent = value; keys.append(key);
      });
      list.append(label, keys);
    }
    section.append(list); root.append(section);
  }
}

/** Build panels and Help use the same definitions, including content-authored floors. */
export function installShortcuts(doc: Document, coverings: readonly string[]): void {
  const tools: readonly ShortcutTool[] = ['furniture', 'walls', 'room', 'buy', 'floors'];
  const ids = ['builder', 'wall', 'room', 'buy', 'floor'];
  tools.forEach((tool, index) => {
    const root = doc.getElementById(`${ids[index]}-shortcut-content`);
    if (!root) throw new Error(`Missing shortcuts for ${tool}`);
    appendGroups(doc, root, shortcutGroups(tool, coverings));
  });
  const help = doc.getElementById('help-shortcut-content');
  if (!help) throw new Error('Missing Help shortcuts');
  appendGroups(doc, help, [{ label: 'People and actions', rows: [
    { label: 'Next target', keys: ['↓', '→'], alternatives: true },
    { label: 'Previous target', keys: ['↑', '←'], alternatives: true },
    { label: 'Select person', keys: ['Space'] }, { label: 'Open actions', keys: ['Enter'] },
    { label: 'Queue action: hold either key when selecting an action', keys: ['Ctrl', 'Cmd'], alternatives: true },
    { label: 'Clear target or close actions', keys: ['Esc'] },
  ] }]);
  appendGroups(doc, help, [{ label: 'Build mode', rows: [
    { label: 'Exit Build with no selection', keys: ['Esc'] },
  ] }]);
  for (const tool of tools) {
    const title = doc.createElement('h3'); title.className = 'shortcut-tool-name';
    title.textContent = tool.charAt(0).toUpperCase() + tool.slice(1); help.append(title);
    appendGroups(doc, help, shortcutGroups(tool, coverings));
  }
}
