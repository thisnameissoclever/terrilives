const fs=require('node:fs');
const profile=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const nodes=new Map(profile.nodes.map(node=>[node.id,node])),parents=new Map(),self=new Map(),inclusive=new Map();
for(const node of profile.nodes)for(const child of node.children??[])parents.set(child,node.id);
for(let i=0;i<profile.samples.length;i++){
 const id=profile.samples[i],ms=profile.timeDeltas[i]/1000;self.set(id,(self.get(id)??0)+ms);
 for(let ancestor=id;ancestor!==undefined;ancestor=parents.get(ancestor))inclusive.set(ancestor,(inclusive.get(ancestor)??0)+ms);
}
const rows=[...nodes.values()].map(node=>({name:node.callFrame.functionName||'(anonymous)',url:node.callFrame.url,line:node.callFrame.lineNumber+1,selfMs:self.get(node.id)??0,inclusiveMs:inclusive.get(node.id)??0}));
console.log(JSON.stringify({self:rows.sort((a,b)=>b.selfMs-a.selfMs).slice(0,25),application:rows.filter(row=>row.url.includes('/src/')).sort((a,b)=>b.inclusiveMs-a.inclusiveMs).slice(0,35)},null,2));
