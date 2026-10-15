const fs=require('node:fs'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const originalRead=fs.readFileSync,originalHash=crypto.createHash,buffers=new WeakMap(),rows=[];
fs.readFileSync=function(file,...args){const label=String(file),match=/fixture-(stripes|checks)\.pattern\.png$/.test(label),begin=performance.now();const value=originalRead.call(this,file,...args);if(match){const row={file:label,bytes:value.length,readMs:performance.now()-begin};rows.push(row);if(Buffer.isBuffer(value))buffers.set(value,row);}return value;};
crypto.createHash=function(...args){const hash=originalHash.apply(this,args),update=hash.update.bind(hash),digest=hash.digest.bind(hash);let row;
 hash.update=function(value,...rest){row=buffers.get(value);const begin=performance.now();const result=update(value,...rest);if(row)row.hashUpdateMs=performance.now()-begin;return result;};
 hash.digest=function(...rest){const begin=performance.now();const result=digest(...rest);if(row)row.hashDigestMs=performance.now()-begin;return result;};return hash;};
require('node:module').syncBuiltinESMExports();
process.on('exit',()=>{if(rows.length)fs.writeFileSync(require('node:path').resolve(__dirname,`../../../../docs/evidence/2026-10-12-character-appearance/io-profile-${process.pid}.json`),JSON.stringify(rows,null,2));});
