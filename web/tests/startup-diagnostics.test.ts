import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {expect,it,vi} from 'vitest';

const key='terrilives.startup-report.v1';
function boot(saved?:string,reportPage=false,denied=false,clipboardFails=false,batched=false){
  const values=new Map<string,string>(saved?[[key,saved]]:[]),events=new Map<string,((event:unknown)=>void)[]>();
  const step={textContent:'Downloading the game'},output={textContent:''},summary={textContent:''};
  const download={disabled:true,addEventListener:vi.fn()},fetch=vi.fn(()=>{throw Error('Unexpected network request');});
  const clicks=new Map<string,()=>Promise<void>|void>();
  const copy={disabled:false,addEventListener:(event:string,callback:()=>Promise<void>)=>clicks.set(event,callback),dataset:{}};
  const emailClicks=new Map<string,()=>void>();
  const email={href:'',dataset:{},addEventListener:(event:string,callback:()=>void)=>emailClicks.set(event,callback),setAttribute:vi.fn()},shareStatus={textContent:''};
  const manual={hidden:true,value:'',focus:vi.fn(),select:vi.fn()};
  const writeText=vi.fn(async(_value:string)=>{if(clipboardFails)throw Error('Clipboard denied');});
  let observe:(()=>void)|undefined;
  const pending=new Map<number,()=>void>();let timer=0;
  const storage={getItem:(name:string)=>values.get(name)??null,setItem:vi.fn((name:string,value:string)=>values.set(name,value))};
  const originalConsole={debug:vi.fn(),log:vi.fn(),info:vi.fn(),warn:vi.fn(),error:vi.fn()},testConsole={...originalConsole};
  const window={console:testConsole,navigator:{userAgent:'test-browser',gpu:{},clipboard:{writeText}},devicePixelRatio:3,innerWidth:402,innerHeight:874,isSecureContext:true,
    location:{href:'https://game.test/terrilives/?private=query'},
    get localStorage(){if(denied)throw Error('storage denied');return storage;},
    addEventListener:(name:string,callback:(event:unknown)=>void)=>events.set(name,[...(events.get(name)??[]),callback]),
    ...(batched?{setTimeout:(callback:()=>void)=>{pending.set(++timer,callback);return timer;},clearTimeout:(id:number)=>pending.delete(id)}:{}),
  };
  const document={readyState:'complete',documentElement:{hasAttribute:()=>reportPage},
    getElementById:(id:string)=>({'startup-loading-step':step,'startup-report-data':output,'startup-report-summary':summary,'startup-report-download':download,
      'startup-report-copy':copy,'startup-report-email':email,'startup-report-share-status':shareStatus,'startup-report-manual':manual}[id]),
    querySelector:(selector:string)=>selector.startsWith('meta')?{content:'1.0.0'}:{src:'https://game.test/terrilives/assets/index-build.js'},
  };
  vm.runInNewContext(readFileSync(new URL('../public/startup-diagnostics-v3.js',import.meta.url),'utf8'),
    {window,document,navigator:window.navigator,URL,Date,JSON,fetch,console,
      MutationObserver:class{constructor(callback:()=>void){observe=callback;}observe(){}disconnect(){}},
    });
  return {values,step,output,summary,download,fetch,email,manual,shareStatus,writeText,console:testConsole,originalConsole,writes:storage.setItem,flush:()=>{const calls=[...pending.values()];pending.clear();calls.forEach(callback=>callback());},clickEmail:()=>emailClicks.get('click')?.(),clickCopy:()=>clicks.get('click')?.(),emit:(name:string,event:unknown={})=>events.get(name)?.forEach(callback=>callback(event)),
    phase:(text:string)=>{step.textContent=text;observe?.();},report:()=>JSON.parse(values.get(key)!) };
}

it('retains an unfinished attempt across the next load without calling it a crash',()=>{
  const first=boot();first.phase('Loading character models');
  const second=boot(first.values.get(key));
  expect(second.report().attempts).toHaveLength(2);
  expect(second.report().attempts[0]).toMatchObject({state:'loading',phase:'Loading character models',build:'/terrilives/assets/index-build.js',gameVersion:'1.0.0'});
  expect(first.values.get(key)).not.toContain('private=query');
});

it('retains the real error, cause and source location after the first completed frame',()=>{
  const run=boot();run.emit('terrilives:startup-ready');
  const error=new Error('Render pass attachment rejected',{cause:new Error('Texture was destroyed')});
  run.emit('error',{error,filename:'https://game.test/assets/index.js?secret=query',lineno:52,colno:9});
  expect(run.report().attempts[0]).toMatchObject({state:'failed',failureStage:'runtime',error:{message:'Render pass attachment rejected',cause:{message:'Texture was destroyed'},source:{path:'/assets/index.js',line:52,column:9}}});
  expect(run.values.get(key)).not.toContain('secret=query');
});

