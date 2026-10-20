import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Keep the screenshot inventory and the galleries it publishes in one source. */
export function addScreenshotGalleries(root, source, page, required) {
  const file = join(root, 'docs/player/screenshots.json');
  if (!existsSync(file)) {
    if (required && page === 'ui-elements') throw Error('Missing desktop/mobile screenshot inventory');
    return source;
  }
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(manifest.entries)) throw Error('Invalid screenshot inventory');
  const ids = new Set();
  for (const entry of manifest.entries) {
    if (!entry.id || ids.has(entry.id)) throw Error('Invalid or duplicate screenshot entry');
    ids.add(entry.id);
    if (!entry.desktop || !entry.mobile || !entry.description || !entry.access) throw Error('Incomplete desktop/mobile screenshot pair: ' + entry.id);
  }
  if (!['ui-elements', 'the-world'].includes(page)) return source;
  const headings = [...source.matchAll(/^## (.+?) \{#([a-z0-9-]+)\}\s*$/gm)];
  let out = source.slice(0, headings[0]?.index ?? source.length);
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i], section = heading[2];
    out += source.slice(heading.index, headings[i + 1]?.index ?? source.length);
    const specified = (page === 'ui-elements' ? manifest.uiSections : manifest.worldSections)?.[section];
    const entries = specified ? specified.map((id) => manifest.entries.find((entry) => entry.id === id))
      : manifest.entries.filter((entry) => entry.section === section && (entry.page ?? 'ui-elements') === page);
    if (page === 'ui-elements' && !entries.length) throw Error('Missing UI screenshot coverage: ' + section);
    if (!entries.length) continue;
    if (entries.some((entry) => !entry)) throw Error('Unknown screenshot reference: ' + section);
    for (const entry of entries) {
      out += `\n\n:::screenshots Desktop and phone: ${entry.description}\n\n${entry.access}\n`;
      for (const [field, label] of [['desktopDetail', 'Desktop panel close-up'], ['desktop', 'Desktop location'], ['mobileDetail', 'Phone panel close-up'], ['mobile', 'Phone location']]) {
        if (!entry[field]) continue;
        out += `\n${label}. Select the image to inspect it at full size.\n\n![${label}: ${entry.description}](${entry[field]})\n`;
      }
      out += '\n:::\n\n';
    }
  }
  return out;
}
