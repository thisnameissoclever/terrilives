import type { CharacterCatalog } from './catalog.js';
import { displayValue, hex, type CharacterField } from './fields.js';
import { floatValue, type CharacterDraftV1, type F32Bits, type Rgb } from './schema.js';

/**
 * Two fraction digits, by design. Every creator control steps by 0.01 at the
 * finest, so the creator hides anything below that: a widened 32-bit value's
 * trailing digits, and the finer digits a spawned housemate's values can
 * carry, are detail nobody can set here. A nonzero value that would otherwise
 * round to 0 keeps two significant digits so a tiny setting never reads as
 * "off".
 */
export const readableNumber=(value:number):string=>value!==0&&Math.abs(value)<.005
  ?Number(value.toPrecision(2)).toString():new Intl.NumberFormat('en',{maximumFractionDigits:2}).format(value);
export function skillStanding(practice:F32Bits,thresholds:readonly F32Bits[]):{level:number;progress:number;maximum:boolean} {
  const value=floatValue(practice),steps=thresholds.map(floatValue);let level=0;
  while(level+1<steps.length&&value>=steps[level+1])level++;
  const maximum=level>=steps.length-1;
  return {level,maximum,progress:maximum?1:Math.max(0,Math.min(1,(value-(steps[level]??0))/(steps[level+1]-steps[level])))};
}
export function reviewValue(field:CharacterField,draft:CharacterDraftV1,catalog:CharacterCatalog):string {
  const value=field.get(draft);
  if(field.id==='appearance.body.height')return `${readableNumber(85+.3*Number(value))}% of average`;
  const skill=catalog.skills.find(skill=>field.id===JSON.stringify(['skill',skill.id]));
  if(skill){const standing=skillStanding(value as F32Bits,skill.thresholds);
    return standing.maximum?`Level ${standing.level} (maximum)`:`Level ${standing.level}; ${Math.round(standing.progress*100)}% to level ${standing.level+1}`;
  }
  if(field.id.startsWith('["affinity",')){
    const number=floatValue(value as F32Bits),meaning=number<0?'Dislikes':number>0?'Likes':'Neutral';
    return `${meaning} (${readableNumber(number)})`;
  }
  const choice=field.choices?.find(choice=>JSON.stringify(choice.value)===JSON.stringify(value));
  if(choice)return choice.label;
  if(field.kind==='color')return hex(value as Rgb);
  if(typeof value==='boolean')return value?'Yes':'No';
  const displayed=displayValue(field,value);
  return typeof displayed==='number'?readableNumber(displayed)+(field.unit==='hours'?' hours':field.unit??''):String(displayed);
}
