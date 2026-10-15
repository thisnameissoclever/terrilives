# Retain condition state within an unsubmitted creator draft

The fresh source review found that deselecting and reselecting a saved condition replaced its severity with the content default and changed trait ordering. The existing edit contract requires an unsubmitted toggle to preserve the saved state.

## Change

`web/src/character/draft.ts` now retains the latest selected trait rows in private draft state. The same checkpoint stores selected values, retained rows, private random-generator state, and locks. Manual selection and per-trait random selection restore retained states and order. Successful severity edits update that memory. Broad trait randomization deliberately rerolls unlocked states and remembers its resulting selection order.

Explicit Reset discards retained rows for trait selections in its scope. Other sections preserve them. Undo and rejected transactions restore the retained rows along with the visible draft. Character commands contain only selected rows; a new edit after applied removal starts without the removed condition's severity. No session request generation, appearance preparation, browser readiness, field layout, or native storage behavior changed.

## Red and green evidence

1. RED: a bounded Node probe loaded the actual TypeScript modules in memory, then deselected and reselected two traits, including a condition with `floatBits(.73123455)`. `assert.deepStrictEqual(draft.resolve(), source)` failed. The condition state was `1056964608` instead of `1060844080`, and the trait order changed. Node exited 1.
2. GREEN: the same probe passed after the change, including equality with the original draft, an empty edit patch, and unchanged private random-generator state. Node exited 0 and printed `PASS: exact retained states and trait order after unsubmitted toggles`.
3. Focused Vitest: from `web`, `$env:NODE_OPTIONS='--max-old-space-size=4096'; npm test -- character-draft.test.ts character-fields.test.ts --maxWorkers=1`. Exit 0; 2 files and 24 tests passed. Final run began at 08:23:01 local time on 2026-10-15.

The eight new regression cases exercise saved float bits and order, the latest explicit severity edit, Undo and failed-transaction restoration, Reset and broad randomization, per-trait random toggles, post-removal reopening, scoped Reset retention, and rejection of a whole-character Reset after dormant state exists.

The bounded probe used this command from the repository root before and after the production change:

```powershell
@'
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('./web/node_modules/typescript');const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',out)((id)=>id.startsWith('.')?load(path.resolve(path.dirname(file),id.replace(/\.js$/,'.ts'))):require(id),m,m.exports);return m.exports;}
const {CharacterDraft}=load('web/src/character/draft.ts'),{neutralDraft,floatBits}=load('web/src/character/schema.ts');const catalog={version:1,name_limit:24,max_traits:4,max_household:6,traits:Array.from({length:6},(_,i)=>({id:`trait${i}`,label:`Trait ${i}`,description:'',kind:i===0?'condition':'disposition',initial_state:floatBits(i===0?.5:0),weights:[]})),affinities:[{id:'plants',label:'Plants',description:''}],skills:[],hobbies:[],activities:[],personalities:[]};const source=neutralDraft('Existing');source.affinities=[{id:'plants',value:floatBits(0)}];source.traits=[{id:'trait1',state:floatBits(0)},{id:'trait0',state:floatBits(.73123455)},{id:'trait2',state:floatBits(0)}];const draft=CharacterDraft.edit(source,23,catalog,[]),state=draft.randomState;for(const [id,value] of [['trait0',false],['trait1',false],['trait0',true],['trait1',true]])draft.set(JSON.stringify(['trait',id]),value);assert.deepStrictEqual(draft.resolve(),source);assert.deepStrictEqual(draft.patch(),{version:1});assert.equal(draft.randomState,state);console.log('PASS: exact retained states and trait order after unsubmitted toggles');
'@ | node
```

## Limits

No browser, full suite, type check, dependency changes, staging, or Git mutation was performed for this correction. Native storage behavior was not retested here. The parent review owns integration checks, the lessons-learned update, and the player-facing changelog decision.
