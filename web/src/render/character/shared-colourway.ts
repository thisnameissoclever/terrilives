import source from '../sprites.wgsl?raw';

/** Compile the existing furniture recoloring function unchanged in the dynamic compositor. */
function recoloringFunction():string {
  const start=source.indexOf('fn recolour(');if(start<0)throw new Error('The shared furniture colourway function is missing.');
  const body=source.indexOf('{',start);let depth=0;
  for(let i=body;i<source.length;i++){
    if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error('The shared furniture colourway function is incomplete.');
}
export const colourwayShader=recoloringFunction();
