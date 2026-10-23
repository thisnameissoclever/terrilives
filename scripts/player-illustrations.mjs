import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from './player-markdown.mjs';

function dimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) throw Error('Invalid JPEG marker');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) {
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  throw Error('Guide illustrations need a valid PNG or JPEG with dimensions');
}

/** Capture provenance stays separate from the illustrations an article chooses. */
export function loadIllustrations(root) {
  const file = join(root, 'docs/player/illustrations.json');
  if (!existsSync(file)) return null;
  const registry = JSON.parse(readFileSync(file, 'utf8'));
  if (!registry.figures || typeof registry.figures !== 'object') throw Error('Missing curated guide figures');
  const sizes = new Map();
  return {
    render(id, imageUrl) {
      const figure = registry.figures[id];
      if (!figure?.title || !figure.desktop || !figure.mobile) throw Error(`Incomplete desktop/mobile illustration: ${id}`);
      const views = ['desktop', 'mobile'].map((device) => {
        const src = imageUrl(figure[device]);
        let size = sizes.get(figure[device]);
        if (!size) {
          size = dimensions(readFileSync(join(root, 'docs/player', figure[device])));
          if (!size.width || !size.height) throw Error(`Invalid illustration dimensions: ${id}`);
          sizes.set(figure[device], size);
        }
        const label = device === 'desktop' ? 'Desktop' : 'Phone';
        const caption = figure.caption ? `<figcaption>${escapeHtml(figure.caption)}</figcaption>` : '';
        return `<details class="illustration-view" data-device="${device}"${device === 'desktop' ? ' open' : ''}><summary>${escapeHtml(figure.title)} (${label})</summary><figure><div class="illustration-image"><img loading="lazy" width="${size.width}" height="${size.height}" src="${escapeHtml(src)}" alt="${escapeHtml(figure.title)} on ${label.toLowerCase()}"><button type="button" class="image-enlarge" hidden aria-label="Enlarge ${escapeHtml(figure.title)} image">Enlarge</button></div>${caption}</figure></details>`;
      }).join('');
      return `<aside class="guide-illustration" data-illustration="${escapeHtml(id)}" data-title="${escapeHtml(figure.title)}" aria-label="${escapeHtml(figure.title)} illustration">${views}</aside>`;
    },
  };
}

export function validateIllustrationCoverage(page, parsed, required) {
  if (!required || page !== 'ui-elements') return;
  let section;
  const covered = new Map();
  const parents = new Map();
  for (const heading of parsed.headings) {
    if (heading.level === 2) { section = heading.id; covered.set(section, false); }
    parents.set(heading.id, section);
  }
  for (const illustration of parsed.illustrations) covered.set(parents.get(illustration.heading), true);
  for (const [id, present] of covered) if (!present) throw Error(`Missing UI illustration coverage: ${id}`);
}

/** Small panels sit beside their explanation; wide panels retain their readable width. */
export function pairInstructionsWithFigures(html) {
  return html.split(/(?=<h[23] id=)/).map((block) => {
    const heading = /^(<h[23][\s\S]*?<\/h[23]>)/.exec(block);
    const figures = [...block.matchAll(/<aside class="guide-illustration"[\s\S]*?<\/aside>/g)];
    if (!heading || figures.length !== 1 || block.includes('<table')) return block;
    const copy = block.slice(heading[0].length).replace(figures[0][0], '');
    return `<section class="illustrated-section">${heading[0]}<div class="instruction-pair"><div class="instruction-copy">${copy}</div>${figures[0][0]}</div></section>`;
  }).join('\n');
}

export const illustrationControls = `<fieldset class="screenshot-layout" hidden><legend>Screenshot layout</legend><label><input type="radio" name="screenshot-layout" value="desktop">Desktop</label><label><input type="radio" name="screenshot-layout" value="mobile">Phone</label></fieldset>`;

export const imageViewer = `<dialog id="guide-image-viewer" aria-labelledby="guide-image-title"><div class="viewer-shell"><header><h2 id="guide-image-title"></h2><div class="viewer-controls"><button type="button" data-zoom="out" aria-label="Zoom out">Zoom out</button><button type="button" data-zoom="in" aria-label="Zoom in">Zoom in</button><button type="button" data-zoom="fit">Fit</button><button type="button" class="viewer-close" autofocus>Close</button></div></header><div class="viewer-stage"><img alt=""></div><p class="viewer-caption"></p></div></dialog>`;
