import {expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {createPoolContactInput} from '../src/render/character/pool-contact-preparation.js';
import {loadBundledPoolArtifact,packCompletePoolArtifact,unpackCompletePoolArtifact} from '../src/render/character/pool-bundled-artifact.js';
import {schemaPoolArtifact} from './pool-contact-service-fixture.js';

it('round-trips a complete protocol artifact, including negative zero, through a digest-bound byte stream',async()=>{
 const input=await createPoolContactInput(defaultAppearance('masculine')),prior=schemaPoolArtifact(input);
 prior.graph.poses[0].preferenceBasis[0][12]=-0;
 const bytes=packCompletePoolArtifact(input,prior);
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 const item={key:input.key,url:'./measured.pool',byteLength:bytes.byteLength,sha256};
 const fetch=vi.fn(async()=>new Response(bytes));
 const loaded=await loadBundledPoolArtifact(input,[item],fetch);
 expect(fetch).toHaveBeenCalledTimes(1);expect(loaded).toEqual(prior);expect(Object.is(loaded?.graph.poses[0].preferenceBasis[0][12],-0)).toBe(true);
 await expect(loadBundledPoolArtifact(input,[{...item,sha256:'0'.repeat(64)}],fetch)).rejects.toThrow('release digest');
 await expect(loadBundledPoolArtifact(input,[{...item,byteLength:item.byteLength-1}],fetch)).rejects.toThrow('byte length');
 const bad=structuredClone(input);bad.appearanceKey+=' changed';
 expect(()=>unpackCompletePoolArtifact(bad,bytes)).toThrow('requested physical inputs');
});

it('leaves a key miss or absent optional asset to cold compilation and rejects ambiguous release keys',async()=>{
 const input=await createPoolContactInput(defaultAppearance('feminine')),fetch=vi.fn(async()=>new Response(null,{status:404}));
 const item={key:input.key,url:'./measured.pool',byteLength:1,sha256:'a'.repeat(64)};
 expect(await loadBundledPoolArtifact(input,[{...item,key:'another input'}],fetch)).toBeUndefined();expect(fetch).not.toHaveBeenCalled();
 expect(await loadBundledPoolArtifact(input,[item],fetch)).toBeUndefined();expect(fetch).toHaveBeenCalledTimes(1);
 await expect(loadBundledPoolArtifact(input,[item,item],fetch)).rejects.toThrow('release index');
});

it('rejects an incomplete contact graph before it can enter a release packet',async()=>{
 const input=await createPoolContactInput(defaultAppearance('masculine')),broken=schemaPoolArtifact(input);
 broken.graph.bridges.pop();
 expect(()=>packCompletePoolArtifact(input,broken)).toThrow('canonical pool graph');
});
