import manifest from '../../../../assets/models/sims/character-creator/export/manifest.json';
import library from '../../../../assets/models/sims/character-creator/clips/clips.json';
import { loadGeometryAssets, type Bundle, type Geometry } from './bundle.js';
import { combineClipFamily, prepareClipFamily, type CharacterRig, type ClipLibrary, type ClipParts } from './clip-runtime.js';
import {prepareMopHandVariant,withBodyVariants,type CharacterBodyVariant} from './body-variants.js';
import {readCharacterAsset} from './asset-download.js';

const files = import.meta.glob<string>('../../../../assets/models/sims/character-creator/{export,clips/**}/runtime*.bin', { eager: true, query: '?url', import: 'default' });
const partsFiles = import.meta.glob<string>('../../../../assets/models/sims/character-creator/clips/*/parts.json', { eager: true, query: '?url', import: 'default' });
const urlsFor = (folder: string) => Object.fromEntries(Object.entries(files).filter(([path]) => path.includes(`/${folder}/`)).map(([path,url]) => [path.slice(path.lastIndexOf('/')+1),url]));
let base: Promise<Geometry> | undefined;
const families = new Map<string,Promise<Geometry>>();
const rigs=new Map<string,Promise<{rig:CharacterRig;parts:ClipParts;raw:Geometry|null}>>();
let baseRig:Promise<CharacterRig>|undefined;
let bodyVariants:Promise<readonly CharacterBodyVariant[]>|undefined;
export const creatorClips = library as unknown as ClipLibrary;

export function loadCreatorGeometry(): Promise<Geometry> {
  if (!base) base = loadGeometryAssets(manifest as unknown as Bundle, urlsFor('export')).catch(error => { base = undefined; throw error; });
  return base;
}
async function loadFamily(family:string){
  let pending=rigs.get(family);
  if(!pending){
    pending=(async()=>{
      const geometry=await loadCreatorGeometry();
      const url=Object.entries(partsFiles).find(([path])=>path.endsWith(`/${family}/parts.json`))?.[1];
      if(!url)throw new Error(`No creator clip geometry: ${family}`);
      const parts=JSON.parse(new TextDecoder().decode(await readCharacterAsset(new URL(url,location.href)))) as ClipParts;
      const raw=parts.geometry?await loadGeometryAssets({...geometry.manifest,original:parts.geometry,runtime:parts.geometry,materials:parts.materials},urlsFor(`clips/${family}`)):null;
      return {rig:prepareClipFamily(geometry,raw,parts,creatorClips,family),parts,raw};
    })().catch(error=>{rigs.delete(family);throw error;});
    rigs.set(family,pending);
  }
  return pending;
}

/** Production actors compose tracks and small attachments around their existing body. */
export async function loadCreatorRig(action:string):Promise<CharacterRig>{
  const family=creatorClips.clips[action]?.family;
  bodyVariants??=loadFamily('cleaning').then(({rig})=>[prepareMopHandVariant(rig)]).catch(error=>{bodyVariants=undefined;throw error;});
  baseRig??=loadCreatorGeometry().then(base=>({base,manifest:base.manifest,supplemental:null,family:''})).catch(error=>{baseRig=undefined;throw error;});
  const [rig,variants]=await Promise.all([family?loadFamily(family).then(({rig})=>rig):baseRig,bodyVariants]);
  if(!rig.manifest.actions[action])throw new Error(`No creator animation: ${action}`);return withBodyVariants(rig,variants);
}

/** Contiguous geometry remains available for independent asset and physical proofs. */
export async function loadCreatorClip(action:string):Promise<Geometry>{
  const family=creatorClips.clips[action]?.family;if(!family){const base=await loadCreatorGeometry();if(!base.manifest.actions[action])throw new Error(`No creator animation: ${action}`);return base;}
  let pending=families.get(family);
  if(!pending){pending=loadFamily(family).then(({rig,parts,raw})=>combineClipFamily(rig.base,raw,parts,creatorClips,family)).catch(error=>{families.delete(family);throw error;});families.set(family,pending);}
  return pending;
}
