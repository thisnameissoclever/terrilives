const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/myema/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
const path=require('node:path');
async function run(){
  const directory=path.resolve(process.argv[2]||'docs/evidence/2026-10-12-full-character-creator/assets');
  fs.mkdirSync(directory,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[],results=[];
  try{
    const page=await browser.newPage({viewport:{width:1100,height:1000}});
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto('http://127.0.0.1:5187/proofs/creator-assets.html');
    try {
      await page.waitForFunction(()=>window.creatorStudy||window.creatorStudyError,null,{timeout:60000});
      const failure=await page.evaluate(()=>window.creatorStudyError);
      if(failure)throw new Error(failure);
    }
    catch(error) { throw new Error(`${error}\n${await page.locator('#status').textContent()}\n${errors.join('\n')}`); }
    const cases=[
      {name:'source',presentation:'masculine'},
      {name:'bob',presentation:'feminine'},
      {name:'wave-jacket',presentation:'feminine',hairstyle:'wave',top:'jacket',sleeves:'long',glasses:true,earrings:'hoops'},
      {name:'crop-shorts',presentation:'masculine',hairstyle:'crop',top:'tshirt',sleeves:'short',bottoms:'shorts',footwear:'trainers',freckles:true},
      {name:'quiff-beard',presentation:'masculine',hairstyle:'quiff',facial_hair:'beard',footwear:'laceups'},
      {name:'bare',presentation:'feminine',hairstyle:'bob',bare:true},
      {name:'large-read',presentation:'feminine',hairstyle:'bob',body:{height:100,build:100,shoulders:100,hips:100,torso:100},action:'read'},
      {name:'small-read',presentation:'masculine',hairstyle:'curl',body:{height:0,build:0,shoulders:0,hips:0,torso:0},action:'read'},
      {name:'shorts-read',presentation:'feminine',hairstyle:'wave',bottoms:'shorts',top:'tshirt',sleeves:'short',action:'read',phase:2.5},
      {name:'shorts-walk',presentation:'masculine',hairstyle:'crop',bottoms:'shorts',top:'tshirt',sleeves:'short',action:'walk',phase:3.5},
      {name:'jacket-walk',presentation:'feminine',hairstyle:'quiff',top:'jacket',sleeves:'long',action:'walk',phase:3.5},
      {name:'wide-short-walk',presentation:'feminine',body:{height:0,build:100,shoulders:100,hips:0,torso:100},action:'walk',phase:3.5},
      {name:'narrow-tall-walk',presentation:'masculine',body:{height:100,build:0,shoulders:0,hips:100,torso:0},action:'walk',phase:3.5},
      {name:'face-low',presentation:'feminine',faceExtreme:0},
      {name:'face-high',presentation:'masculine',faceExtreme:100},
    ];
    for(const entry of cases)for(let facing=0;facing<4;facing++){
      const result=await page.evaluate(async({entry,facing})=>{
        const {name,bare,action,phase,faceExtreme,...fields}=entry;
        const appearance={...window.creatorStudy.defaultAppearance(entry.presentation),...fields};
        if(faceExtreme!==undefined)for(const key of Object.keys(appearance.face))if(typeof appearance.face[key]==='number')appearance.face[key]=faceExtreme;
        return window.creatorStudy.draw(appearance,{wear:bare?'bare':'clothed',prop:action==='read'?'book':'none',fixture:action==='read'?'armchair':'none',eyes_closed:false},action||'idle',phase||0,facing*Math.PI/2);
      },{entry,facing});
      await page.locator('#preview').screenshot({path:path.join(directory,`${entry.name}-${facing}.png`)});
      results.push({name:entry.name,facing,...result});
    }
    errors.push(...await page.evaluate(()=>window.creatorStudy.errors));
    if(errors.length)throw new Error(errors.join('\n'));
  }finally{
    await browser.close();
    fs.writeFileSync(path.join(directory,'capture.json'),JSON.stringify({errors,results},null,2));
  }
  console.log(JSON.stringify({captures:results.length,errors}));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
