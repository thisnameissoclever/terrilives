#!/usr/bin/env node
/**
 * Measures and level-matches the recorded Sim voice clips.
 *
 * The game plays these clips back to back to cover one conversation, chosen
 * at random from the library, so two things have to be true of the shipped
 * set that are not true of raw recordings:
 *
 *  1. Every clip sounds equally loud. Random selection makes a level jump
 *     between neighbouring clips far more obvious than it is in isolation.
 *  2. Every clip is a whole number of simulation ticks long. The simulation
 *     counts in ticks at TICK_HZ, so a clip of 2.37 seconds cannot be
 *     represented exactly and would leave audio and simulation disagreeing
 *     by up to half a tick at every conversation.
 *
 * Loudness is measured the way ITU-R BS.1770 defines it: a two-stage
 * K-weighting filter models what the ear is sensitive to, then block-gated
 * mean square energy gives one number per clip. Matching PEAK levels instead
 * would be close to useless here, because the loudest single sample in a clip
 * says very little about how loud that clip sounds.
 *
 * No dependencies, in keeping with `fetch-cc0-audio.cjs`. WAV is a simple
 * enough container to read and write directly, which is the reason the
 * recording format matters: an MP3 would need a decoder this cannot have.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Fixed simulation rate. Must match `TICK_HZ` in the Rust simulation. */
const TICK_HZ = 10;

/**
 * Sentinel target meaning "match the quietest clip in the set".
 *
 * The default, and the right default. Levelling a set can move clips up or
 * down, and moving one UP raises its noise floor and room tone with it: the
 * quietest recording in this set would need about 11 dB, which is audible as
 * hiss. Matching downward instead costs nothing, because attenuation cannot
 * add noise. It also suits what these clips are: nonverbal babble that should
 * sit under the game rather than demand attention.
 *
 * Playback loudness is a SEPARATE decision, made by a gain the game applies
 * at play time. Keeping the two apart means retuning how loud Sims are in the
 * mix is one number in the tuning file, not a reprocessing pass over the
 * audio.
 */
const MATCH_QUIETEST = Symbol('match-quietest');

/**
 * Ceiling for any sample after gain, as a linear amplitude.
 *
 * Well below full scale on purpose. Up to eight voices can sound at once, so
 * a clip normalised to the edge of the format would distort the moment a
 * conversation lands on top of footsteps.
 */
const PEAK_CEILING = 0.5;

// ---------------------------------------------------------------------------
// WAV reading
// ---------------------------------------------------------------------------

/**
 * Reads a RIFF/WAVE file into planar float channels in [-1, 1].
 *
 * Handles the three encodings Audacity exports: 16-bit and 24-bit signed
 * integer PCM, and 32-bit float. Anything else is rejected by name rather
 * than misread, because a silently wrong sample scale would show up only as
 * a loudness measurement that is quietly nonsense.
 */