it('includes a later actual error when the email and copy controls are used',async()=>{
  const run=boot();run.emit('terrilives:startup-report-controls',{detail:{title:'Error',detail:'Initial failure'}});
  run.emit('terrilives:startup-failure',{detail:new Error('The actual later failure')});
  run.clickEmail();expect(new URL(run.email.href).searchParams.get('body')).toContain('The actual later failure');
  await run.clickCopy();expect(run.writeText.mock.calls.at(-1)?.[0]).toContain('The actual later failure');
});

it('captures console errors and structured promise rejections while preserving console output',()=>{
  const run=boot();run.emit('terrilives:startup-ready');
  run.console.debug('Debug operation marker');
  run.console.error('Graphics recovery failed',new Error('Device queue lost'));
  run.emit('unhandledrejection',{reason:{name:'PrepareError',message:'Unsupported contact geometry',code:42}});
  const attempt=run.report().attempts[0];
  expect(attempt.logs.some((row:{message:string})=>row.message.includes('Graphics recovery failed'))).toBe(true);
  expect(attempt.logs.some((row:{message:string})=>row.message.includes('Debug operation marker'))).toBe(true);
  expect(attempt.errors.some((row:{message:string})=>row.message==='Device queue lost')).toBe(true);
  expect(attempt.error).toMatchObject({name:'PrepareError',message:'Unsupported contact geometry',code:42});
});

it('retains phase history and newest logs, bounded in storage and in the encoded email link',()=>{
  const run=boot();run.phase('Starting graphics');run.emit('terrilives:startup-ready');
  for(let i=0;i<150;i++)run.emit('terrilives:diagnostic',{detail:{operation:'test.step',message:`Latest record ${i} & # café 🚀 `+'x'.repeat(150)}});
  run.emit('error',{error:new Error('Actual terminal error & café 🚀')});
  run.emit('terrilives:startup-report-controls',{detail:{title:'Failure',detail:'Actual terminal error'}});run.clickEmail();
  const body=new URL(run.email.href).searchParams.get('body')!;
  expect(run.email.href.length).toBeLessThanOrEqual(8000);
  expect(body).toContain('Actual terminal error & café 🚀');expect(body).toContain('Latest record 149');
  expect(body).not.toContain('Latest record 0 ');expect(body).toMatch(/omitted/i);
  expect(run.values.get(key)!.length).toBeLessThanOrEqual(32768);
  expect(run.report().attempts[0].phases.some((row:{phase:string})=>row.phase==='Starting graphics')).toBe(true);
});

it('keeps rich nested errors and pending operations readable within the storage budget',()=>{
  const run=boot(),headers=Object.fromEntries(['server','content-type','retry-after','age','via','x-cache','x-served-by','x-github-request-id','x-fastly-request-id'].map(key=>[key,'h'.repeat(160)]));
  let error:unknown;
  for(let i=0;i<3;i++)error={name:'n'.repeat(160),message:'Actual detailed error '+ 'm'.repeat(2048),stack:'s'.repeat(1536),workerStack:'w'.repeat(2048),workerErrorName:'e'.repeat(160),workerKind:'k'.repeat(64),workerSource:{path:'p'.repeat(512),line:1,column:1},assetFailure:{path:'p'.repeat(512),status:503,headers,body:'b'.repeat(1024)},cause:error};
  for(let i=0;i<8;i++)run.emit('terrilives:diagnostic',{detail:{operation:'operation',id:String(i).padEnd(600,'i'),state:'start'}});
  run.emit('error',{error});
  expect(run.values.get(key)!.length).toBeLessThanOrEqual(32768);
  expect(boot(run.values.get(key),true).output.textContent).toContain('Actual detailed error');
});

it('sanitizes malformed source coordinates without poisoning later report persistence',()=>{
  const run=boot(),cycle:Record<string,unknown>={};cycle.self=cycle;
  expect(()=>run.emit('error',{error:{message:'Actual error survives',workerSource:{path:'worker.js',line:cycle,column:1}}})).not.toThrow();
  run.emit('pagehide');expect(run.report().attempts[0].error.message).toBe('Actual error survives');
});

it('does not coalesce distinct worker errors behind an identical wrapper',()=>{
  const run=boot();
  run.emit('error',{error:{message:'Preparation failed',workerStack:'worker location A'}});
  run.emit('error',{error:{message:'Preparation failed',workerStack:'worker location B'}});
  expect(run.report().attempts[0].error.workerStack).toBe('worker location B');
});

