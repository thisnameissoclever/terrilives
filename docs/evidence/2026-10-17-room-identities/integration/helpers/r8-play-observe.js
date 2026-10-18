import {screenX,screenY} from '/src/render/iso.ts';
import {canvasToClient,clientToWorld} from '/src/input.ts';
export function tilePoint(x,y) {
  const canvas=document.querySelector('#stage'),rect=canvas.getBoundingClientRect();
  const camera={...window.__terriStress.origin,scale:1};
  const point=canvasToClient(screenX(x,y,camera.x,1),screenY(x,y,camera.y,1),rect,canvas.width,canvas.height);
  const inverse=clientToWorld(point.x,point.y,rect,canvas.width,canvas.height,camera.x,camera.y,1);
  if(!inverse||Math.abs(inverse[0]-x)>.001||Math.abs(inverse[1]-y)>.001)throw Error('Projection inverse mismatch');
  if(document.elementFromPoint(point.x,point.y)!==canvas)throw Error('Canvas does not own projected point');
  return {point,camera,inverse,tile:[x,y]};
}
export function observe(phase) {
  const sim=window.__terriStress.sim,rows=Array.from(sim.choreRows()),duties=[];
  for(let i=0;i<rows.length;i+=5)duties.push({kind:rows[i],target:rows[i+1],owner:rows[i+2],dirt:rows[i+3],outcome:rows[i+4],location:sim.choreLocation(rows[i],rows[i+1])});
  const ids=Array.from(sim.ids()),kinds=Array.from(sim.kinds()),positions=Array.from(sim.positions()),activities=Array.from(sim.activities()),progress=Array.from(sim.choreProgress());
  const actors=ids.flatMap((id,i)=>kinds[i]===0?[{id,name:sim.simName(id),position:positions.slice(i*2,i*2+2),activity:activities[i],status:sim.activityStatusOf(id),needs:Array.from(sim.needsOf(id)),progress:progress[i]}]:[]);
  const table=ids.indexOf(7);
  const row={phase,utc:new Date().toISOString(),tick:sim.clockTick(),buildActive:sim.buildActive(),buildDirty:sim.buildDirty(),rooms:sim.roomSummaries(),duties,actors,table:{id:7,position:positions.slice(table*2,table*2+2),dirt:sim.surfaceGrime()[table]},floor:Array.from(sim.floorGrime())};
  (window.__r8Evidence??=[]).push(row);return row;
}
