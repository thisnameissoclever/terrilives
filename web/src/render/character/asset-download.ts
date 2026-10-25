import {recordDiagnostic} from '../../diagnostics.js';
const MAX_ATTEMPTS=3;
let downloadSequence=0;
const MAX_RETRY_WAIT_MS=15_000;
const RESPONSE_HEADERS=['server','content-type','retry-after','age','via','x-cache','x-served-by','x-github-request-id','x-fastly-request-id'] as const;

function release(response:Response):void {
  try {void response.body?.cancel().catch(()=>{});} catch {}
}

async function failure(response:Response,url:URL):Promise<Error> {
  const headers=Object.fromEntries(RESPONSE_HEADERS.flatMap(name=>{
    const value=response.headers.get(name);return value?[[name,value.slice(0,160)]]:[];
  }));
  let body='',bodyIncomplete=false;
  if(response.body){
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const expired=new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),1000);});
    try{
      let remaining=1024;
      while(remaining>0){
        const chunk=await Promise.race([reader.read(),expired]);
        if(!chunk){bodyIncomplete=true;break;}
        if(chunk.done)break;
        const take=chunk.value.subarray(0,remaining);body+=decoder.decode(take,{stream:true});remaining-=take.length;
        if(chunk.value.length>take.length||remaining===0){bodyIncomplete=true;break;}
      }
      body+=decoder.decode();
    }catch{bodyIncomplete=true;}
    finally{clearTimeout(timer);try{void reader.cancel().catch(()=>{});}catch{}}
  }
  const assetFailure={path:url.pathname,status:response.status,headers,body,bodyIncomplete};
  const extra=Object.keys(headers).length||body?`\nResponse: ${JSON.stringify({headers,body,bodyIncomplete})}`:'';
  return Object.assign(new Error(`Character asset could not load: ${response.status} ${url.pathname}${extra}`),{assetFailure});
}

function retryDelay(response:Response,fallback:number):number {
  const value=response.headers.get('Retry-After')?.trim();
  if(!value)return fallback;
  if(/^\d+$/.test(value))return Number(value)*1000;
  if(!/^[A-Za-z]{3,9}[ ,]/.test(value))return fallback;
  const deadline=Date.parse(value);
  return Number.isFinite(deadline)?Math.max(0,deadline-Date.now()):fallback;
}

/** Recover a temporary service outage without accepting missing or invalid assets. */
async function download(url:URL):Promise<ArrayBuffer> {
  let waited=0;
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    const response=await (attempt===0?fetch(url):fetch(url,{cache:'reload'}));
    recordDiagnostic('asset.response',{path:url.pathname,status:response.status,attempt:attempt+1});
    if(response.ok)return response.arrayBuffer();
    const delay=retryDelay(response,attempt===0?500:1500);
    if(response.status!==503||attempt===MAX_ATTEMPTS-1||delay>MAX_RETRY_WAIT_MS-waited){
      throw await failure(response,url);
    }
    // Cleanup must not hold a retry open when a browser's cancellation never settles.
    release(response);
    waited+=delay;
    await new Promise<void>(resolve=>setTimeout(resolve,delay));
  }
  throw new Error('Character asset download attempts exhausted');
}

export async function readCharacterAsset(url:URL):Promise<ArrayBuffer> {
  const id=`download:${++downloadSequence}:${url.pathname}`,started=Date.now();
  recordDiagnostic('asset.download',{id,state:'start',path:url.pathname});
  try{
    const bytes=await download(url);
    recordDiagnostic('asset.download',{id,state:'complete',path:url.pathname,bytes:bytes.byteLength,elapsedMs:Date.now()-started});
    return bytes;
  }catch(error){recordDiagnostic('asset.download',{id,state:'failed',path:url.pathname,elapsedMs:Date.now()-started},error);throw error;}
}
