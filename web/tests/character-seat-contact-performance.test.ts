import {mkdirSync,writeFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {configuredPose} from '../src/render/character/pose.js';
import {compileSeatContact} from '../src/render/character/seat-contact-compile.js';
import {createSeatContactInput} from '../src/render/character/seat-contact-preparation.js';
import {bindSeatContacts} from '../src/render/character/seat-contact-sample.js';
import {SEAT_ACTIONS} from '../src/render/character/seat-contact-types.js';
import * as fitter from '../src/render/character/seat-fit.js';
import {seatRigs,preparedSeatGeometry} from './seat-contact-fixture.js';

it('records independent main-thread cold binding and first-frame cost without any geometry fit',async()=>{
  const appearance=defaultAppearance(),input=await createSeatContactInput(appearance),start=performance.now(),artifact=compileSeatContact(input,{rigs:seatRigs,revisions:input.revisions}),compileMs=performance.now()-start;
  const manifests=new Map<string,typeof seatRigs.seated_eat.manifest>(),rows:{action:string;bindMs:number;firstFrameMs:number}[]=[];
  const forbid=vi.spyOn(fitter,'fitSeatedPose').mockImplementation(()=>{throw new Error('Main-thread seated fit.');});
  try{for(const action of SEAT_ACTIONS){const source=preparedSeatGeometry(appearance,action),family=seatRigs[action].family;let manifest=manifests.get(family);if(!manifest){manifest=structuredClone(source.manifest);manifests.set(family,manifest);}
      const geometry={...source,manifest},shape={presentation:appearance.presentation,...appearance.body,face:appearance.face},top=anatomicalHeight(geometry.vertices),before=performance.now();bindSeatContacts(artifact,geometry,shape,top);const bound=performance.now();
      configuredPose(manifest,shape,action,.375,top,undefined,geometry,undefined,undefined,artifact);rows.push({action,bindMs:bound-before,firstFrameMs:performance.now()-bound});
    }expect(forbid).not.toHaveBeenCalled();
  }finally{forbid.mockRestore();}
  const result={compileMs,rows,maxBindMs:Math.max(...rows.map(row=>row.bindMs)),maxFirstFrameMs:Math.max(...rows.map(row=>row.firstFrameMs))};
  const directory=new URL('../../.scratch/position-repair-20261015/',import.meta.url);mkdirSync(directory,{recursive:true});writeFileSync(new URL('seat-preparation-performance.json',directory),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
},30000);
