import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateArchitectureAtlas, type ArchitectureAtlas } from '../src/render/architecture-atlas.js';
import { ARCHITECTURE_DEPTH, ARCHITECTURE_FLOOR, FLOATS_PER_INSTANCE, writeArchitectureDepth, writeArchitectureFloor, writeInstance } from '../src/render/instances.js';
import { packSpriteTable, FLOATS_PER_SPRITE } from '../src/render/sprites.js';
import { SPRITES } from '../src/render/atlas.js';

const directory='../docs/assets/review-evidence/architecture/room-01/trial/candidate-08/';
const manifest=JSON.parse(readFileSync(directory+'manifest.json','utf8'));
const bytes=readFileSync(directory+'depth.r16f');
const fixture = (): ArchitectureAtlas => ({ width:manifest.width,height:manifest.height,
  color:{width:manifest.width,height:manifest.height} as ImageBitmap,
  depth:new Uint16Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),sprites:manifest.sprites });

describe('opt-in architecture depth',()=>{
  it('uses a distinct mode and resets it when an instance slot is reused',()=>{
    const rows=new Float32Array(FLOATS_PER_INSTANCE*2);
    writeInstance(rows,1,0,0,.5,0);
    writeArchitectureDepth(rows,1,.03,.25,true);
    expect([...rows.slice(FLOATS_PER_INSTANCE+8,FLOATS_PER_INSTANCE+12)]).toEqual([ARCHITECTURE_DEPTH,Math.fround(.03),.25,1]);
    expect([...rows.slice(0,FLOATS_PER_INSTANCE)]).toEqual(Array(FLOATS_PER_INSTANCE).fill(0));
    writeInstance(rows,1,0,0,.5,0);
    expect([...rows.slice(FLOATS_PER_INSTANCE+8,FLOATS_PER_INSTANCE+12)]).toEqual([0,0,0,0]);
  });
  it('validates matched registered color/depth inputs and finite signed half floats',()=>{
    const atlas=fixture(); expect(()=>validateArchitectureAtlas(atlas)).not.toThrow();
    expect(atlas.depth.some(bits=>(bits&0x8000)!==0)).toBe(true);
    expect(atlas.depth.some(bits=>(bits&0x8000)===0&&bits!==0)).toBe(true);
    expect(()=>validateArchitectureAtlas({...atlas,depth:new Uint16Array(2)})).toThrow(/agree/);
    expect(()=>validateArchitectureAtlas({...atlas,width:0})).toThrow(/agree/);
    expect(()=>validateArchitectureAtlas({...atlas,sprites:[]})).toThrow(/agree/);
    for(const bad of [0x7c00,0x7e00,0xfc00]) {
      const depth=atlas.depth.slice(); depth[0]=bad;
      expect(()=>validateArchitectureAtlas({...atlas,depth})).toThrow(/finite/);
    }
    for(const patch of [{x:-1},{w:0},{h:99999},{pixel_density:0},{x:.5}]) {
      expect(()=>validateArchitectureAtlas({...atlas,sprites:[{...atlas.sprites[0],...patch}]})).toThrow(/invalid/);
    }
    expect(()=>validateArchitectureAtlas({...atlas,sprites:[atlas.sprites[0],atlas.sprites[0]]})).toThrow(/invalid/);
  });
  it('keeps floor depth fixed and records canonical world coordinates independently of cropped art',()=>{
    const row=new Float32Array(FLOATS_PER_INSTANCE);
    writeInstance(row,0,252.5,114.5,.999,1700);
    writeArchitectureFloor(row,0,3,4);
    expect([...row.slice(8,12)]).toEqual([ARCHITECTURE_FLOOR,0,3,4]);
    expect(row[2]).toBe(Math.fround(.999));
    expect([...row.slice(0,2)]).toEqual([252.5,114.5]);
  });
  it('packs trial registrations after the unchanged historical table',()=>{
    const old=packSpriteTable();
    const trial=packSpriteTable(manifest.sprites,manifest.width,manifest.height,{},{});
    const combined=new Float32Array(old.length+trial.length); combined.set(old);combined.set(trial,old.length);
    expect([...combined.slice(0,SPRITES.length * FLOATS_PER_SPRITE)]).toEqual([...old]);
    expect(trial.length).toBe(29 * FLOATS_PER_SPRITE);
    expect([...trial.slice(4,6)]).toEqual([manifest.sprites[0].w/2,manifest.sprites[0].h/2]);
  });
  it('retains the exact completed Blender exports and measured projection',()=>{
    const proof=JSON.parse(readFileSync(directory+'render-proof.json','utf8'));
    expect(proof.state).toBe('complete');expect(proof.background).toBe(true);
    expect(proof.renders).toHaveLength(29);
    expect(proof.registration.source_basis[0][0]).toBeCloseTo(32,4);
    expect(proof.registration.source_basis[0][1]).toBeCloseTo(21,4);
    expect(-proof.registration.source_basis[2][1]*proof.registration.architecture_z_scale).toBeCloseTo(38,8);
    for(const [name,expected] of Object.entries(proof.inputs)) {
      const relative = name.replaceAll('\\','/');
      // The original room proof retains its .12 geometry while production uses .14.
      const source = relative === 'assets/models/architecture/geometry.py'
        ? '../docs/assets/review-evidence/architecture/depth-full-01/original-room-geometry.py'
        : '../'+relative;
      expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(expected);
    }
    for(const [name,expected] of [[manifest.color,manifest.color_sha256],[manifest.depth,manifest.depth_sha256]])
      expect(createHash('sha256').update(readFileSync(directory+name)).digest('hex')).toBe(expected);
    for(const record of proof.renders) expect(record.planar_corner_normals_checked).toBeGreaterThan(0);
    for(const record of proof.renders) for(const witness of record.witnesses)
      expect(witness.sum).toBeCloseTo(witness.game_point[0]+witness.game_point[1],5);
  });
});


