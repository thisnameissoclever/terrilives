export type BathToy = 'none'|'duck'|'boat'|'submarine';
export const BATH_PLAY_TICKS=36;

export function bathToySelector(identity:number):BathToy {
  const toy=(['none','duck','boat','submarine'] as const)[identity];
  if(!Number.isInteger(identity)||toy===undefined)throw new Error('Invalid native bath toy identity.');
  return toy;
}

export function bathAnimationSample(elapsed:number,count:number,reducedMotion:boolean):number {
  if(!Number.isFinite(elapsed)||elapsed<0||!Number.isInteger(count)||count<1)throw new Error('Invalid bath animation clock.');
  return reducedMotion?0:(elapsed%BATH_PLAY_TICKS)*count/BATH_PLAY_TICKS;
}
