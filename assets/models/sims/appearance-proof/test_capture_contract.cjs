const assert=require('node:assert/strict');
const test=require('node:test');
const {assertCaptureSweep}=require('./capture-contract.cjs');

test('rejects a failed facing even when every capture has a result',()=>{
 const cases=Array.from({length:216},(_,i)=>({label:String(i)}));
 assert.doesNotThrow(()=>assertCaptureSweep(cases));
 cases[215].error='Image is clipped';
 assert.throws(()=>assertCaptureSweep(cases),/Appearance or facing capture failed/);
});
test('rejects incomplete coverage independently of captured errors',()=>{
 assert.throws(()=>assertCaptureSweep(Array.from({length:215},()=>({}))),/Every appearance, action and facing/);
});
