// Run this callback against the local game in a displayed Playwright browser.
async (page) => {
  await page.route('**/src/render/weather-scene.ts?proof=mutant-final', async route => {
    const response = await route.fetch();
    const original = await response.text();
    const changed = original.replace('outside[u32(tile.y)*view.width+u32(tile.x)]==0u','outside[u32(tile.y)*view.width+u32(tile.x)]==999u');
    if(changed===original) throw new Error('Weather clipping mutation did not change source.');
    await route.fulfill({response,body:changed});
  });
  return page.evaluate(async()=>{
    const {SceneTarget}=await import('/src/render/scene-target.ts');
    const device=globalThis.__terriStress.graphicsDevice;
    async function run(url, positive) {
      const {WeatherScene}=await import(url);
      const target=new SceneTarget(device,512,512,'bgra8unorm');
      const scene=new WeatherScene(device);
      const buffer=device.createBuffer({size:1024*1024*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      device.pushErrorScope('validation');
      try{
        scene.setOutside([[4,2]],6,4);
        const tuning={seed:77,chance:[0,1,1,1],eventHours:2,earliestHour:0,latestHour:0,leafHours:2,fallMinutes:15};
        let chosen;
        for(let tick=0;tick<15;tick++){
          scene.prepare(tick,1440,3,tuning,200,40,1,6,[1,1,1,0],false);
          const row=scene.packed,dx=row[0]-200,dy=row[1]-40;
          const x=Math.floor((dx/32+dy/21)/2+.5),y=Math.floor((dy/21-dx/32)/2+.5);
          if(x>=0&&x<6&&y>=0&&y<4&&(x!==4||y!==2)&&scene.world[2]>.8){chosen={tick,x,y,world:Array.from(scene.world.slice(0,3)),pixel:Array.from(row.slice(0,2))};break;}
        }
        if(!chosen)throw new Error('No elevated overlap fixture.');
        if(positive){
          scene.setOutside([[4,2],[chosen.x,chosen.y]],6,4);
          scene.count=1;
        }
        const encoder=device.createCommandEncoder();target.begin(encoder).end();scene.draw(encoder,target);
        encoder.copyTextureToBuffer({texture:target.color},{buffer,bytesPerRow:8192},[1024,1024]);
        device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
        const bytes=new Uint16Array(buffer.getMappedRange());
        const baseline=[...bytes.slice(0,4)];let changed=0;
        for(let i=0;i<bytes.length;i+=4)if(bytes[i]!==baseline[0]||bytes[i+1]!==baseline[1]||bytes[i+2]!==baseline[2])changed++;
        const error=await device.popErrorScope();if(error)throw new Error(error.message);
        return {changedPixels:changed,chosen};
      }finally{buffer.unmap();buffer.destroy();scene.destroy();target.destroy();}
    }
    const correct=await run('/src/render/weather-scene.ts?proof=correct-final',false);
    const mutant=await run('/src/render/weather-scene.ts?proof=mutant-final',false);
    const positive=await run('/src/render/weather-scene.ts?proof=positive-final',true);
    if(correct.changedPixels!==0||mutant.changedPixels===0||positive.changedPixels===0)throw new Error(JSON.stringify({correct,mutant,positive}));
    return {correct,mutant,positive};
  });
}
