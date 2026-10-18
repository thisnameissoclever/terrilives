async page => {
 const measure=()=>page.evaluate(async()=>{const {bounds}=await import('/.scratch/r7-focus-helper.js');return bounds('#room-name','#room-tool')});
 const capture={file:'r7-selection-clearance-v3.png',before:await measure()};
 if(!capture.before.focused||!capture.before.fits)throw Error('Selection paint not contained');
 await page.screenshot({path:'.local-build/r7-selection-clearance-v3.png',scale:'css'});capture.after=await measure();
 if(JSON.stringify(capture.before)!==JSON.stringify(capture.after))throw Error('Selection moved during capture');
 const faults=[];
 for(const [name,content] of [['gutter3','#builder-dock #room-tool {padding:3px!important;margin:-3px!important}'],['margin0','#room-name {scroll-margin-block:0px!important}']]) {
  const style=await page.addStyleTag({content});
  try {
   if(name==='margin0'){await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.querySelector('#room-tool').scrollTop=0);await page.setViewportSize({width:390,height:480});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
   const result=await measure();faults.push({name,result});if(result.fits)throw Error(name+' fault survived');
  } finally {await style.evaluate(node=>node.remove());}
  await page.setViewportSize({width:390,height:844});await page.setViewportSize({width:390,height:480});
  await page.waitForFunction(async()=>{const {bounds}=await import('/.scratch/r7-focus-helper.js');return bounds('#room-name','#room-tool').fits});
 }
 capture.restored=await measure();capture.faults=faults;
 await page.evaluate(capture=>window.__r7SelectionCapture=capture,capture);
}
