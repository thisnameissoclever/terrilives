import {expect,it} from 'vitest';
import {defaultAppearance} from '../src/character/schema.js';
import {PreparedBody} from '../src/render/character/prepared-body.js';
import {anatomicalHeight} from '../src/render/character/shape.js';
import {preparePoolEntryAnatomy} from '../src/render/character/pool-entry-anatomy.js';
import {poolBase,poolRig} from './pool-observer-fixture.js';

it('prepares selected finite sole and palm patches against configured rest geometry',()=>{
  const appearance=defaultAppearance('feminine'),body=new PreparedBody(poolBase,appearance);
  const selected=body.select(poolRig,appearance,{wear:'bare',prop:'none',fixture:'none',eyes_closed:false,includeFixture:false,clip:'pool_enter',swimwear:'two_piece'});
  const anatomy=preparePoolEntryAnatomy(selected.body,{presentation:appearance.presentation,...appearance.body,face:appearance.face},anatomicalHeight(poolBase.vertices));
  for(const side of ['L','R'] as const){
    const foot=anatomy[side==='L'?'footL':'footR'],hand=anatomy[side==='L'?'handL':'handR'];
    expect(foot.front!.triangles).toHaveLength(24);expect(foot.back!.triangles.length).toBeGreaterThan(0);
    expect(foot.front!.area).toBeGreaterThan(0);expect(foot.back!.area).toBeGreaterThan(0);
    expect(hand.patch.part).toMatch(/^Relaxed palm/);expect(hand.patch.part).not.toContain('thumb');
    expect(foot.anchor[3]).toBeGreaterThan(.99);expect(hand.anchor[3]).toBeGreaterThan(.99);
  }
});
