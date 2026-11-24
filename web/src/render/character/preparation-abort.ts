const ownedCancellations=new WeakSet<Error>();
export function preparationCancelled():Error {
  const error=new Error('Character preparation was superseded or released.');error.name='AbortError';ownedCancellations.add(error);return error;
}
export function isPreparationCancelled(value:unknown):boolean{return typeof value==='object'&&value!==null&&ownedCancellations.has(value as Error);}

/** Stop waiting immediately; a late operation still has a rejection handler. */
export function awaitPreparation<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(body:()=>void)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);body();};
    const abort=()=>finish(()=>reject(preparationCancelled()));
    operation.then(value=>finish(()=>resolve(value)),error=>finish(()=>reject(error)));
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });
}
