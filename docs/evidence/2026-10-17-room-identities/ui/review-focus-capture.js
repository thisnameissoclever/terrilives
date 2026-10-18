async page => {
 await page.setViewportSize({width:390,height:480});
 await page.locator('#room-review-heading').focus();await page.keyboard.press('Tab');await page.evaluate(()=>document.querySelector('#room-review-scroll').scrollTop=0);
 const capture=async(selector,file)=>{
  const measure=()=>page.evaluate(async selector=>{const {bounds}=await import('/.scratch/r7-focus-helper.js');return bounds(selector,'#room-review-scroll')},selector);
  const before=await measure();if(!before.focused||!before.fits)throw Error(file+' paint not contained');
  await page.screenshot({path:'.local-build/'+file,scale:'css'});const after=await measure();
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error(file+' moved during capture');return {file,before,after};
 };
 const first=await capture('#room-review-group','r7-review-first-clearance-v3.png');
 for(let i=0;i<4;i++)await page.keyboard.press('Tab');
 const last=await capture('#room-review-body fieldset:last-of-type input','r7-review-last-clearance-v3.png');
 await page.evaluate(result=>window.__r7ReviewCaptures=result,{first,last});
}