it('counts CRLF and Unicode expansion against the complete mail link budget',()=>{
  const saved=JSON.stringify({version:1,attempts:[{state:'failed',phase:'\n'.repeat(160),environment:{userAgent:'\n'.repeat(200)},error:{name:'Error',message:'\n'.repeat(2048),stack:'\n'.repeat(1536)},phases:Array.from({length:24},(_,ms)=>({ms,phase:'\n'.repeat(160)})),logs:[{ms:1,level:'error',operation:'unicode',message:'Newest 🚀 café \ud800'}]}]});
  const view=boot(saved,true);expect(view.email.href.length).toBeLessThanOrEqual(8000);
  expect(new URL(view.email.href).searchParams.get('body')).toContain('Newest 🚀 café');
});

it('persists the first error immediately and coalesces repeat writes without suppressing console output',()=>{
  const run=boot(undefined,false,false,false,true),error=new Error('Repeated validation failure');
  run.console.error('Renderer failed',error);
  expect(run.report().attempts[0].error.message).toBe('Repeated validation failure');
  const writes=run.writes.mock.calls.length;
  for(let i=0;i<99;i++)run.console.error('Renderer failed',error);
  expect(run.writes.mock.calls.length).toBe(writes);expect(run.originalConsole.error).toHaveBeenCalledTimes(100);
  run.flush();expect(run.report().attempts[0].error.repeatCount).toBe(100);
});

it('reads newly saved errors when an already open standalone report is shared',()=>{
  const view=boot(JSON.stringify({version:1,attempts:[{state:'ready',gameVersion:'1.0.0'}]}),true);
  view.values.set(key,JSON.stringify({version:1,attempts:[{state:'failed',gameVersion:'1.0.0',error:{name:'Error',message:'Latest saved failure'}}]}));
  view.clickEmail();expect(new URL(view.email.href).searchParams.get('body')).toContain('Latest saved failure');
});

it('retains actual nested Error fields in structured console diagnostics and displays the latest error',()=>{
  const run=boot();run.console.error('Nested failure',{error:new Error('Actual nested failure'),access_token:'private credential'});
  expect(run.report().attempts[0].error.message).toContain('Actual nested failure');
  expect(run.values.get(key)).not.toContain('private credential');
  const view=boot(run.values.get(key),true);expect(view.summary.textContent).toContain('Actual nested failure');
});

it('preserves newest useful logs ahead of large historical error copies under storage pressure',()=>{
  const run=boot(),headers=Object.fromEntries(['server','content-type','retry-after','age','via','x-cache','x-served-by','x-github-request-id','x-fastly-request-id'].map(key=>[key,'h'.repeat(160)]));
  for(let i=0;i<12;i++)run.emit('terrilives:diagnostic',{detail:{operation:'meaningful.info',message:`Useful recent context ${i} `+'x'.repeat(160)}});
  for(let i=0;i<6;i++)run.emit('error',{error:{name:'Error',message:`Distinct failure ${i} `+'m'.repeat(1800),stack:'s'.repeat(1536),workerStack:'w'.repeat(2048),workerErrorName:'WorkerError',workerKind:'sleep',workerSource:{path:'/worker.js',line:12,column:4},assetFailure:{path:'/asset.bin',status:503,headers,body:'b'.repeat(1024)}}});
  const attempt=run.report().attempts.at(-1);
  expect(attempt.error.message).toContain('Distinct failure 5');
  expect(attempt.logs.some((row:{message:string})=>row.message.includes('Useful recent context 11'))).toBe(true);
  run.emit('terrilives:startup-report-controls',{detail:{title:'Failure',detail:'Distinct failure 5'}});run.clickEmail();
  const body=new URL(run.email.href).searchParams.get('body')!;
  expect(body).toContain('Distinct failure 5');expect(body).not.toContain('Included 0/0 retained logs');
  expect(body.indexOf('Distinct failure 5')).toBeLessThan(body.indexOf('Distinct failure 4'));
});

it('copies the full report and includes its actual error in a correctly encoded compact email',async()=>{
  const first=boot();first.emit('terrilives:startup-failure',{detail:new Error('503 & # ? % café')});
  const view=boot(first.values.get(key),true);await view.clickCopy();
  const copied=view.writeText.mock.calls[0]?.[0];expect(copied).toBeTruthy();
  const parsed=JSON.parse(copied!);expect(parsed.attempts).toEqual(first.report().attempts);
  expect(view.shareStatus.textContent).toMatch(/Copied/);
  const mail=new URL(view.email.href);
  expect(mail.protocol).toBe('mailto:');expect(mail.pathname).toBe('bugreport@stfuai.com');
  expect(mail.searchParams.get('subject')).toBe('[Bug report] Natural Causes v1.0.0');
  expect(view.email.href.length).toBeLessThanOrEqual(8000);
  expect(mail.searchParams.get('body')).toContain('503 & # ? % café');
  expect(view.fetch).not.toHaveBeenCalled();
});