describe('combined shader interstage contract', () => {
  const shader = readFileSync(new URL('../src/render/sprites.wgsl', import.meta.url), 'utf8');
  function fields(source: string): { name: string; location: number; components: number }[] {
    const body = source.match(/struct VertexOut\s*\{([\s\S]*?)\};/)?.[1];
    if (!body) throw new Error('Missing shared vertex/fragment output');
    return [...body.matchAll(/@location\((\d+)\)(?:\s+@interpolate\([^)]*\))?\s+(\w+):\s+(vec([234])(?:<[\w]+>|[fiu])|u32|f32)/g)]
      .map(match => ({ location: Number(match[1]), name: match[2], components: Number(match[4] ?? 1) }));
  }
  function check(source: string): void {
    const output = fields(source);
    expect(output).toHaveLength(16);
    expect(output.some(field=>field.location===14 && field.name==='grimeOpacity')).toBe(true);
    expect(output.some(field=>field.location===15 && field.name==='sceneExtra')).toBe(true);
    expect(new Set(output.map(field => field.location)).size).toBe(output.length);
    // The portable pipeline has sixteen interstage locations and sixty scalar components.
    expect(output.every(field => field.location >= 0 && field.location < 16)).toBe(true);
    expect(output.reduce((sum, field) => sum + field.components, 0)).toBeLessThanOrEqual(60);
  }
  it('assigns distinct locations to architecture, covered beds and dining support', () => {
    check(shader);
    const byName = Object.fromEntries(fields(shader).map(field => [field.name, field.location]));
    expect([byName.bed, byName.supportUv, byName.supportMask, byName.registration, byName.groundOrigin, byName.page])
      .toEqual([8, 9, 10, 11, 12, 13]);
    expect(shader).toMatch(/fn vs\([\s\S]*?\) -> VertexOut/);
    expect(shader).toContain('fn fs(in: VertexOut)');
  });
  it.each([['registration', 8], ['groundOrigin', 9]] as const)('rejects duplicated location for %s', (name, location) => {
    const collision = shader.replace(new RegExp(`@location\\(\\d+\\)(?= @interpolate\\(flat\\) ${name}:)`), `@location(${location})`);
    expect(collision).not.toBe(shader);
    expect(() => check(collision)).toThrow();
  });
});
