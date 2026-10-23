const MAX_ATTEMPTS=3;
const MAX_RETRY_WAIT_MS=15_000;

function retryDelay(response:Response,fallback:number):number {
  const value=response.headers.get('Retry-After')?.trim();
  if(!value)return fallback;
  if(/^\d+$/.test(value))return Number(value)*1000;
  if(!/^[A-Za-z]{3,9}[ ,]/.test(value))return fallback;
  const deadline=Date.parse(value);
  return Number.isFinite(deadline)?Math.max(0,deadline-Date.now()):fallback;
}

/** Recover a temporary service outage without accepting missing or invalid assets. */
export async function readCharacterAsset(url:URL):Promise<ArrayBuffer> {
  let waited=0;
  for(let attempt=0;attempt<MAX_ATTEMPTS;attempt++){
    const response=await (attempt===0?fetch(url):fetch(url,{cache:'reload'}));
    if(response.ok)return response.arrayBuffer();
    const delay=retryDelay(response,attempt===0?500:1500);
    // An already broken error body has nothing left to release; retain its HTTP status.
    try {await response.body?.cancel();} catch {}
    if(response.status!==503||attempt===MAX_ATTEMPTS-1||delay>MAX_RETRY_WAIT_MS-waited){
      throw new Error(`Character asset could not load: ${response.status} ${url.pathname}`);
    }
    waited+=delay;
    await new Promise<void>(resolve=>setTimeout(resolve,delay));
  }
  throw new Error('Character asset download attempts exhausted');
}
