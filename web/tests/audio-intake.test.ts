import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(
  new URL('../../scripts/fetch-cc0-audio.cjs', import.meta.url),
);
const REPOSITORY_ROOT = dirname(dirname(SCRIPT));
const require = createRequire(import.meta.url);
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

function run(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function loadIntakeModule() {
  return require(SCRIPT) as {
    readonly AUDIO_PACKS: ReadonlyArray<{
      readonly id: string;
      readonly archiveName: string;
    }>;
    readonly runCli: (
      argv: ReadonlyArray<string>,
      dependencies?: { readonly fetcher?: typeof fetch },
    ) => Promise<{
      readonly output: string;
      readonly manifestPath: string;
      readonly records: ReadonlyArray<{
        readonly archiveName: string;
        readonly byteLength: number;
        readonly sha256: string;
      }>;
    }>;
  };
}

function zipResponse(
  options: {
    readonly bytes?: Uint8Array;
    readonly url?: string;
    readonly contentType?: string;
    readonly contentLength?: string;
  } = {},
) {
  const bytes = options.bytes ?? ZIP_BYTES;
  const headers = new Headers({
    'content-type': options.contentType ?? 'application/zip',
  });
  if (options.contentLength !== undefined) {
    headers.set('content-length', options.contentLength);
  }
  const response = new Response(bytes.slice().buffer, { headers });
  Object.defineProperty(response, 'url', {
    value:
      options.url ??
      'https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip',
  });
  return response;
}

function approvedArgs(output: string, ...packIds: string[]) {
  return [
    '--owner-approved-cc0-downloads',
    '--output',
    output,
    ...packIds.flatMap((id) => ['--download', id]),
  ];
}

describe('CC0 audio intake CLI', () => {
  it('lists the exact review candidates without downloading', () => {
    const result = run('--list');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const report = JSON.parse(result.stdout) as {
      readonly schema: number;
      readonly packs: ReadonlyArray<{
        readonly id: string;
        readonly license: string;
        readonly pageUrl: string;
        readonly downloadUrl: string;
      }>;
    };
    expect(report.schema).toBe(1);
    expect(report.packs.map((pack) => pack.id)).toEqual([
      'owlish-202-more-sfx',
      'rubberduck-100-sfx',
      'rubberduck-100-sfx-2',
      'rubberduck-30-sfx-loops',
    ]);
    expect(report.packs.every((pack) => pack.license === 'CC0-1.0')).toBe(true);
    expect(
      report.packs.every(
        (pack) =>
          pack.pageUrl.startsWith('https://opengameart.org/content/') &&
          pack.downloadUrl.startsWith('https://opengameart.org/sites/default/files/'),
      ),
    ).toBe(true);
  });

  it('refuses a download before the owner approval flag', () => {
    const result = run('--download', 'rubberduck-100-sfx');

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'downloads require --owner-approved-cc0-downloads',
    );
  });

  it('rejects unknown and duplicate packs before any injected fetch', async () => {
    let fetchCalls = 0;
    const { runCli } = loadIntakeModule();
    const fetcher = async () => {
      fetchCalls += 1;
      throw new Error('network must not be reached');
    };

    await expect(
      runCli(
        [
          '--owner-approved-cc0-downloads',
          '--download',
          'not-a-real-pack',
        ],
        { fetcher },
      ),
    ).rejects.toThrow('unknown CC0 audio pack: not-a-real-pack');
    await expect(
      runCli(
        [
          '--owner-approved-cc0-downloads',
          '--download',
          'rubberduck-100-sfx',
          '--download',
          'rubberduck-100-sfx',
        ],
        { fetcher },
      ),
    ).rejects.toThrow('duplicate CC0 audio pack: rubberduck-100-sfx');
    expect(fetchCalls).toBe(0);
  });

  it('rejects ambiguous flags before any injected fetch', async () => {
    let fetchCalls = 0;
    const { runCli } = loadIntakeModule();
    const fetcher = async () => {
      fetchCalls += 1;
      throw new Error('network must not be reached');
    };

    await expect(
      runCli(['--list', '--owner-approved-cc0-downloads'], { fetcher }),
    ).rejects.toThrow('--list cannot be combined with download arguments');
    await expect(
      runCli(['--output', 'unused'], { fetcher }),
    ).rejects.toThrow('--output requires at least one --download');
    await expect(
      runCli(['--list', '--list'], { fetcher }),
    ).rejects.toThrow('repeated argument: --list');
    expect(fetchCalls).toBe(0);
  });

  it('records a validated ZIP under a fixed filename', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'terrilives-audio-intake-test-'));
    const output = join(parent, 'intake');
    try {
      const { runCli } = loadIntakeModule();
      const report = await runCli(
        approvedArgs(output, 'rubberduck-100-sfx'),
        { fetcher: async () => zipResponse() },
      );
      const record = report.records[0];

      expect(record).toMatchObject({
        archiveName: 'rubberduck-100-sfx.zip',
        byteLength: ZIP_BYTES.length,
        sha256: createHash('sha256').update(ZIP_BYTES).digest('hex'),
      });
      expect(readFileSync(join(output, record.archiveName))).toEqual(
        Buffer.from(ZIP_BYTES),
      );
      expect(existsSync(join(output, `${record.archiveName}.part`))).toBe(false);
      expect(JSON.parse(readFileSync(report.manifestPath, 'utf8'))).toMatchObject({
        status: 'complete',
        requestedPackIds: ['rubberduck-100-sfx'],
      });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('rejects a redirected response outside the fixed HTTPS host', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'terrilives-audio-intake-test-'));
    const output = join(parent, 'intake');
    try {
      const { runCli } = loadIntakeModule();
      await expect(
        runCli(approvedArgs(output, 'rubberduck-100-sfx'), {
          fetcher: async () => zipResponse({ url: 'https://example.com/archive.zip' }),
        }),
      ).rejects.toThrow('unapproved download response host');
      expect(JSON.parse(readFileSync(join(output, 'intake-manifest.json'), 'utf8')))
        .toMatchObject({
          status: 'failed',
          failure: { packId: 'rubberduck-100-sfx' },
        });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('keeps intake outside the repository and refuses existing output', async () => {
    let fetchCalls = 0;
    const { runCli } = loadIntakeModule();
    const fetcher = async () => {
      fetchCalls += 1;
      return zipResponse();
    };
    const repositoryOutput = join(
      REPOSITORY_ROOT,
      `.cc0-intake-must-not-exist-${process.pid}`,
    );
    expect(existsSync(repositoryOutput)).toBe(false);
    await expect(
      runCli(approvedArgs(repositoryOutput, 'rubberduck-100-sfx'), { fetcher }),
    ).rejects.toThrow('output must remain outside the repository');
    expect(existsSync(repositoryOutput)).toBe(false);

    const parent = mkdtempSync(join(tmpdir(), 'terrilives-audio-intake-test-'));
    const existingOutput = join(parent, 'existing');
    mkdirSync(existingOutput);
    try {
      await expect(
        runCli(approvedArgs(existingOutput, 'rubberduck-100-sfx'), { fetcher }),
      ).rejects.toThrow('output path must not already exist');
      expect(fetchCalls).toBe(0);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('rejects invalid and oversized payloads without publishing an archive', async () => {
    const { runCli } = loadIntakeModule();
    for (const response of [
      zipResponse({
        bytes: new TextEncoder().encode('<html>not an archive</html>'),
        contentType: 'text/html',
      }),
      zipResponse({ contentLength: String(32 * 1024 * 1024 + 1) }),
    ]) {
      const parent = mkdtempSync(join(tmpdir(), 'terrilives-audio-intake-test-'));
      const output = join(parent, 'intake');
      try {
        await expect(
          runCli(approvedArgs(output, 'rubberduck-100-sfx'), {
            fetcher: async () => response,
          }),
        ).rejects.toThrow();
        expect(existsSync(join(output, 'rubberduck-100-sfx.zip'))).toBe(false);
        expect(existsSync(join(output, 'rubberduck-100-sfx.zip.part'))).toBe(false);
        expect(JSON.parse(readFileSync(join(output, 'intake-manifest.json'), 'utf8')))
          .toMatchObject({ status: 'failed' });
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    }
  });

  it('does not clobber a destination file created during a fetch', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'terrilives-audio-intake-test-'));
    const output = join(parent, 'intake');
    const sentinel = Buffer.from('keep-me');
    try {
      const { runCli } = loadIntakeModule();
      await expect(
        runCli(approvedArgs(output, 'rubberduck-100-sfx'), {
          fetcher: async () => {
            writeFileSync(join(output, 'rubberduck-100-sfx.zip'), sentinel);
            return zipResponse();
          },
        }),
      ).rejects.toThrow();
      expect(readFileSync(join(output, 'rubberduck-100-sfx.zip'))).toEqual(
        sentinel,
      );
      expect(existsSync(join(output, 'rubberduck-100-sfx.zip.part'))).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('keeps provenance when a later pack fails', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'terrilives-audio-intake-test-'));
    const output = join(parent, 'intake');
    let fetchCalls = 0;
    try {
      const { runCli } = loadIntakeModule();
      await expect(
        runCli(
          approvedArgs(
            output,
            'rubberduck-100-sfx',
            'rubberduck-100-sfx-2',
          ),
          {
            fetcher: async () => {
              fetchCalls += 1;
              if (fetchCalls === 1) return zipResponse();
              throw new Error('simulated second-pack failure');
            },
          },
        ),
      ).rejects.toThrow('simulated second-pack failure');

      expect(existsSync(join(output, 'rubberduck-100-sfx.zip'))).toBe(true);
      expect(JSON.parse(readFileSync(join(output, 'intake-manifest.json'), 'utf8')))
        .toMatchObject({
          status: 'failed',
          requestedPackIds: [
            'rubberduck-100-sfx',
            'rubberduck-100-sfx-2',
          ],
          records: [{ id: 'rubberduck-100-sfx' }],
          failure: {
            packId: 'rubberduck-100-sfx-2',
            message: 'simulated second-pack failure',
          },
        });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
