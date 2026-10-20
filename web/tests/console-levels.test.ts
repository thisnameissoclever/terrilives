import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'wasm' ? [] : sources(path);
    return /\.ts$/.test(name) ? [path] : [];
  });
}

describe('console levels', () => {
  // Routine reports go to console.debug, which browsers hide by default.
  // Problems use console.warn or console.error, through diagnostics/log.ts.
  it('keeps console.log and console.info out of the game sources', () => {
    const offenders = sources(SRC).flatMap(path => readFileSync(path, 'utf8').split('\n')
      .flatMap((line, index) => /\bconsole\.(log|info)\s*\(/.test(line) ? [`${relative(SRC, path)}:${index + 1}`] : []));
    expect(offenders).toEqual([]);
  });
});
