import {validateAppearance} from '../../character/schema.js';
import {canonicalPoolValue,poolContactAppearance,poolContactAppearanceKey} from './pool-contact-identity.js';
import {sleepContactDigest} from './sleep-contact-protocol.js';
import {cross,dot,type Vec3} from './math.js';
import {validatePoolGraph} from './pool-motion-graph.js';
import {requirePoolSourcePolicy,requirePoolPolicyInterval,poolPolicySupportLimbs} from './pool-source-policy.js';
import {requirePoolIntervalProgram,type PoolPoseProgram} from './pool-pose-program.js';
import type {PoolIntervalLimb} from './pool-contact-evaluator.js';
import {POOL_SOLVER_REVISION,POOL_OBSERVER_REVISION,POOL_INTERPOLATION_REVISION,type PoolContactInputDataV1,type PoolContactInputV1,type PoolContactArtifactV1,type PoolFixtureV1} from './pool-contact-types.js';

function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid pool preparation record.');return value as Record<string,unknown>;}
function text(value:unknown):asserts value is string {if(typeof value!=='string'||!value.length||value.length>262144)throw new Error('Invalid pool preparation identity.');}
function numbers(value:unknown,size:number):asserts value is number[]{if(!Array.isArray(value)||value.length!==size||value.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw new Error('Pool geometry values must be finite.');}
function rigidBasis(matrix:number[],index:number):void {
  if(matrix[3]!==0||matrix[7]!==0||matrix[11]!==0||matrix[15]!==1)throw new Error('Pool basis must be affine.');
  const axes=[0,1,2].map(column=>matrix.slice(column*4,column*4+3) as unknown as Vec3);
  // This bounds floating-point serialization error, not physical clearance.
  const roundoff=1e-9;
  if(axes.some(axis=>Math.abs(dot(axis,axis)-1)>roundoff)
      ||Math.abs(dot(axes[0],axes[1]))>roundoff||Math.abs(dot(axes[0],axes[2]))>roundoff||Math.abs(dot(axes[1],axes[2]))>roundoff
      ||Math.abs(dot(cross(axes[0],axes[1]),axes[2])-1)>roundoff)throw new Error('Pool basis must preserve rigid segment lengths.');
  if(index>0&&(matrix[12]!==0||matrix[13]!==0||matrix[14]!==0))throw new Error('Pool child rest offsets must remain fixed.');
}
function header(value:unknown){const row=object(value);if(row.version!==1||row.solverRevision!==POOL_SOLVER_REVISION)throw new Error('Unsupported pool preparation version.');text(row.appearanceKey);const revisions=object(row.revisions);for(const name of ['body','garments','clips','fixture'])if(typeof revisions[name]!=='string'||!/^[a-f0-9]{64}$/.test(revisions[name] as string))throw new Error('Invalid pool physical source digest.');
  if(revisions.observer!==POOL_OBSERVER_REVISION||revisions.interpolation!==POOL_INTERPOLATION_REVISION)throw new Error('Pool observation or interpolation revision differs.');return row;}
function controlChain(control:Record<string,unknown>,ends:Set<number>):void {
  for(const name of ['upper','lower','end'])if(!Number.isInteger(control[name])||(control[name] as number)<1||(control[name] as number)>=17)throw new Error('Invalid pool control bone.');
  if(new Set([control.upper,control.lower,control.end]).size!==3||ends.has(control.end as number))throw new Error('Duplicate pool control bone.');ends.add(control.end as number);
  numbers(control.anchor,4);if(control.anchor[3]<=0)throw new Error('Invalid pool contact coefficient.');
  if(control.legFrame!==undefined&&control.legFrame!=='source-entry-0')throw new Error('Invalid pool oriented leg frame.');
}
function controlState(value:unknown):void {
  const state=object(value);numbers(state.target,3);numbers(state.pole,3);numbers(state.orientation,16);rigidBasis(state.orientation,1);
  if(state.attached!==undefined){
    const goal=object(state.attached),data=object(goal.geometry);const source=object(goal.source);text(source.action);if(!Number.isFinite(source.phase)||(source.phase as number)<0||(source.phase as number)>1||!['handL','handR'].includes(source.limb as string))throw new Error('Invalid pool attached source location.');numbers(goal.rawOrientation,16);rigidBasis(goal.rawOrientation,1);
    if(!Number.isFinite(goal.parameter)||!Number.isSafeInteger(goal.activeVertex)||(goal.activeVertex as number)<0||data.version!=='pool-rail-goal-v1')throw new Error('Invalid pool attached rail goal.');
    for(const name of ['sourceKey','part','surface'])text(data[name]);numbers(data.inverse,16);
    if(!Number.isSafeInteger(data.bone)||!Number.isFinite(data.planeX)||![1,-1].includes(data.side as number))throw new Error('Invalid pool attached rail owner.');
    if(!Array.isArray(data.vertices)||data.vertices.length<3||data.vertices.length>100000||data.vertices.some(value=>!Number.isSafeInteger(value)||value<0)||!data.vertices.includes(goal.activeVertex))throw new Error('Invalid pool complete-palm vertices.');
    if(!Array.isArray(data.coefficients)||data.coefficients.length!==data.vertices.length)throw new Error('Invalid pool attached coefficients.');
    for(const values of data.coefficients){if(!Array.isArray(values)||values.length!==4)throw new Error('Invalid pool attached coefficients.');for(const value of values){const term=object(value);if(typeof term.numerator!=='string'||!/^[-]?[0-9]{1,2048}$/.test(term.numerator)||!Number.isSafeInteger(term.exponent)||Math.abs(term.exponent as number)>4096)throw new Error('Invalid exact pool coefficient.');}}
    if(!Array.isArray(data.edges)||data.edges.length<1||data.edges.length>4096)throw new Error('Invalid pool attached edge domain.');
    for(const value of data.edges){const row=object(value),edge=object(row.edge);numbers(row.from,3);numbers(row.to,3);
      if(!Number.isSafeInteger(edge.from)||!Number.isSafeInteger(edge.to)||!Number.isFinite(edge.fromParameter)||!Number.isFinite(edge.toParameter)||(edge.fromParameter as number)>=(edge.toParameter as number)||!Array.isArray(row.incidentFacets)||!row.incidentFacets.length||row.incidentFacets.some(value=>!Number.isSafeInteger(value)||value<0))throw new Error('Invalid pool attached edge.');}
    const patch=object(data.patch);text(patch.part);if(patch.bone!==data.bone||patch.part!==data.part)throw new Error('Invalid pool attached patch owner.');
    const support=object(data.support),region=object(support.region);if(support.surface!==data.surface||region.kind!=='rail')throw new Error('Invalid pool attached support owner.');numbers(region.parameter,2);
    if((goal.parameter as number)<region.parameter[0]||(goal.parameter as number)>region.parameter[1])throw new Error('Pool attached parameter leaves its source domain.');
  }
}
export function validatePoolContactInputData(value:unknown):asserts value is PoolContactInputDataV1 {
  const row=header(value),appearance=validateAppearance(row.appearance);
  if(poolContactAppearanceKey(appearance)!==row.appearanceKey||canonicalPoolValue(appearance)!==row.appearanceKey)throw new Error('Pool appearance identity differs.');
}
export function validatePoolContactInput(value:unknown):asserts value is PoolContactInputV1 {validatePoolContactInputData(value);if(!/^pool-v1:[a-f0-9]{64}$/.test((value as PoolContactInputV1).key))throw new Error('Invalid pool preparation key.');}
export async function makePoolContactInput(data:PoolContactInputDataV1):Promise<PoolContactInputV1>{const appearance=poolContactAppearance(data.appearance),normalized={...data,appearance,appearanceKey:poolContactAppearanceKey(appearance)};validatePoolContactInputData(normalized);return {...normalized,key:'pool-v1:'+await sleepContactDigest(normalized)};}
export async function verifyPoolContactInput(input:PoolContactInputV1):Promise<void>{validatePoolContactInput(input);const {key,...data}=input;if((await makePoolContactInput(data)).key!==key)throw new Error('Pool preparation key does not match its input.');}

export function validatePoolArtifactForInput(value:unknown,input:PoolContactInputV1):asserts value is PoolContactArtifactV1 {
  validatePoolContactArtifact(value);
  if(value.key!==input.key||value.appearanceKey!==input.appearanceKey||canonicalPoolValue(value.revisions)!==canonicalPoolValue(input.revisions))throw new Error('Prepared pool motion does not match the requested physical inputs.');
}

export const POOL_ACTIONS=['pool_enter','pool_paddle',...Array.from({length:12},(_,i)=>'pool_exit_'+i)] as const;
export function validatePoolContactArtifact(value:unknown):asserts value is PoolContactArtifactV1 {
  const row=header(value);if(typeof row.key!=='string'||!/^pool-v1:[a-f0-9]{64}$/.test(row.key))throw new Error('Invalid pool artifact key.');
  for(const name of ['source','shapeKey'])text(row[name]);if(!Array.isArray(row.partKeys)||row.partKeys.length<2||row.partKeys.length>4)throw new Error('Pool motion requires its complete selected body and garments.');row.partKeys.forEach(text);
  if(typeof row.top!=='number'||!Number.isFinite(row.top)||row.top<=0)throw new Error('Invalid pool anatomical reference.');
  if(typeof row.waterHeight!=='number'||!Number.isFinite(row.waterHeight))throw new Error('Invalid pool water plane.');
  const coverage=object(row.coverage);
  if(coverage.observerRevision!==POOL_OBSERVER_REVISION||coverage.continuousBound!==false||!Number.isSafeInteger(coverage.samples)||(coverage.samples as number)<2
      ||!Number.isSafeInteger(coverage.interpolationSamples)||(coverage.interpolationSamples as number)<1||typeof coverage.minimumObservedClearance!=='number'||!Number.isFinite(coverage.minimumObservedClearance)
      ||typeof coverage.minimumClassifiedClearance!=='number'||!Number.isFinite(coverage.minimumClassifiedClearance)||coverage.minimumClassifiedClearance<0)throw new Error('Pool artifact has incomplete or failed physical observations.');
  const graph=object(row.graph);validatePoolGraph(graph as unknown as PoolContactArtifactV1['graph']);
  for(const value of graph.poses as unknown[]){const pose=object(value);
    if(!Array.isArray(pose.preferenceBasis)||pose.preferenceBasis.length!==17)throw new Error('Pool trajectory requires its shared 17-bone pre-control preference.');
    pose.preferenceBasis.forEach((matrix,index)=>{numbers(matrix,16);rigidBasis(matrix,index);});
    if(!Array.isArray(pose.controls)||pose.controls.length>4)throw new Error('Pool node requires its authoritative endpoint program.');
    requirePoolSourcePolicy(pose.policy);
    const ends=new Set<number>();for(const value of pose.controls){const control=object(value);controlChain(control,ends);controlState(control.state);}
  }
  let samples=0,interiors=0,minimum=Infinity,classifiedMinimum=Infinity;
  for(const value of [graph.entry,graph.paddle,...graph.bridges as unknown[]]){
    const track=object(value),keys=track.keys as unknown[];
    if(!Array.isArray(track.intervals)||track.intervals.length!==keys.length-1)throw new Error('Pool graph has incomplete interval coverage.');
    for(const [index,value] of track.intervals.entries()){const interval=object(value);
      if(interval.status!=='measured'||interval.observerRevision!==POOL_OBSERVER_REVISION||interval.interpolationRevision!==POOL_INTERPOLATION_REVISION)throw new Error('Pool interval observation revision differs.');
      if(!Array.isArray(interval.controls)||interval.controls.length>4)throw new Error('Invalid prepared pool limb controls.');
      const ends=new Set<number>();
      for(const value of interval.controls){const control=object(value);
        controlChain(control,ends);controlState(control.from);controlState(control.to);
      }
      const poses=graph.poses as PoolPoseProgram[],left=object(keys[index]).pose as number,right=object(keys[index+1]).pose as number;
      requirePoolIntervalProgram(poses[left],poses[right],interval.controls as unknown as PoolIntervalLimb[]);
      const limbs=['handL','handR','footL','footR'];
      if(!Array.isArray(interval.supportLimbs)||interval.supportLimbs.some(limb=>!limbs.includes(String(limb)))||new Set(interval.supportLimbs).size!==interval.supportLimbs.length)throw new Error('Invalid pool support coverage.');
      requirePoolSourcePolicy(interval.policy);requirePoolPolicyInterval(poses[left].policy,poses[right].policy,interval.policy,interval.supportLimbs as PoolContactArtifactV1['graph']['entry']['intervals'][number]['supportLimbs']);
      if(!Array.isArray(interval.observations)||interval.observations.length<3||interval.observations.length>17)throw new Error('Pool interval needs bounded endpoint and interior observations.');
      let previous=-1;const fractions=new Set<number>();
      for(const value of interval.observations){const observation=object(value),fraction=observation.fraction;
        if(typeof fraction!=='number'||!Number.isFinite(fraction)||fraction<0||fraction>1||fraction<=previous)throw new Error('Pool observation fractions must increase.');
        fractions.add(fraction);previous=fraction;samples++;if(samples>16384)throw new Error('Pool interval observations exceed their budget.');if(fraction>0&&fraction<1)interiors++;
        const clearance=observation.minimumObservedClearance,classified=observation.minimumClassifiedClearance;
        if(typeof clearance!=='number'||!Number.isFinite(clearance)||typeof classified!=='number'||!Number.isFinite(classified)||classified<0||classified>Math.max(0,clearance)||observation.rootReachSatisfied!==true)throw new Error('Pool interval has a failed physical observation.');
        if(!Array.isArray(observation.arithmeticContacts)||observation.arithmeticContacts.length>4)throw new Error('Invalid pool arithmetic contact record.');
        const contactOwners=new Set<string>();
        for(const value of observation.arithmeticContacts){const contact=object(value);text(contact.surface);
          if(contactOwners.has(String(contact.part))
            ||typeof contact.rawClearance!=='number'||!Number.isFinite(contact.rawClearance)||typeof contact.bound!=='number'||!Number.isFinite(contact.bound)||contact.bound<=0
            ||contact.rawClearance< -contact.bound||!Number.isSafeInteger(contact.activeVertex)||(contact.activeVertex as number)<0)throw new Error('Invalid pool constructive contact classification.');
          if(contact.method==='constructive-horizontal-foot-v1'){
            if(!['Creator bare foot L','Creator bare foot R'].includes(String(contact.part))||typeof contact.planeHeight!=='number'||!Number.isFinite(contact.planeHeight))throw new Error('Invalid pool constructive contact classification.');
          }else if(contact.method==='constructive-rail-edge-v1'){
            if(!['Relaxed palm','Relaxed palm.001'].includes(String(contact.part))||typeof contact.planeX!=='number'||!Number.isFinite(contact.planeX)
              ||!Array.isArray(contact.edge)||contact.edge.length!==2||contact.edge.some(value=>!Number.isSafeInteger(value)||value<0)||contact.edge[0]===contact.edge[1]
              ||!Array.isArray(contact.incidentFacets)||!contact.incidentFacets.length||contact.incidentFacets.length>16||contact.incidentFacets.some(value=>!Number.isSafeInteger(value)||value<0)||new Set(contact.incidentFacets).size!==contact.incidentFacets.length
              ||typeof contact.activePointResidual!=='number'||!Number.isFinite(contact.activePointResidual)||contact.activePointResidual<0||contact.activePointResidual>contact.bound)throw new Error('Invalid pool constructive rail classification.');
          }else throw new Error('Invalid pool constructive contact classification.');
          contactOwners.add(String(contact.part));
        }
        if(clearance<0&&!observation.arithmeticContacts.some(value=>(value as Record<string,unknown>).rawClearance===clearance))throw new Error('Pool raw penetration has no matching constructive classification.');
        minimum=Math.min(minimum,clearance);classifiedMinimum=Math.min(classifiedMinimum,classified);
        if(observation.airwayMinimum!==null&&(typeof observation.airwayMinimum!=='number'||!Number.isFinite(observation.airwayMinimum)))throw new Error('Invalid pool airway observation.');
        if(track!==graph.entry&&(typeof observation.airwayMinimum!=='number'||observation.airwayMinimum<row.waterHeight))throw new Error('Pool interval has no clear airway observation.');
        const expectedSupports=poolPolicySupportLimbs(fraction===0?poses[left].policy:fraction===1?poses[right].policy:interval.policy);
        if(!Array.isArray(observation.supports)||observation.supports.length!==expectedSupports.length)throw new Error('Pool interval has incomplete support outcomes.');
        const observed=new Set<string>();for(const value of observation.supports){const support=object(value);if(support.satisfied!==true||!expectedSupports.includes(support.limb as typeof expectedSupports[number])||observed.has(String(support.limb)))throw new Error('Pool interval has a failed support outcome.');observed.add(String(support.limb));}
      }
      if(!fractions.has(0)||!fractions.has(.5)||!fractions.has(1))throw new Error('Pool interval is missing deterministic observation phases.');
    }
  }
  if(coverage.samples!==samples||coverage.interpolationSamples!==interiors||coverage.minimumObservedClearance!==minimum||coverage.minimumClassifiedClearance!==classifiedMinimum)throw new Error('Pool observation summary does not match its intervals.');
}

/** Freeze the validated ownership boundary before identity-based binding or caching. */
export function freezePoolContactArtifact(value:unknown):PoolContactArtifactV1 {
  validatePoolContactArtifact(value);
  freezePoolRecord(value);return value;
}
function freezePoolRecord(row:unknown):void {if(row&&typeof row==='object'&&!Object.isFrozen(row)){for(const child of Object.values(row))freezePoolRecord(child);Object.freeze(row);}}
export function freezePoolFixture(value:unknown):PoolFixtureV1 {validatePoolFixture(value);freezePoolRecord(value);return value;}

export function validatePoolFixture(value:unknown):asserts value is PoolFixtureV1 {
  const row=object(value);if(row.version!==1||row.frame!=='pool-local-metres'||row.fixtureModel!=='pool'||typeof row.waterHeight!=='number'||!Number.isFinite(row.waterHeight)||!Array.isArray(row.solids)||!row.solids.length)throw new Error('Invalid evaluated pool fixture.');
  const names=new Set<string>();for(const value of row.solids){const solid=object(value);text(solid.id);if(names.has(solid.id)||!['solid','floor'].includes(String(solid.kind)))throw new Error('Invalid pool solid ownership.');names.add(solid.id);
    if(!Array.isArray(solid.vertices)||!solid.vertices.length||!Array.isArray(solid.triangles)||!solid.triangles.length)throw new Error('Pool solid requires evaluated geometry.');solid.vertices.forEach(v=>numbers(v,3));
    for(const triangle of solid.triangles){numbers(triangle,3);if(triangle.some(i=>!Number.isInteger(i)||i<0||i>=(solid.vertices as unknown[]).length))throw new Error('Pool solid triangle has an invalid vertex.');}
  }
  if(!Array.isArray(row.rails)||row.rails.length!==2)throw new Error('Pool requires its two authored handrails.');
  for(const value of row.rails){const rail=object(value);if(!names.has(String(rail.id))||typeof rail.radius!=='number'||rail.radius<=0||!Array.isArray(rail.points)||rail.points.length<2)throw new Error('Invalid pool rail.');for(const value of rail.points){const p=object(value);for(const name of ['point','left','right'])numbers(p[name],3);}}
}
