import {screenX,screenY} from '/src/render/iso.ts';
import {canvasToClient,clientToWorld} from '/src/input.ts';
import {nearestLine,tilesBeside} from '/src/ui/wall-tool.ts';
export function wallPoint(edge, roomId=1) {
 const canvas=document.querySelector('#stage'), rect=canvas.getBoundingClientRect(), sim=window.__terriStress.sim;
 const snapshot=sim.roomSummaries();if(!snapshot.ok)throw Error('Native rooms unavailable');
 const ids=Array.isArray(roomId)?roomId:[roomId]; const memberships=ids.map(id=>sim.roomTiles(id)); const membership={ok:memberships.every(row=>row.ok),value:memberships.flatMap(row=>row.ok?row.value:[])};if(!membership.ok)throw Error('Native membership unavailable');
 const adjacent=tilesBeside(edge);if(!adjacent.every(p=>membership.value.some(q=>p[0]===q[0]&&p[1]===q[1])))throw Error('Edge does not separate two native selected-room cells');
 if(document.querySelector('#build-tool-walls').getAttribute('aria-pressed')!=='true'||document.querySelector('#wall-tool').hidden||document.querySelector('dialog[open]')||!document.querySelector('#room-review').hidden)throw Error('Walls do not own input');
 const camera={...window.__terriStress.origin,scale:1};
 const wx=edge.x-(edge.axis===0?.5:0),wy=edge.y-(edge.axis===1?.5:0);
 const point=canvasToClient(screenX(wx,wy,camera.x,camera.scale),screenY(wx,wy,camera.y,camera.scale),rect,canvas.width,canvas.height);
 const inverse=p=>{const w=clientToWorld(p.x,p.y,rect,canvas.width,canvas.height,camera.x,camera.y,camera.scale);return w&&nearestLine(...w,snapshot.value.width,snapshot.value.height)};
 const line=inverse(point);if(JSON.stringify(line)!==JSON.stringify(edge))throw Error('Production inverse selects another edge');
 const oldPoint=canvasToClient(screenX(wx,wy,camera.x,1),(wx+wy)*16+camera.y,rect,canvas.width,canvas.height),oldLine=inverse(oldPoint);
 if(JSON.stringify(oldLine)===JSON.stringify(edge))throw Error('Old half-height negative control did not reject');
 if(document.elementFromPoint(point.x,point.y)!==canvas)throw Error('Canvas does not own target');
 return {edge,adjacent,point,line,oldPoint,oldLine,camera,scaleProvenance:'Fresh loaded camera scale1; no game zoom input',rect:rect.toJSON(),buffer:[canvas.width,canvas.height],room: snapshot.value.rooms.filter(r=>ids.includes(r.id))};
}
