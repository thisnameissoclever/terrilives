import type {CharacterAppearanceV1} from '../../character/schema.js';
import type {Geometry,MeshPart} from './bundle.js';
import type {CharacterRig} from './clip-runtime.js';
import {compactGeometry,selectParts,type AppearanceContext} from './variants.js';
import type {CharacterBodyVariant} from './body-variants.js';
import {authoredOutline} from './authored-surfaces.js';

const contextual=new Set(['wear','prop','fixture','eyes_closed','clip','grip']);
const relaxedHands=new Set(['Relaxed palm','Relaxed palm.001','Resting thumb','Resting thumb.001']);
const context:AppearanceContext={wear:'clothed',prop:'none',fixture:'none',eyes_closed:false};
export interface SupplementalDraw {owner:CharacterBodyVariant|null;name:string;start:number;count:number;outline:boolean}
export type SupplementalBatch=Pick<SupplementalDraw,'owner'|'start'|'count'>;
export interface PreparedSelection {body:Geometry;extra:Geometry|null;variants:readonly CharacterBodyVariant[];supplementalDraws:readonly SupplementalDraw[];
  batches:{outline:readonly SupplementalBatch[];fill:readonly SupplementalBatch[]}}
function drawBatches(draws:readonly SupplementalDraw[],outline:boolean):SupplementalBatch[] {
  const batches:SupplementalBatch[]=[];
  for(const draw of draws){
    if(outline&&!draw.outline)continue;
    const previous=batches.at(-1);
    if(previous&&previous.owner===draw.owner&&previous.start+previous.count===draw.start)previous.count+=draw.count;
    else batches.push({owner:draw.owner,start:draw.start,count:draw.count});
  }
  return batches;
}
const independentSources=new WeakSet<Geometry>();

/** Hidden parts may retain normal adjacency only when each rendered vertex has one owner. */
export function assertIndependentBodyParts(source:Geometry):void {
  if(independentSources.has(source))return;
  const owners=new Int32Array(source.description.vertexCount).fill(-1);
  source.description.parts.forEach((part,owner)=>{
    for(let at=part.start;at<part.start+part.count;at++){
      const vertex=source.indices[at],previous=owners[vertex];
      if(previous!==-1&&previous!==owner)throw new Error(`Prepared character parts share vertex ${vertex}: ${source.description.parts[previous].name} and ${part.name}. Export separate part vertices before preparing this body.`);
      owners[vertex]=owner;
    }
  });
  independentSources.add(source);
}

/** One live appearance owns its body; action changes only select immutable part ranges. */
export class PreparedBody {
  readonly geometry:Geometry;
  private readonly partSelections=new Map<string,MeshPart[]>();
  private readonly selections=new WeakMap<CharacterRig,Map<string,PreparedSelection>>();
  constructor(base:Geometry,appearance:CharacterAppearanceV1){
    assertIndependentBodyParts(base);
    this.geometry=compactGeometry(base,selectParts(base,appearance,context,contextual));
  }
  select(rig:CharacterRig,appearance:CharacterAppearanceV1,context:AppearanceContext):PreparedSelection {
    let entries=this.selections.get(rig);if(!entries){entries=new Map();this.selections.set(rig,entries);}
    const key=JSON.stringify(context),saved=entries.get(key);if(saved)return saved;
    const source={...this.geometry,manifest:rig.manifest};
    const selectedParts=selectParts(this.geometry,appearance,context,undefined,false)
      .filter(part=>rig.family!=='cleaning'||context.grip!=='mop'||!relaxedHands.has(part.name));
    const partKey=selectedParts.map(part=>part.start).join(',');let parts=this.partSelections.get(partKey);
    if(!parts){parts=selectedParts;this.partSelections.set(partKey,parts);}
    const body:Geometry={...source,fixtureGeometry:rig.supplemental??rig.base,description:{...source.description,parts}};
    const selected=rig.supplemental?selectParts(rig.supplemental,appearance,context,undefined,false):[];
    const ownership=new Map<MeshPart,CharacterBodyVariant>();
    for(const variant of rig.bodyVariants??[])if(variant.source===rig.supplemental)for(const part of variant.sourceParts)ownership.set(part,variant);
    const props=selected.filter(part=>!ownership.has(part));
    const extra=props.length?compactGeometry(rig.supplemental!,props):null;
    const activeVariants=[...new Set(selected.flatMap(part=>ownership.has(part)?[ownership.get(part)!]:[]))];
    const supplementalDraws=selected.map(part=>{
      const owner=ownership.get(part)??null,geometry=owner?.geometry??extra!;
      const compacted=geometry.description.parts.find(row=>row.name===part.name)!;
      return {owner,name:part.name,start:compacted.start,count:compacted.count,outline:authoredOutline(part.name)};
    });
    const result={body,extra,variants:activeVariants,supplementalDraws,batches:{outline:drawBatches(supplementalDraws,true),fill:drawBatches(supplementalDraws,false)}};
    entries.set(key,result);return result;
  }
}

/** Colors and density change uniforms, while style determines the prepared body inventory. */
export function bodySelectionKey(appearance:CharacterAppearanceV1):string {
  const {colors,undertone,freckles,freckle_density,body,face,presentation,...selectors}=appearance;
  return JSON.stringify(selectors);
}
