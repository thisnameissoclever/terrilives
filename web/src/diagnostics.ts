/** Send bounded diagnostic context to the early recorder without owning storage. */
export function recordDiagnostic(operation:string,details?:Record<string,unknown>,error?:unknown):void {
  if(typeof window==='undefined')return;
  try{window.dispatchEvent(new CustomEvent('terrilives:diagnostic',{detail:{operation,details,error,
    id:typeof details?.id==='string'?details.id:undefined,state:details?.state}}));}catch{}
}