function readWav(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path.basename(filePath)}: not a RIFF/WAVE file`);
  }

  let format = null;
  let dataStart = -1;
  let dataLength = 0;

  // Chunk walk. Chunks are word aligned, so an odd size is followed by one
  // pad byte that is not counted in the size field.
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      let audioFormat = buf.readUInt16LE(body);
      const channels = buf.readUInt16LE(body + 2);
      const sampleRate = buf.readUInt32LE(body + 4);
      const bitsPerSample = buf.readUInt16LE(body + 14);
      // WAVE_FORMAT_EXTENSIBLE stores the real format in a sub-GUID whose
      // first two bytes carry the same code as the plain tag.
      if (audioFormat === 0xfffe && size >= 40) {
        audioFormat = buf.readUInt16LE(body + 24);
      }
      format = { audioFormat, channels, sampleRate, bitsPerSample };
    } else if (id === 'data') {
      dataStart = body;
      dataLength = Math.min(size, buf.length - body);
    }

    offset = body + size + (size % 2);
  }

  if (!format) throw new Error(`${path.basename(filePath)}: no fmt chunk`);
  if (dataStart < 0) throw new Error(`${path.basename(filePath)}: no data chunk`);

  const { audioFormat, channels, sampleRate, bitsPerSample } = format;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * channels));
  const planes = Array.from({ length: channels }, () => new Float64Array(frameCount));

  let read;
  if (audioFormat === 3 && bitsPerSample === 32) {
    read = (at) => buf.readFloatLE(at);
  } else if (audioFormat === 1 && bitsPerSample === 16) {
    read = (at) => buf.readInt16LE(at) / 32768;
  } else if (audioFormat === 1 && bitsPerSample === 24) {
    read = (at) => {
      const raw = buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16);
      // Sign-extend the 24-bit value into JavaScript's 32-bit bitwise range.
      return ((raw << 8) >> 8) / 8388608;
    };
  } else if (audioFormat === 1 && bitsPerSample === 32) {
    read = (at) => buf.readInt32LE(at) / 2147483648;
  } else {
    throw new Error(
      `${path.basename(filePath)}: unsupported encoding (format ${audioFormat}, ${bitsPerSample}-bit)`,
    );
  }

  for (let frame = 0; frame < frameCount; frame += 1) {
    const base = dataStart + frame * bytesPerSample * channels;
    for (let ch = 0; ch < channels; ch += 1) {
      planes[ch][frame] = read(base + ch * bytesPerSample);
    }
  }

  return { sampleRate, channels, bitsPerSample, audioFormat, frameCount, planes };
}

/**
 * Writes planar float channels as signed integer PCM.
 *
 * 16 bits by default. These clips are level-matched with their peaks around
 * -8 dBFS, so the quantisation floor sits near -90 dBFS: far below the noise
 * already on the recordings, and half the bytes of a 24-bit file that no
 * player could tell apart.
 */
function writeWav(filePath, sampleRate, planes, bitsPerSample = 16) {
  if (bitsPerSample !== 16 && bitsPerSample !== 24) {
    throw new Error(`unsupported output depth ${bitsPerSample}`);
  }
  const channels = planes.length;
  const frameCount = planes[0].length;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const dataLength = frameCount * blockAlign;

  const buf = Buffer.alloc(44 + dataLength);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bytesPerSample * 8, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLength, 40);

  // One less than the full positive range, so +1.0 cannot wrap round to the
  // most negative value. That wrap is the classic way a normaliser produces a
  // loud click in an otherwise clean file.
  const fullScale = Math.pow(2, bitsPerSample - 1) - 1;

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      const clamped = Math.max(-1, Math.min(1, planes[ch][frame]));
      const value = Math.round(clamped * fullScale);
      const at = 44 + frame * blockAlign + ch * bytesPerSample;
      for (let byte = 0; byte < bytesPerSample; byte += 1) {
        buf[at + byte] = (value >> (8 * byte)) & 0xff;
      }
    }
  }

  fs.writeFileSync(filePath, buf);
}

// ---------------------------------------------------------------------------
// BS.1770 loudness
// ---------------------------------------------------------------------------

/**
 * The two K-weighting stages, designed at the file's own sample rate.
 *
 * The published coefficient tables are for 48 kHz only. Designing from the
 * standard's stated centre frequencies and Q values instead means a 44.1 kHz
 * recording measures correctly rather than measuring as though it were 48.
 */
function kWeightingStages(sampleRate) {
  // Stage 1: high shelf, +3.9998 dB at 1681.97 Hz.
  const shelfF0 = 1681.974450955533;
  const shelfQ = 0.7071752369554196;
  const shelfGainDb = 3.999843853973347;
  const shelfK = Math.tan((Math.PI * shelfF0) / sampleRate);
  const vh = Math.pow(10, shelfGainDb / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const shelfDen = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf = {
    b0: (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfDen,
    b1: (2 * (shelfK * shelfK - vh)) / shelfDen,
    b2: (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / shelfDen,
    a1: (2 * (shelfK * shelfK - 1)) / shelfDen,
    a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfDen,
  };

  // Stage 2: high pass at 38.14 Hz, removing rumble the ear discounts.
  const hpF0 = 38.13547087602444;
  const hpQ = 0.5003270373238773;
  const hpK = Math.tan((Math.PI * hpF0) / sampleRate);
  const hpDen = 1 + hpK / hpQ + hpK * hpK;
  const highpass = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (hpK * hpK - 1)) / hpDen,
    a2: (1 - hpK / hpQ + hpK * hpK) / hpDen,
  };

  return [shelf, highpass];
}

/** Runs one direct-form-I biquad over a signal, returning a new array. */
function biquad(input, c) {
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i += 1) {
    const x0 = input[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/**
 * Gated integrated loudness in LUFS, or null for a clip with no audible
 * content at all.
 *
 * The gating is what makes this a measure of the talking rather than of the
 * file: 400 ms blocks are scored, anything below -70 LUFS absolute is
 * discarded as silence, then anything more than 10 LU below the average of
 * what survived is discarded as well. Leading and trailing near-silence
 * therefore cannot drag a clip's measured loudness down and trick the
 * normaliser into over-boosting it.
 */
function integratedLoudness(planes, sampleRate) {
  const stages = kWeightingStages(sampleRate);
  const weighted = planes.map((plane) => stages.reduce((signal, c) => biquad(signal, c), plane));

  const blockFrames = Math.round(0.4 * sampleRate);
  const hopFrames = Math.round(0.1 * sampleRate);
  const frameCount = weighted[0].length;
  if (frameCount < blockFrames) return null;

  // Mono and stereo both weight every channel at 1.0 under BS.1770; only the
  // surround channels carry a raised weight, and these recordings have none.
  const blocks = [];
  for (let start = 0; start + blockFrames <= frameCount; start += hopFrames) {
    let sum = 0;
    for (const plane of weighted) {
      for (let i = start; i < start + blockFrames; i += 1) sum += plane[i] * plane[i];
    }
    const meanSquare = sum / blockFrames;
    blocks.push({ meanSquare, loudness: -0.691 + 10 * Math.log10(meanSquare || Number.MIN_VALUE) });
  }

  const aboveAbsolute = blocks.filter((b) => b.loudness > -70);
  if (aboveAbsolute.length === 0) return null;

  const absoluteMean = aboveAbsolute.reduce((acc, b) => acc + b.meanSquare, 0) / aboveAbsolute.length;
  const relativeGate = -0.691 + 10 * Math.log10(absoluteMean) - 10;

  const kept = aboveAbsolute.filter((b) => b.loudness > relativeGate);
  if (kept.length === 0) return null;

  const keptMean = kept.reduce((acc, b) => acc + b.meanSquare, 0) / kept.length;
  return -0.691 + 10 * Math.log10(keptMean);
}

/**
 * Largest difference between any two channels, as a linear amplitude.
 *
 * A voice recorded on one microphone and saved as stereo carries the same
 * signal twice. Detecting that is worth the pass: the game's audio graph has
 * no panner and the world is drawn flat, so a second identical channel is
 * pure file size, and folding it away is lossless rather than a judgement
 * call. A genuinely stereo recording scores far above the threshold and is
 * left alone.
 */
function channelDivergence(planes) {
  if (planes.length < 2) return 0;
  let worst = 0;
  for (let i = 0; i < planes[0].length; i += 1) {
    for (let ch = 1; ch < planes.length; ch += 1) {
      const difference = Math.abs(planes[ch][i] - planes[0][i]);
      if (difference > worst) worst = difference;
    }
  }
  return worst;
}

/** Averages every channel into one. */
function foldToMono(planes) {
  const frameCount = planes[0].length;
  const mono = new Float64Array(frameCount);
  for (let i = 0; i < frameCount; i += 1) {
    let sum = 0;
    for (const plane of planes) sum += plane[i];
    mono[i] = sum / planes.length;
  }
  return [mono];
}

/** Largest absolute sample across every channel. */
function peakAmplitude(planes) {
  let peak = 0;
  for (const plane of planes) {
    for (let i = 0; i < plane.length; i += 1) {
      const magnitude = Math.abs(plane[i]);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

// ---------------------------------------------------------------------------
// Silence trimming and tick alignment
// ---------------------------------------------------------------------------

/**
 * First and last frame carrying audible signal, as a half-open range.
 *
 * The threshold is deliberately low. The goal is to remove the dead air
 * around a take, not to gate the quiet tail of a breath, because a clip that
 * is cut into at the top of its decay reads as a hard edit.
 */
function voicedRange(planes, sampleRate) {
  const threshold = Math.pow(10, -60 / 20);
  const window = Math.max(1, Math.round(0.005 * sampleRate));
  const frameCount = planes[0].length;

  let first = -1;
  let last = -1;
  for (let start = 0; start < frameCount; start += window) {
    const end = Math.min(start + window, frameCount);
    let peak = 0;
    for (const plane of planes) {
      for (let i = start; i < end; i += 1) {
        const magnitude = Math.abs(plane[i]);
        if (magnitude > peak) peak = magnitude;
      }
    }
    if (peak >= threshold) {
      if (first < 0) first = start;
      last = end;
    }
  }

  if (first < 0) return { start: 0, end: frameCount };
  return { start: first, end: last };
}

/**
 * Cuts to the voiced range, pads to a whole number of ticks, and fades the
 * edges.
 *
 * The pad goes on the END only. A clip has to start on its first audible
 * sample, because the shortest half a player ever hears is a fraction of a
 * second and silence at the front eats a visible share of it. Trailing
 * silence costs nothing by comparison: it lands where one speaker has
 * finished and the other has not started.
 */
function trimAndAlign(planes, sampleRate) {
  const framesPerTick = sampleRate / TICK_HZ;
  if (!Number.isInteger(framesPerTick)) {
    throw new Error(`sample rate ${sampleRate} is not a whole number of frames per tick`);
  }

  const { start, end } = voicedRange(planes, sampleRate);
  const voicedFrames = end - start;
  const ticks = Math.max(1, Math.ceil(voicedFrames / framesPerTick));
  const alignedFrames = ticks * framesPerTick;

  const fade = Math.min(Math.round(0.005 * sampleRate), Math.floor(voicedFrames / 2));

  const out = planes.map((plane) => {
    const dest = new Float64Array(alignedFrames);
    for (let i = 0; i < voicedFrames; i += 1) dest[i] = plane[start + i];
    // Short ramps at both ends of the real signal. Cutting at an arbitrary
    // sample leaves a step, and a step is a click.
    for (let i = 0; i < fade; i += 1) {
      dest[i] *= i / fade;
      dest[voicedFrames - 1 - i] *= i / fade;
    }
    return dest;
  });

  return { planes: out, ticks };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function decibels(amplitude) {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

function clipFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.wav'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function measure(dir) {
  const rows = [];
  for (const name of clipFiles(dir)) {
    const wav = readWav(path.join(dir, name));
    const seconds = wav.frameCount / wav.sampleRate;
    const { ticks } = trimAndAlign(wav.planes, wav.sampleRate);
    rows.push({
      name,
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      bits: wav.bitsPerSample,
      seconds,
      ticks,
      trimmedSeconds: ticks / TICK_HZ,
      peakDb: decibels(peakAmplitude(wav.planes)),
      lufs: integratedLoudness(wav.planes, wav.sampleRate),
    });
  }
  return rows;
}

function reportMeasurements(rows) {
  const header = [
    'clip'.padEnd(22),
    'rate'.padStart(6),
    'ch'.padStart(3),
    'bit'.padStart(4),
    'raw s'.padStart(7),
    'trim s'.padStart(7),
    'ticks'.padStart(6),
    'peak dB'.padStart(8),
    'LUFS'.padStart(8),
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of rows) {
    console.log(
      [
        row.name.padEnd(22),
        String(row.sampleRate).padStart(6),
        String(row.channels).padStart(3),
        String(row.bits).padStart(4),
        row.seconds.toFixed(3).padStart(7),
        row.trimmedSeconds.toFixed(1).padStart(7),
        String(row.ticks).padStart(6),
        row.peakDb.toFixed(1).padStart(8),
        (row.lufs === null ? 'silent' : row.lufs.toFixed(1)).padStart(8),
      ].join(' '),
    );
  }

  const measured = rows.filter((r) => r.lufs !== null).map((r) => r.lufs);
  if (measured.length > 1) {
    const spread = Math.max(...measured) - Math.min(...measured);
    console.log(`\nLoudness spread across the set: ${spread.toFixed(1)} LU`);
  }

  const byTicks = [...rows].sort((a, b) => a.ticks - b.ticks);
  const shortestPair = byTicks.slice(0, 2);
  const sumTicks = shortestPair.reduce((acc, r) => acc + r.ticks, 0);
  console.log(
    `Two shortest clips: ${shortestPair.map((r) => `${r.name} (${r.ticks}t)`).join(' + ')}` +
      ` = ${sumTicks} ticks (${(sumTicks / TICK_HZ).toFixed(1)} s)`,
  );

  const longestPair = byTicks.slice(-2);
  const longestSum = longestPair.reduce((acc, r) => acc + r.ticks, 0);
  console.log(
    `Two longest clips:  ${longestPair.map((r) => `${r.name} (${r.ticks}t)`).join(' + ')}` +
      ` = ${longestSum} ticks (${(longestSum / TICK_HZ).toFixed(1)} s)`,
  );
}

function normalize(dir, outDir, targetLufs) {
  fs.mkdirSync(outDir, { recursive: true });

  /** Below this the channels are the same signal and folding loses nothing. */
  const MONO_FOLD_THRESHOLD = Math.pow(10, -60 / 20);

  const prepared = [];
  let folded = 0;
  for (const name of clipFiles(dir)) {
    const wav = readWav(path.join(dir, name));
    let source = wav.planes;
    if (source.length > 1 && channelDivergence(source) < MONO_FOLD_THRESHOLD) {
      source = foldToMono(source);
      folded += 1;
    }
    const { planes, ticks } = trimAndAlign(source, wav.sampleRate);
    const lufs = integratedLoudness(planes, wav.sampleRate);
    if (lufs === null) throw new Error(`${name}: no audible content to measure`);
    prepared.push({ name, sampleRate: wav.sampleRate, planes, ticks, lufs });
  }

  // Resolve the target now that every clip has been measured. Matching the
  // quietest is what guarantees no clip is boosted.
  const resolvedTarget =
    targetLufs === MATCH_QUIETEST ? Math.min(...prepared.map((c) => c.lufs)) : targetLufs;

  // One shared ceiling check. Applying each clip's own gain and then clamping
  // per clip would quietly undo the level matching for whichever clip has the
  // sharpest transient, so a clip that would exceed the ceiling pulls the
  // whole set down with it instead.
  let headroomTrim = 0;
  for (const clip of prepared) {
    const gain = Math.pow(10, (resolvedTarget - clip.lufs) / 20);
    const projectedPeak = peakAmplitude(clip.planes) * gain;
    if (projectedPeak > PEAK_CEILING) {
      headroomTrim = Math.max(headroomTrim, decibels(projectedPeak / PEAK_CEILING));
    }
  }

  const results = [];
  for (const clip of prepared) {
    const gainDb = resolvedTarget - clip.lufs - headroomTrim;
    const gain = Math.pow(10, gainDb / 20);
    const scaled = clip.planes.map((plane) => {
      const dest = new Float64Array(plane.length);
      for (let i = 0; i < plane.length; i += 1) dest[i] = plane[i] * gain;
      return dest;
    });
    const outPath = path.join(outDir, clip.name);
    writeWav(outPath, clip.sampleRate, scaled);

    // Read the file back and measure what actually landed on disk.
    //
    // Not belt-and-braces. An encoding mistake in the writer produces a file
    // whose header is perfectly well formed and whose samples are noise, and
    // nothing else in this tool would notice: the numbers printed below are
    // all computed from the in-memory signal, which stays correct. Measuring
    // the written file is the only step that can tell the two apart.
    const written = readWav(outPath);
    const writtenLufs = integratedLoudness(written.planes, written.sampleRate);
    const expectedLufs = clip.lufs + gainDb;
    if (written.frameCount !== scaled[0].length) {
      throw new Error(
        `${clip.name}: wrote ${scaled[0].length} frames but read back ${written.frameCount}`,
      );
    }
    if (writtenLufs === null || Math.abs(writtenLufs - expectedLufs) > 0.5) {
      throw new Error(
        `${clip.name}: expected ${expectedLufs.toFixed(1)} LUFS on disk, measured ` +
          `${writtenLufs === null ? 'silence' : writtenLufs.toFixed(1)}`,
      );
    }

    results.push({
      name: clip.name,
      ticks: clip.ticks,
      gainDb,
      finalLufs: writtenLufs,
      finalPeakDb: decibels(peakAmplitude(written.planes)),
    });
  }

  const boosted = results.filter((r) => r.gainDb > 0.05).length;
  console.log(
    `Target ${resolvedTarget.toFixed(1)} LUFS` +
      `${targetLufs === MATCH_QUIETEST ? ' (matched to the quietest clip)' : ''},` +
      ` headroom trim ${headroomTrim.toFixed(2)} dB,` +
      ` ${folded} of ${prepared.length} folded to mono,` +
      ` ${boosted} boosted\n`,
  );
  console.log(['clip'.padEnd(22), 'ticks'.padStart(6), 'gain dB'.padStart(8), 'LUFS'.padStart(8), 'peak dB'.padStart(8)].join(' '));
  for (const row of results) {
    console.log(
      [
        row.name.padEnd(22),
        String(row.ticks).padStart(6),
        row.gainDb.toFixed(2).padStart(8),
        row.finalLufs.toFixed(1).padStart(8),
        row.finalPeakDb.toFixed(1).padStart(8),
      ].join(' '),
    );
  }
  console.log(`\nWrote ${results.length} clips to ${outDir}`);
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => {
    const at = args.indexOf(name);
    return at >= 0 && at + 1 < args.length ? args[at + 1] : null;
  };

  const measureDir = flag('--measure');
  const normalizeDir = flag('--normalize');

  if (measureDir) {
    reportMeasurements(measure(measureDir));
    return;
  }

  if (normalizeDir) {
    const outDir = flag('--out');
    if (!outDir) throw new Error('--normalize requires --out <dir>');
    const target = flag('--target');
    normalize(normalizeDir, outDir, target === null ? MATCH_QUIETEST : Number(target));
    return;
  }

  console.log('Usage:');
  console.log('  node scripts/voice-clip-intake.cjs --measure <dir>');
  console.log("  node scripts/voice-clip-intake.cjs --normalize <dir> --out <dir> [--target <LUFS>]");
  console.log("    --target defaults to the quietest clip in the set, so nothing is boosted.");
}

if (require.main === module) {
  try {
    main(process.argv);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  readWav,
  writeWav,
  integratedLoudness,
  trimAndAlign,
  voicedRange,
  peakAmplitude,
  channelDivergence,
  foldToMono,
  measure,
  TICK_HZ,
};
