import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const base = 'https://thisnameissoclever.github.io/terrilives/';
const pages = JSON.parse(readFileSync('assets/sprites/atlas.toml','utf8').match(/^pages = (.*)$/m)[1]);
const html = await (await fetch(base, {cache:'no-store'})).text();
const entry = html.match(/src="([^"\s]+index-[^"\s]+\.js)"/)[1];
const code = await (await fetch(new URL(entry,base), {cache:'no-store'})).text();
assert(code.includes('offlineAquariumSwim7NE'), 'Public entrypoint lacks the complete swimming loop');
const results=[];
for (const name of pages) {
  const response=await fetch(new URL(name,base), {cache:'no-store'});
  assert.equal(response.status,200,name);
  const bytes=Buffer.from(await response.arrayBuffer());
  const hash=createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash,name.slice(6,-4),name);
  assert(bytes.equals(readFileSync('web/public/'+name)),name+' differs from reviewed local bytes');
  results.push({name,bytes:bytes.length,sha256:hash});
}
console.log(JSON.stringify({pass:true,entry,pages:results},null,2));