it('offers selectable details when copying is blocked',async()=>{
  const view=boot(undefined,true,false,true);await view.clickCopy();
  expect(view.shareStatus.textContent).toMatch(/blocked/);
  expect(view.manual.hidden).toBe(false);expect(view.manual.value).toContain('reportContext');
  expect(view.manual.select).toHaveBeenCalled();expect(view.email.href).toMatch(/^mailto:/);
});

it('shares an in-memory failure directly from the error card when storage is denied',async()=>{
  const run=boot(undefined,false,true);run.emit('terrilives:startup-failure',{detail:new Error('refused')});
  run.emit('terrilives:startup-report-controls',{detail:{title:'The game failed to start',detail:'refused'}});
  await run.clickCopy();
  expect(run.writeText.mock.calls[0]?.[0]).toContain('refused');
  expect(run.email.href).toMatch(/^mailto:/);
});

it('labels the current page version when an older saved attempt has no version',()=>{
  const saved=JSON.stringify({version:1,attempts:[{state:'loading',phase:'Loading models'}]});
  const view=boot(saved,true),body=JSON.parse(view.output.textContent);
  expect(body.reportContext).toMatchObject({gameVersion:'1.0.0',versionSource:'report page'});
  expect(body.attempts[0].gameVersion).toBeUndefined();
});

it('bounds an old large error in the email while retaining the full copy report',()=>{
  const saved=JSON.stringify({version:1,attempts:[{state:'failed',error:{message:'Z'.repeat(25000)}}]});
  const view=boot(saved,true),body=new URL(view.email.href).searchParams.get('body')!;
  expect(view.email.href.length).toBeLessThanOrEqual(8000);expect(body).toContain('[trimmed]');
  expect(JSON.parse(view.output.textContent).attempts[0].error.message).toHaveLength(25000);
});

it('records readiness only from completed graphics, independently of cover removal',()=>{
  const run=boot();run.phase('Drawing the house');
  expect(run.report().attempts[0].state).toBe('loading');
  run.emit('terrilives:startup-ready');
  expect(run.report().attempts[0]).toMatchObject({state:'ready',phase:'Drawing the house'});
});

it('retains a handled startup error and bounded HTTP evidence',()=>{
  const run=boot();run.phase('Loading character models');
  run.emit('terrilives:startup-failure',{detail:Object.assign(new Error('503 /asset.bin'),{
    assetFailure:{path:'/asset.bin',status:503,headers:{server:'edge-test'},body:'service refused'},
    workerStack:'worker failure location',workerErrorName:'Error',workerKind:'sleep',
  })});
  expect(run.report().attempts[0]).toMatchObject({state:'failed',error:{message:'503 /asset.bin',
    workerStack:'worker failure location',workerErrorName:'Error',workerKind:'sleep',
    assetFailure:{path:'/asset.bin',status:503,headers:{server:'edge-test'},body:'service refused'}}});
});

it('keeps only three attempts and ignores damaged or oversized saved reports',()=>{
  let run=boot();for(let i=0;i<5;i++)run=boot(run.values.get(key));
  expect(run.report().attempts).toHaveLength(3);
  expect(boot('{damaged').report().attempts).toHaveLength(1);
  expect(boot(' '.repeat(32769)).report().attempts).toHaveLength(1);
});

it('keeps loading usable when browser storage is denied',()=>{
  const run=boot(undefined,false,true);
  expect(()=>run.phase('Starting graphics')).not.toThrow();
  expect(()=>run.emit('terrilives:startup-failure',{detail:new Error('failed')})).not.toThrow();
});

it('reads reports without starting the game or overwriting its last attempt',()=>{
  const first=boot();first.phase('Loading character models');
  const saved=first.values.get(key)!;
  const view=boot(saved,true);
  expect(view.output.textContent).toContain('Loading character models');
  expect(view.summary.textContent).toMatch(/unfinished/i);
  expect(view.values.get(key)).toBe(saved);
  expect(view.fetch).not.toHaveBeenCalled();
});

it('loads the recorder before the game module and provides a standalone report page',()=>{
  const game=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  expect(game.indexOf('startup-diagnostics-v3.js')).toBeGreaterThan(-1);
  expect(game.indexOf('startup-diagnostics-v3.js')).toBeLessThan(game.indexOf('type="module"'));
  const page=readFileSync(new URL('../startup-report/template.html',import.meta.url),'utf8');
  expect(page).toContain('data-startup-report');
  expect(page).not.toContain('type="module"');
  expect(page).not.toMatch(/<canvas|wasm|main\.ts/);
});
