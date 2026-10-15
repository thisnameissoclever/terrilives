import policy from '../../../../assets/models/sims/character-creator/surface-policy.json';

export const CHARACTER_OUTLINE_WIDTH=.004;

const outlines=new Map<string,boolean>();
for(const owner of Object.values(policy.owners))for(const name of owner.parts){
  if(outlines.has(name))throw new Error(`Duplicate outline ownership: ${name}`);
  outlines.set(name,owner.outline);
}

/** Exact authored ownership keeps attached details from growing competing shells. */
export function authoredOutline(name:string):boolean {
  const outline=outlines.get(name);
  if(outline===undefined)throw new Error(`Missing authored outline ownership: ${name}`);
  return outline;
}
