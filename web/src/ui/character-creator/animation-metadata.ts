import base from '../../../../assets/models/sims/character-creator/export/manifest.json';
import library from '../../../../assets/models/sims/character-creator/clips/clips.json';

/** Exported metadata supplies sample counts; preview-only durations are declared here. */
const durations:Readonly<Record<string,number>>={idle:1,walk:1,read:4.8,mop:4};
const baseActions=base.actions as Record<string,readonly unknown[]>;
const clips=library.clips as Record<string,{samples:readonly unknown[]}>;
export function previewAnimationTiming(action:string):{frames:number;seconds:number} {
  const frames=clips[action]?.samples.length??baseActions[action]?.length,seconds=durations[action];
  if(!frames||!seconds)throw new Error('No preview animation timing for '+action+'.');
  return {frames,seconds};
}
