
const crypto=require('node:crypto'),fs=require('node:fs');
function run(){
const h=require('./assets/models/sims/character-creator/runtime_inspect.cjs'),{shapePoint,anatomicalHeight}=h.api('shape'),{shapeHead}=h.api('head-shape'),{configuredPose}=h.api('pose'),{selectGeometry}=h.api('variants'),{hasBook}=h.api('motion'),{transform}=h.api('math');
const began=Date.now(),deadline=began+360000,stats={clips:0,poses:0,cagePoints:0,failures:[],headSamples:0},bounds={x:0,low:Infinity,high:-Infinity,depth:0},witness={};
const consider=(x,y,z,info)=>{const horizontal=Math.abs(x)+Math.abs(y),xp=horizontal*32,lo=-horizontal*21+z*Math.sqrt(1166),hi=horizontal*21+z*Math.sqrt(1166);if(xp>bounds.x){bounds.x=xp;witness.x=info}if(lo<bounds.low){bounds.low=lo;witness.low=info}if(hi>bounds.high){bounds.high=hi;witness.high=info}bounds.depth=Math.max(bounds.depth,horizontal);};
const headBoxes={};
for(const presentation of ['masculine','feminine']){
const face=h.schema.defaultAppearance(presentation).face,low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
for(let at=0;at<h.geometry.cage.length;at+=16){const data=h.geometry.cage,region=data[at+15];if(![1,8,9].includes(region))continue;let p=[data[at],data[at+1],data[at+2]];
if(presentation==='feminine'&&region===1)p[0]*=1-.06*Math.max(0,Math.min(1,(1.78-p[2])/.3));
const base=shapeHead(p,region,face),minimum=[...base],maximum=[...base];
for(const field of ['cheeks','jaw','chin','eye_size','brow_thickness','nose_width','mouth_fullness','ears']){const a=shapeHead(p,region,{...face,[field]:0}),b=shapeHead(p,region,{...face,[field]:100});for(let i=0;i<3;i++){minimum[i]+=Math.min(a[i],b[i])-base[i];maximum[i]+=Math.max(a[i],b[i])-base[i];}}
for(const [field,values]of Object.entries({shape:['oval','round','angular'],eyes:['almond','round','soft'],brows:['soft','straight','arched'],nose:['straight','button','broad'],mouth:['neutral','upturned','full']})){const samples=values.map(value=>shapeHead(p,region,{...face,[field]:value}));for(let i=0;i<3;i++){minimum[i]+=Math.min(...samples.map(p=>p[i]))-base[i];maximum[i]+=Math.max(...samples.map(p=>p[i]))-base[i];}}
for(let i=0;i<3;i++){low[i]=Math.min(low[i],minimum[i]);high[i]=Math.max(high[i],maximum[i]);}
}headBoxes[presentation]={low,high};}
const groups=new Map();for(const [name,clip]of Object.entries(h.library.clips)){if(!groups.has(clip.family))groups.set(clip.family,[]);groups.get(clip.family).push(name);}groups.set('BASE',Object.keys(h.geometry.manifest.actions));
for(const [family,actions]of groups){const geometry=family==='BASE'?h.geometry:h.family(family),top=anatomicalHeight(geometry.vertices),head=geometry.manifest.bones.findIndex(b=>b.name==='head');for(const action of actions){stats.clips++;const clip=h.library.clips[action],count=clip?clip.samples.length:geometry.manifest.actions[action].length;
for(const presentation of ['masculine','feminine'])for(let bits=0;bits<32;bits++){const a=h.schema.defaultAppearance(presentation);a.body={height:bits&1?100:0,build:bits&2?100:0,shoulders:bits&4?100:0,hips:bits&8?100:0,torso:bits&16?100:0};const shape={presentation,...a.body,face:a.face},shaped=new Map();
for(let frame=0;frame<count;frame++){if(Date.now()>deadline)throw Error('Envelope budget exceeded360seconds');const sample=clip?.samples[frame],g=selectGeometry(geometry,a,{wear:['bath','shower'].includes(action)?'bare':'clothed',prop:sample?.bookVisible||hasBook(action)?'book':'none',fixture:'none',eyes_closed:sample?.eyesClosed??action==='sleep',clip:action,grip:action==='mop'?'mop':'relaxed',stockMask:0xffffff,heldSlot:/^(fetch|shelve)_/.test(action)?Number(action.split('_')[1]):undefined});
let points=shaped.get(g);if(!points){points=new Float32Array(g.cage.length/16*3);for(let i=0,j=0;i<g.cage.length;i+=16,j+=3)points.set(shapePoint([g.cage[i],g.cage[i+1],g.cage[i+2]],g.cage[i+15],shape,top),j);shaped.set(g,points);}
let pose;try{pose=configuredPose(g.manifest,shape,action,frame,top,undefined,g)}catch(e){stats.failures.push({action,presentation,bits,frame,error:String(e)});continue;}stats.poses++;const offsets=action==='bed_sleep'?[[0,0,0],[-.77,0,0]]:action.startsWith('seat_sofa_')?[[0,-.58,0],[0,0,0],[0,.58,0]]:[[0,0,0]],info={action,presentation,bits,frame};let maxBodyZ=-Infinity;
for(let i=0,j=0;i<g.cage.length;i+=16,j+=3){const v=g.cage,region=v[i+15],bone=v[i+6];if(pose[bone*16+15]<0)continue;let x=0,y=0,z=0;
if(region===10){x=points[j];y=points[j+1];z=points[j+2];}else for(let k=0;k<4;k++){const w=v[i+10+k];if(!w)continue;const b=v[i+6+k]*16;x+=w*(pose[b]*points[j]+pose[b+4]*points[j+1]+pose[b+8]*points[j+2]+pose[b+12]);y+=w*(pose[b+1]*points[j]+pose[b+5]*points[j+1]+pose[b+9]*points[j+2]+pose[b+13]);z+=w*(pose[b+2]*points[j]+pose[b+6]*points[j+1]+pose[b+10]*points[j+2]+pose[b+14]);}
stats.cagePoints++;const fixture=region===10||region===12||region===13&&pose[bone*16+15]>1.5;if(!fixture)maxBodyZ=Math.max(maxBodyZ,z);if(fixture)consider(x,y,z,info);else for(const o of offsets)consider(x+o[0],y+o[1],z+o[2],info);
}
const box=headBoxes[presentation],shift=top*(.85+a.body.height*.003-1);for(const x of [box.low[0],box.high[0]])for(const y of [box.low[1],box.high[1]])for(const z of [box.low[2]+shift,box.high[2]+shift]){const p=transform(pose.subarray(head*16,head*16+16),[x,y,z]);for(const o of offsets){consider(p[0]+o[0],p[1]+o[1],p[2]+o[2],{...info,headEnvelope:true});stats.headSamples++;}maxBodyZ=Math.max(maxBodyZ,p[2]);}
if(action==='bed_sleep'||action==='bunk_sleep'){const half=action==='bed_sleep'?.765:.39;for(const x of [-half,half])for(const y of [-.94,.225])for(const z of [.4,maxBodyZ+.035])consider(x,y,z,{...info,coverEnvelope:true});}
}
}
}console.log(JSON.stringify({family,seconds:(Date.now()-began)/1000,poses:stats.poses,failures:stats.failures.length,bounds}));if(global.gc)global.gc();}
console.log('FINAL '+JSON.stringify({commandSHA256:crypto.createHash('sha256').update(run.toString()).digest('hex'),stats,bounds,witness,headBoxes,seconds:(Date.now()-began)/1000,note:'Body32corners and sourceframes; all hairstyle and face coordinatewise conservative head box evaluated through each sampled head transform; does not re-solve posture for every face combination.'}));
}
run();