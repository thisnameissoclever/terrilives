/** Editorial groups describe the pool, never a character's ancestry or appearance. */
export const nameGroups = {
  european: ['Alice','Amelia','Arthur','Beatrice','Clara','Edward','Eleanor','Elizabeth','Emmett','Felix',
    'Florence','Frances','George','Harriet','Henry','Hugo','Imogen','Iris','Jasper','Joseph',
    'Julian','Leo','Louis','Lucy','Matilda','Millie','Nora','Oliver','Oscar','Pippa',
    'Rose','Rowan','Sebastian','Sophie','Theo','Violet','William','Ada','Edith','Frederick'],
  northAmerican: ['Abigail','Addison','Aiden','Avery','Blake','Brooklyn','Cameron','Carter','Casey','Charlotte',
    'Chloe','Connor','Dylan','Ella','Emma','Ethan','Evan','Grace','Hailey','Hannah',
    'Harper','Jackson','Jacob','James','Jamie','Jordan','Kayla','Logan','Madison','Mason',
    'Morgan','Natalie','Noah','Owen','Parker','Peyton','Quinn','Riley','Taylor','Wyatt'],
  lessFamiliar: ['Amara','Anika','Dalia','Imani','Kiran','Leila','Liora','Mira','Nadia','Nia',
    'Noemi','Rafi','Ravi','Samira','Sora','Talia','Tarek','Yara','Zain','Zoya'],
} as const;
export const characterNames: readonly string[] = Object.values(nameGroups).flat();

export type NameGender='male'|'female'|'either';
const maleNames=new Set(['Arthur','Edward','Emmett','Felix','George','Henry','Hugo','Jasper','Joseph','Julian','Leo','Louis','Oliver','Oscar','Sebastian','Theo','William','Frederick',
  'Aiden','Connor','Ethan','Evan','Jackson','Jacob','James','Mason','Noah','Owen','Wyatt','Rafi','Ravi','Tarek','Zain']);
const eitherNames=new Set(['Rowan','Addison','Avery','Blake','Cameron','Carter','Casey','Dylan','Harper','Jamie','Jordan','Logan','Morgan','Parker','Peyton','Quinn','Riley','Taylor','Kiran','Sora']);
/** Tags guide random suggestions only; player-entered names remain unrestricted. */
export const taggedCharacterNames=characterNames.map(name=>({name,gender:(maleNames.has(name)?'male':eitherNames.has(name)?'either':'female') as NameGender}));
export function namesForPresentation(presentation:'masculine'|'feminine'):readonly string[] {
  const gender=presentation==='masculine'?'male':'female';
  return taggedCharacterNames.filter(row=>row.gender===gender||row.gender==='either').map(row=>row.name);
}
