import { expect, it, vi } from 'vitest';
import { defaultAppearance } from '../src/character/schema.js';
import { CharacterContactRoster } from '../src/render/character/contact-admission.js';
import type { BuildToken, RoomResult } from '../src/rooms/codec.js';
import { PreparedBuildCommit } from '../src/ui/prepared-build-commit.js';
import { AdmissionTestService } from './fixtures/contact-admission-service.js';

const token = { session: 1n, revision: 2n, preparation: 3n } satisfies BuildToken;
const accepted = (): RoomResult<void> => ({ ok: true, value: undefined });

function pendingRig(){
  let resolve!:()=>void,reject!:(error:Error)=>void;
  const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

it('waits for exact pool contacts before confirming and checks the same token again', async () => {
  const service = new AdmissionTestService();
  const roster = new CharacterContactRoster(service);
  const appearance = defaultAppearance();
  const appearances = () => [{ entity: 1, appearance }];
  const poolRequired = vi.fn((): RoomResult<boolean> => ({ ok: true, value: true }));
  const pending = vi.fn();
  const adopt = vi.fn(accepted);
  const prepared = new PreparedBuildCommit(roster, { poolRequired, appearances, pending });
  try {
    const base = roster.prepareCurrent(appearances(), 'base');
    service.finish(appearance, 'base');
    await base;
    const result = prepared.run(token, adopt);
    expect(adopt).not.toHaveBeenCalled();
    expect(pending).toHaveBeenLastCalledWith(true);
    service.finish(appearance, 'pool-required');
    expect(await result).toEqual(accepted());
    expect(adopt).toHaveBeenCalledOnce();
    expect(poolRequired.mock.calls).toEqual([[token], [token]]);
    expect(roster.require(1, appearance).pool).toBeDefined();
    expect(pending).toHaveBeenLastCalledWith(false);
  } finally { roster.dispose(); }
});

it('cancels a cold first-pool confirmation without adopting or changing live contacts', async () => {
  const service = new AdmissionTestService();
  const roster = new CharacterContactRoster(service);
  const appearance = defaultAppearance();
  const appearances = () => [{ entity: 1, appearance }];
  const adopt = vi.fn(accepted);
  const pending = vi.fn();
  const prepared = new PreparedBuildCommit(roster, { poolRequired: () => ({ ok: true, value: true }), appearances, pending });
  try {
    const base = roster.prepareCurrent(appearances(), 'base');
    service.finish(appearance, 'base');
    await base;
    const result = prepared.run(token, adopt);
    expect(prepared.cancel()).toBe(true);
    expect(await result).toBeNull();
    expect(adopt).not.toHaveBeenCalled();
    expect(roster.require(1, appearance).pool).toBeUndefined();
    expect(pending).toHaveBeenLastCalledWith(false);
  } finally { roster.dispose(); }
});

it('rejects a token superseded during preparation and keeps the draft uncommitted', async () => {
  const service = new AdmissionTestService();
  const roster = new CharacterContactRoster(service);
  const appearance = defaultAppearance();
  const appearances = () => [{ entity: 1, appearance }];
  const adopt = vi.fn(accepted);
  const stale = { ok: false, error: { code: 11, detail: null } } as const;
  const poolRequired = vi.fn((): RoomResult<boolean> => ({ ok: true, value: true }));
  const prepared = new PreparedBuildCommit(roster, { poolRequired, appearances, pending() {} });
  try {
    const base = roster.prepareCurrent(appearances(), 'base');
    service.finish(appearance, 'base');
    await base;
    const result = prepared.run(token, adopt);
    poolRequired.mockReturnValue(stale);
    if ([...service.entries.values()].some(row => row.mode === 'pool-required')) service.finish(appearance, 'pool-required');
    expect(await result).toEqual(stale);
    expect(adopt).not.toHaveBeenCalled();
    expect(roster.require(1, appearance).pool).toBeUndefined();
  } finally { roster.dispose(); }
});

it('cancels a first Sunstrip confirmation even when the live household uses base contacts',async()=>{
  const service=new AdmissionTestService(),roster=new CharacterContactRoster(service),appearance=defaultAppearance();
  const appearances=()=>[{entity:1,appearance}],rig=pendingRig();
  const adopt=vi.fn(accepted),pending=vi.fn();
  const prepared=new PreparedBuildCommit(roster,{poolRequired:()=>({ok:true,value:false}),appearances,pending,
    prepareSceneAssets:()=>rig.promise});
  try{
    const base=roster.prepareCurrent(appearances(),'base');service.finish(appearance,'base');await base;
    const result=prepared.run(token,adopt);
    expect(pending).toHaveBeenLastCalledWith(true);
    expect(adopt).not.toHaveBeenCalled();
    expect(prepared.cancel()).toBe(true);
    expect(await result).toBeNull();
    rig.resolve();
    await Promise.resolve();
    expect(adopt).not.toHaveBeenCalled();
    expect(roster.mode).toBe('base');
    expect(pending).toHaveBeenLastCalledWith(false);
  }finally{rig.resolve();roster.dispose();}
});

it('leaves a Sunstrip draft uncommitted when the pose download fails',async()=>{
  const roster=new CharacterContactRoster(new AdmissionTestService());
  await roster.prepareCurrent([],'base');
  const rig=pendingRig(),adopt=vi.fn(accepted),pending=vi.fn();
  const prepared=new PreparedBuildCommit(roster,{poolRequired:()=>({ok:true,value:false}),appearances:()=>[],pending,
    prepareSceneAssets:()=>rig.promise});
  try{
    const result=prepared.run(token,adopt);
    const refusal=expect(result).rejects.toThrow('Sunstrip download failed');
    rig.reject(new Error('Sunstrip download failed'));
    await refusal;
    expect(adopt).not.toHaveBeenCalled();
    expect(pending).toHaveBeenLastCalledWith(false);
    expect(roster.mode).toBe('base');
  }finally{roster.dispose();}
});
