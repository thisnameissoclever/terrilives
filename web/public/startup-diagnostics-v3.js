/* Independent of game allocation; retain evidence before the game module runs. */
(function(window,document){
  'use strict';
  const KEY='terrilives.startup-report.v1',MAX_STORE=32768,MAX_LINK=8000;
  const text=(value,limit)=>typeof value==='string'?value.slice(0,limit):'';
  const well=value=>Array.from(String(value),char=>char.length===1&&char.charCodeAt(0)>=0xD800&&char.charCodeAt(0)<=0xDFFF?'\uFFFD':char).join('');
  const now=()=>new Date().toISOString();
  let storage;try{storage=window.localStorage;}catch{}
  function read(){try{
    const raw=storage?.getItem(KEY);if(!raw||raw.length>MAX_STORE)return [];
    const saved=JSON.parse(raw);return saved.version===1&&Array.isArray(saved.attempts)
      ?saved.attempts.filter(row=>row&&['loading','ready','failed'].includes(row.state)).slice(-3):[];
  }catch{return [];}}
  function path(value){if(typeof value!=='string'||!value)return '';try{return new URL(value,window.location.href).pathname.slice(0,512);}catch{return '';}}
  const coordinate=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.floor(value)):undefined;
  const sourceDetails=value=>value?{operation:text(value.operation,80)||undefined,context:text(value.context,512)||undefined,path:path(value.path),line:coordinate(value.line),column:coordinate(value.column)}:undefined;
  const size=value=>JSON.stringify(value).length;
  function fitText(value,budget){
    const string=typeof value==='string'?value:'';if(size(string)<=budget)return string;
    const chars=Array.from(string);let low=0,high=chars.length;
    while(low<high){const middle=Math.ceil((low+high)/2);if(size(chars.slice(0,middle).join('')+' [trimmed]')<=budget)low=middle;else high=middle-1;}
    return chars.slice(0,low).join('')+' [trimmed]';
  }
  function fitSource(source){return source?{operation:fitText(source.operation,96)||undefined,context:fitText(source.context,192)||undefined,
    path:fitText(source.path,256),line:coordinate(source.line),column:coordinate(source.column)}:undefined;}
  function errorNode(error,budget){
    const result={name:fitText(error.name,128),message:fitText(error.message,budget===7000?2048:768)};
    const shortened=new Set(error.truncatedFields||[]);
    function add(key,value){if(value===undefined)return;if(size({...result,[key]:value})<=budget-256)result[key]=value;else shortened.add(key);}
    if(result.name!==error.name)shortened.add('name');if(result.message!==error.message)shortened.add('message');
    add('source',fitSource(error.source));add('code',error.code);add('workerErrorName',fitText(error.workerErrorName,128)||undefined);
    add('workerKind',fitText(error.workerKind,96)||undefined);add('workerSource',fitSource(error.workerSource));
    if(error.assetFailure)add('assetFailure',{path:fitText(error.assetFailure.path,384),status:error.assetFailure.status,
      headers:Object.fromEntries(Object.entries(error.assetFailure.headers||{}).map(([key,value])=>[key,fitText(value,48)])),body:fitText(error.assetFailure.body,budget===7000?512:128),bodyIncomplete:error.assetFailure.bodyIncomplete});
    for(const [key,allowance] of [['workerStack',budget===7000?1536:256],['stack',budget===7000?1024:256]]){
      if(!error[key])continue;const value=fitText(error[key],allowance);if(value!==error[key])shortened.add(key);add(key,value);
    }
    if(error.repeatCount)add('repeatCount',error.repeatCount);
    result.truncatedFields=[...shortened].slice(0,12);result.reportTrimmed=shortened.size>0||size(result)<size({...error,cause:undefined});return result;
  }
  function primaryError(error){
    if(!error)return undefined;const result=errorNode(error,7000);
    if(error.cause){result.cause=errorNode(error.cause,2500);if(error.cause.cause)result.cause.cause=errorNode(error.cause.cause,2500);}
    return result;
  }
  function errorSummary(error){return {name:fitText(error.name,96),message:fitText(error.message,256),at:text(error.at,48)||undefined,
    source:error.source?{operation:fitText(error.source.operation,80),path:fitText(error.source.path,128),line:coordinate(error.source.line),column:coordinate(error.source.column)}:undefined,
    repeatCount:error.repeatCount,summaryOnly:true};}
  function priorSummary(attempt){
    const result={startedAt:fitText(attempt.startedAt,48),state:attempt.state,phase:fitText(attempt.phase,128),build:fitText(attempt.build,128),
      gameVersion:version(attempt.gameVersion)||undefined,summaryOnly:true};
    if(attempt.error)result.error={name:fitText(attempt.error.name,64),message:fitText(attempt.error.message,160)};
    return result;
  }
  function valueText(value,limit=1024){
    try{
      const seen=new Set();
      function bounded(item,depth=0){
        if(typeof item==='string')return text(item,limit);
        if(typeof item==='bigint')return String(item);
        if(!item||typeof item!=='object')return typeof item==='function'?'[function]':item;
        if(seen.has(item))return '[circular]';seen.add(item);
        if(ArrayBuffer.isView(item))return `[${item.constructor.name}: ${item.byteLength} bytes]`;
        if(item instanceof ArrayBuffer)return `[ArrayBuffer: ${item.byteLength} bytes]`;
        if(depth>2)return '[nested value]';
        if(Array.isArray(item))return item.slice(0,12).map(child=>bounded(child,depth+1));
        const result=Object.fromEntries(Object.keys(item).slice(0,16).map(key=>[key,
          /^(authorization|cookie|password|access[_-]?token|refresh[_-]?token|secret|api[_-]?key|householdSave)$/i.test(key)
            ?'[excluded]':bounded(item[key],depth+1)]));
        if(typeof item.message==='string'){
          result.name=text(item.name,160)||item.constructor?.name||'Error';result.message=text(item.message,limit);
          if(typeof item.stack==='string')result.stack=text(item.stack,768);
          if(item.cause!==undefined)result.cause=bounded(item.cause,depth+1);
        }
        return result;
      }
      const result=typeof value==='string'?value:JSON.stringify(bounded(value));
      return text(result??String(value),limit);
    }catch{return '[unreadable diagnostic value]';}
  }
  function errorDetails(error,source,depth=0,seen=new Set()){
    try{
      if(error&&typeof error==='object'){
        if(seen.has(error))return {name:'Error',message:'[circular error cause]'};seen.add(error);
        const headers=['server','content-type','retry-after','age','via','x-cache','x-served-by','x-github-request-id','x-fastly-request-id'];
        const http=error.assetFailure;
        return {name:text(error.name,160)||(error.constructor?.name!=='Object'?text(error.constructor?.name,160):'')||'Error',message:typeof error.message==='string'?text(error.message,2048):valueText(error,2048),
          stack:text(error.stack,depth?768:1536)||undefined,code:typeof error.code==='number'?error.code:text(error.code,80)||undefined,
          truncatedFields:[['message',2048],['stack',depth?768:1536],['workerStack',2048]].filter(([key,limit])=>typeof error[key]==='string'&&error[key].length>limit).map(([key])=>key),
          workerStack:text(error.workerStack,2048)||undefined,workerErrorName:text(error.workerErrorName,160)||undefined,
          workerKind:text(error.workerKind,64)||undefined,source:sourceDetails(source),
          workerSource:sourceDetails(error.workerSource),
          cause:depth<2&&error.cause!==undefined?errorDetails(error.cause,undefined,depth+1,seen):undefined,
          assetFailure:http&&typeof http==='object'?{path:path(http.path),status:Number(http.status),
            headers:Object.fromEntries(headers.flatMap(name=>{const found=text(http.headers?.[name],160);return found?[[name,found]]:[];})),
            body:text(http.body,1024),bodyIncomplete:http.bodyIncomplete===true}:undefined};
      }
      return {name:'Error',message:valueText(error,2048),source:sourceDetails(source)};
    }catch{return {name:'Error',message:'The error object could not be read'};}
  }
  const version=value=>typeof value==='string'&&value.length<=96&&/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value)?value:'';
  function shareReport(attempts,notice){
    const last=attempts.at(-1),recorded=version(last?.gameVersion);
    return {version:1,attempts,reportContext:{gameVersion:recorded||version(document.querySelector('meta[name="natural-causes-version"]')?.content)||'unknown',
      versionSource:recorded?'recorded attempt':'report page',reportedAt:now(),browser:text(window.navigator.userAgent,512),
      ...(notice?{visibleFailure:{title:text(notice.title,160),detail:text(notice.detail,4096)}}:{})}};
  }
  function mailLink(report){
    const prefix='mailto:bugreport@stfuai.com?subject='+encodeURIComponent('[Bug report] Natural Causes v'+report.reportContext.gameVersion)+'&body=';
    const encoded=body=>encodeURIComponent(well(body).replace(/\r?\n/g,'\r\n'));
    const link=body=>prefix+encoded(body);
    function clipped(value,budget){
      const chars=Array.from(well(value));let low=0,high=chars.length;
      if(encoded(chars.join('')).length<=budget)return chars.join('');
      while(low<high){const middle=Math.ceil((low+high)/2);if(encoded(chars.slice(0,middle).join('')+' [trimmed]').length<=budget)low=middle;else high=middle-1;}
      return chars.slice(0,low).join('')+' [trimmed]';
    }
    const last=report.attempts.at(-1),errors=last?.errors??[],error=last?.error??errors.at(-1);
    const historical=!error&&report.attempts.slice(0,-1).reverse().find(attempt=>attempt.error);
    const actual=error||historical?.error;
    let body=[clipped(`Natural Causes v${report.reportContext.gameVersion} (${report.reportContext.versionSource}); Build: ${last?.build||'unknown'}`,380),
      clipped(`Attempt: ${last?.startedAt||'none'}; state=${last?.state||'not recorded'}; phase=${last?.phase||'unknown'}`,320),
      clipped(`Last seen: ${last?.lastSeenAt||last?.updatedAt||'unknown'}; first frame: ${last?.readyAt||'not recorded'}`,180),
      clipped('Browser: '+(last?.environment?.userAgent||report.reportContext.browser),160)].join('\n')+'\n';
    const frame=stack=>String(stack||'').split('\n').filter(line=>/\bat\s/.test(line)).slice(0,2).join('\n')||String(stack||'');
    if(actual){
      body+=(historical?'Previous attempt error: ':'Actual error: ')+clipped(actual.name||'Error',96)+': '+clipped(actual.message||'',680)+(actual.repeatCount?` (repeated ${actual.repeatCount})`:'')+'\n';
      if(actual.source)body+=clipped('Source: '+(actual.source.path||actual.source.operation||'unknown')+':'+(actual.source.line||0)+':'+(actual.source.column||0),280)+'\n';
      if(actual.cause)body+='Cause: '+clipped(actual.cause.name||'Error',64)+': '+clipped(actual.cause.message||'',220)+'\n';
      if(actual.workerStack||actual.workerSource||actual.workerKind)body+='Worker: '+clipped(actual.workerKind||actual.workerErrorName||'',64)+' '+
        (actual.workerSource?clipped(valueText(actual.workerSource),160):'')+' '+clipped(frame(actual.workerStack),160)+'\n';
      if(actual.assetFailure)body+=clipped('HTTP: '+actual.assetFailure.status+' '+clipped(actual.assetFailure.path||'',90)+' '+clipped(actual.assetFailure.body||'',140),330)+'\n';
      if(actual.stack)body+=clipped('Stack: '+frame(actual.stack),160)+'\n';
      if(actual.truncatedFields?.length||actual.reportTrimmed)body+=clipped('Error detail shortened; copy/download for more.',70)+'\n';
    }else body+='No JavaScript error was captured. Describe the problem here.\n';
    if(last?.pending?.count)body+=clipped('Pending operations: '+valueText(last.pending,1500),450)+'\n';
    if(last?.phases?.length)body+=clipped('Recent loading history: '+[...last.phases].reverse().map(row=>`${row.ms}ms ${row.phase}`).join(' < '),300)+'\n';
    const logs=last?.logs??[];
    const footer=count=>`\nIncluded ${count}/${logs.length} retained logs; ${last?.droppedLogCount||0} earlier records evicted. Older logs omitted where needed for the email link. Copy debug details or Download report provides the larger retained report.`;
    body+='Latest logs (newest first):\n';let included=0;
    for(const row of [...logs].reverse()){
      const ms=typeof row.ms==='number'&&Number.isFinite(row.ms)?row.ms:'?';
      let line=`+${ms}ms [${clipped(row.level||'info',24)}] ${clipped(row.operation||'',64)}: ${clipped(row.message||'',128)}${row.repeatCount?` (repeated ${row.repeatCount})`:''}\n`;
      line=clipped(line,256)+'\n';
      const room=MAX_LINK-link(body+footer(included+1)).length-64;
      if(room<80)break;
      if(link(body+line+footer(included+1)).length>MAX_LINK)line=clipped(line,Math.max(0,room-20))+'\n';
      if(link(body+line+footer(included+1)).length>MAX_LINK)break;
      body+=line;included++;
    }
    body+=footer(included);
    return link(body);
  }
  const providers=new WeakMap();
  function bindSharing(provider){
    for(const id of ['startup-report-email','report-bug']){
      const email=document.getElementById(id);if(!email)continue;providers.set(email,provider);
      email.href=mailLink(provider());
      if(!email.dataset.startupShareBound){email.dataset.startupShareBound='true';email.addEventListener('click',()=>{email.href=mailLink(providers.get(email)());});}
    }
    const copy=document.getElementById('startup-report-copy');if(!copy)return;providers.set(copy,provider);copy.disabled=false;
    if(copy.dataset.startupShareBound)return;copy.dataset.startupShareBound='true';
    copy.addEventListener('click',async()=>{
      const report=providers.get(copy)(),payload=JSON.stringify(report,null,2);
      const output=document.getElementById('startup-report-data');if(output)output.textContent=payload;
      const email=document.getElementById('startup-report-email');if(email)email.href=mailLink(report);
      const status=document.getElementById('startup-report-share-status'),manual=document.getElementById('startup-report-manual');
      try{await window.navigator.clipboard.writeText(payload);if(manual)manual.hidden=true;if(status)status.textContent='Copied. Send these details to Tim.';}
      catch{if(status)status.textContent='Copy was blocked by your browser. Select and copy the details below.';
        if(manual){manual.value=payload;manual.hidden=false;manual.focus();manual.select();}}
    });
  }
  if(document.documentElement.hasAttribute('data-startup-report')){
    const provider=()=>shareReport(read());
    const report=provider(),last=report.attempts.at(-1),output=document.getElementById('startup-report-data'),summary=document.getElementById('startup-report-summary');
    if(output)output.textContent=JSON.stringify(report,null,2);
    if(summary)summary.textContent=!last?'No report was saved in this browser.':last.state==='loading'
      ?'The last load is unfinished. This can also mean the page was closed.':last.state==='failed'
      ?'The last attempt recorded an error. '+text(last.error?.name,80)+': '+text(last.error?.message,220)
      :'The last attempt completed its first graphics frame. Recent logs appear below.';
    bindSharing(provider);
    const download=document.getElementById('startup-report-download');if(download){download.disabled=!last;download.addEventListener('click',()=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify(provider(),null,2)],{type:'application/json'})),anchor=document.createElement('a');
      anchor.href=url;anchor.download='natural-causes-debug-report.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });}return;
  }
  const attempts=read(),step=document.getElementById('startup-loading-step'),started=Date.now(),active=new Map();
  const current={startedAt:now(),updatedAt:now(),lastSeenAt:now(),state:'loading',phase:text(step?.textContent,160),
    build:path(document.querySelector('script[type="module"][src]')?.src),gameVersion:version(document.querySelector('meta[name="natural-causes-version"]')?.content)||'unknown',
    environment:{userAgent:text(window.navigator.userAgent,512),width:window.innerWidth,height:window.innerHeight,pixelRatio:window.devicePixelRatio,
      secure:window.isSecureContext,webgpu:!!window.navigator.gpu},logs:[],errors:[],phases:[],droppedLogCount:0};attempts.push(current);
  let scheduled,lastErrorSignature;
  function keepLogTail(){
    let used=2,start=current.logs.length;
    while(start>0){const next=size(current.logs[start-1])+(start<current.logs.length?1:0);if(used+next>10240)break;used+=next;start--;}
    if(start){current.logs.splice(0,start);current.droppedLogCount+=start;}
  }
  function contextSnapshot(){
    const pending={count:active.size,latest:[...active.values()].reverse().slice(0,8).map(row=>({operation:fitText(row.operation,96),id:fitText(row.id,192),startedAt:row.startedAt}))};
    while(size(pending)>1536)pending.latest.pop();pending.omitted=active.size-pending.latest.length;
    // Reserve room for the omitted count within the pending-work section.
    while(size(pending)>1536&&pending.latest.length){pending.latest.pop();pending.omitted=active.size-pending.latest.length;}
    const phases=current.phases.map(row=>({ms:row.ms,phase:fitText(row.phase,192)}));
    while(size(phases)>2400&&phases.length>1)phases.splice(1,1);
    return {pending,phases};
  }
  function write(){
    // Serialized section caps reserve 12,288 for the primary error, 10,240
    // for logs, 4,096 each for context/history, and 2,048 for the envelope.
    // Sections never borrow from the recent log tail.
    scheduled=undefined;current.updatedAt=now();current.lastSeenAt=now();
    keepLogTail();Object.assign(current,contextSnapshot());
    current.phase=fitText(current.phase,192);current.build=fitText(current.build,384);current.environment.userAgent=fitText(current.environment.userAgent,384);
    const previous=attempts.slice(0,-1).slice(-2).map(priorSummary);
    current.errors=current.errors.slice(-6).map(errorSummary);
    while(size({errors:current.errors,attempts:previous})>4096&&current.errors.length)current.errors.shift();
    attempts.splice(0,attempts.length-1,...previous);
    const raw=JSON.stringify({version:1,attempts});
    try{storage?.setItem(KEY,raw);}catch{}
  }
  function persist(immediate){
    if(immediate||typeof window.setTimeout!=='function'){if(scheduled!==undefined)window.clearTimeout?.(scheduled);write();}
    else if(scheduled===undefined)scheduled=window.setTimeout(write,250);
  }
  function append(level,operation,message,immediate=false){
    operation=fitText(operation,128);message=fitText(text(message,1200),1152);
    const previous=current.logs.at(-1);
    if(previous&&previous.level===level&&previous.operation===operation&&previous.message===message){
      previous.repeatCount=(previous.repeatCount||1)+1;previous.ms=Math.max(0,Date.now()-started);previous.at=now();keepLogTail();persist(immediate);return;
    }
    current.logs.push({ms:Math.max(0,Date.now()-started),at:now(),level,operation,message});keepLogTail();
    while(current.logs.length>80){current.logs.shift();current.droppedLogCount++;}persist(immediate);
  }
  function failed(error,source,logMessage){
    const details=errorDetails(error,source),signature=JSON.stringify(details);
    if(signature===lastErrorSignature){current.error.repeatCount=(current.error.repeatCount||1)+1;
      const last=current.errors.at(-1);if(last)last.repeatCount=current.error.repeatCount;persist(false);return;}
    lastErrorSignature=signature;current.failureStage=current.readyAt?'runtime':'startup';current.state='failed';current.error=primaryError(details);
    current.errors.push(errorSummary({...details,at:now()}));while(current.errors.length>6)current.errors.shift();
    append('error',source?.operation||'error',logMessage||details.name+': '+details.message,true);
  }
  function phase(){const value=text(step?.textContent,160);if(value===current.phase&&current.phases.length)return;
    current.phase=value;current.phases.push({ms:Math.max(0,Date.now()-started),phase:value});if(current.phases.length>24)current.phases.shift();
    append('info','loading.phase',value,true);
  }
  phase();
  const observer=step&&typeof MutationObserver==='function'?new MutationObserver(phase):null;
  observer?.observe(step,{childList:true,characterData:true,subtree:true});
  for(const level of ['debug','log','info','warn','error']){
    const original=window.console?.[level];if(typeof original!=='function')continue;
    window.console[level]=function(...args){try{
      const message=args.map(value=>value&&typeof value==='object'&&typeof value.message==='string'?value.name+': '+value.message:valueText(value)).join(' ');
      if(level==='error')failed(args.find(value=>value&&typeof value==='object'&&typeof value.message==='string')||{name:'ConsoleError',message},{operation:'console.error',context:message},message);
      else append(level,'console.'+level,message);
    }catch{}return original.apply(this,args);};
  }
  window.addEventListener('terrilives:startup-failure',event=>failed(event.detail,{operation:'application.failure'}));
  window.addEventListener('error',event=>{
    if(event.target&&event.target!==window&&(event.target.src||event.target.href)){
      failed({name:'ResourceError',message:'Resource failed to load: '+path(event.target.src||event.target.href)},{operation:'resource.error'});return;
    }
    failed(event.error??event.message,{operation:'window.error',path:path(event.filename),line:event.lineno,column:event.colno});
  },true);
  window.addEventListener('unhandledrejection',event=>failed(event.reason,{operation:'promise.rejection'}));
  window.addEventListener('terrilives:diagnostic',event=>{try{
    const data=event.detail;if(!data||typeof data.operation!=='string')return;
    const id=text(data.id,600);
    if(id&&data.state==='start')active.set(id,{operation:text(data.operation,80),id,startedAt:now()});
    else if(id&&(data.state==='complete'||data.state==='failed'))active.delete(id);
    if(data.error!==undefined){failed(data.error,{operation:text(data.operation,80),context:valueText(data.details,512)});return;}
    append('info',data.operation,data.message||valueText(data.details??{state:data.state,id}),
      data.state==='start'&&/^(gpu\.|worker\.|graphics\.)/.test(data.operation));
  }catch{}});
  window.addEventListener('terrilives:startup-ready',()=>{current.readyAt=now();if(!current.error)current.state='ready';observer?.disconnect();append('info','startup.ready','First graphics frame completed',true);});
  window.addEventListener('pagehide',()=>append('info','page.hide','Page hidden or unloaded',true));
  window.addEventListener('pageshow',event=>append('info','page.show',event.persisted?'Restored from browser history':'Page shown',true));
  document.addEventListener?.('visibilitychange',()=>append('info','page.visibility',document.visibilityState,true));
  document.addEventListener?.('click',event=>{
    const control=event.target?.closest?.('button,a,input,select');if(!control)return;
    append('info','ui.activate',valueText({id:control.id||undefined,label:text(control.getAttribute('aria-label')||control.textContent,80),type:control.tagName}));
  },true);
  window.setInterval?.(()=>persist(true),5000);
  const provider=notice=>()=>{persist(true);return shareReport(attempts,notice);};
  bindSharing(provider());
  window.addEventListener('terrilives:startup-report-controls',event=>bindSharing(provider(event.detail)));
})(window,document);
