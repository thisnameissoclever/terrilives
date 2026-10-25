import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {createPoolContactInput,poolContactSourceRevisions} from '../src/render/character/pool-contact-preparation.js';
import {verifyPoolContactInput} from '../src/render/character/pool-contact-protocol.js';
import {POOL_INTERPOLATION_REVISION,POOL_OBSERVER_REVISION} from '../src/render/character/pool-contact-types.js';

it('binds actual body, garment, clip and fixture manifests to the normalized request',async()=>{
  const appearance=defaultAppearance('feminine'),input=await createPoolContactInput(appearance);
  await expect(verifyPoolContactInput(input)).resolves.toBeUndefined();
  const revisions=await poolContactSourceRevisions();
  for(const field of ['body','garments','clips','fixture'] as const)expect(revisions[field]).toMatch(/^[a-f0-9]{64}$/);
  expect(revisions).toMatchObject({observer:POOL_OBSERVER_REVISION,interpolation:POOL_INTERPOLATION_REVISION});
  const palette=structuredClone(appearance);palette.colors.shirt=[1,2,3];palette.colors.trousers=[3,2,1];
  expect((await createPoolContactInput(palette)).key).toBe(input.key);
  const body=structuredClone(appearance);body.body.hips++;
  expect((await createPoolContactInput(body)).key).not.toBe(input.key);
  const stale=structuredClone(input);stale.revisions.fixture='0'.repeat(64);
  await expect(verifyPoolContactInput(stale)).rejects.toThrow('does not match');
});
