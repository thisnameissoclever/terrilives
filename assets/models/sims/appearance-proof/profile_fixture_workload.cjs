const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const rows=[];
for(const name of ['fixture-stripes','fixture-checks']){
 let t=performance.now();const source=fs.readFileSync(`assets/models/architecture/export/depth-reviewed-01/${name}.pattern.png`);const sourceReadMs=performance.now()-t;
 t=performance.now();const served=fs.readFileSync(`web/proofs/fixtures/architecture/${name}.pattern.png`);const servedReadMs=performance.now()-t;
 t=performance.now();const sourceHash=crypto.createHash('sha256').update(source).digest('hex'),servedHash=crypto.createHash('sha256').update(served).digest('hex');const hashMs=performance.now()-t;
 t=performance.now();assert.equal(sourceHash,servedHash);assert.ok(served.length>500);const assertionMs=performance.now()-t;
 rows.push({name,bytes:served.length,sourceReadMs,servedReadMs,hashMs,assertionMs,sha256:servedHash});
}
fs.writeFileSync('docs/evidence/2026-10-12-character-appearance/fixture-io-profile.json',JSON.stringify({scope:'Direct equivalent byte comparison; separate from the Vitest verdict and not a reconstruction of earlier host conditions',rows},null,2));console.log(JSON.stringify(rows));
