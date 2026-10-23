import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {expect,it,vi} from 'vitest';

const key='terrilives.startup-report.v1';
function boot(saved?:string,reportPage=false,denied=false,clipboardFails=false){
  const values=new Map<string,string>(saved?[[key,saved]]:[]),events=new Map<string,((event:unknown)=>void)[]>();
  const step={textContent:'Downloading the game'},output={textContent:''},summary={textContent:''};
  const download={disabled:true,addEventListener:vi.fn()},fetch=vi.fn(()=>{throw Error('Unexpected network request');});
  const clicks=new Map<string,()=>Promise<void>|void>();
  const copy={disabled:false,addEventListener:(event:string,callback:()=>Promise<void>)=>clicks.set(event,callback),dataset:{}};
  const email={href:'',setAttribute:vi.fn()},shareStatus={textContent:''};
  const manual={hidden:true,value:'',focus:vi.fn(),select:vi.fn()};
  const writeText=vi.fn(async(_value:string)=>{if(clipboardFails)throw Error('Clipboard denied');});
  let observe:(()=>void)|undefined;
  const storage={getItem:(name:string)=>values.get(name)??null,setItem:(name:string,value:string)=>values.set(name,value)};
  const window={navigator:{userAgent:'test-browser',gpu:{},clipboard:{writeText}},devicePixelRatio:3,innerWidth:402,innerHeight:874,isSecureContext:true,
    location:{href:'https://game.test/terrilives/?private=query'},
    get localStorage(){if(denied)throw Error('storage denied');return storage;},
    addEventListener:(name:string,callback:(event:unknown)=>void)=>events.set(name,[...(events.get(name)??[]),callback]),
  };
  const document={readyState:'complete',documentElement:{hasAttribute:()=>reportPage},
    getElementById:(id:string)=>({'startup-loading-step':step,'startup-report-data':output,'startup-report-summary':summary,'startup-report-download':download,
      'startup-report-copy':copy,'startup-report-email':email,'startup-report-share-status':shareStatus,'startup-report-manual':manual}[id]),
    querySelector:(selector:string)=>selector.startsWith('meta')?{content:'1.0.0'}:{src:'https://game.test/terrilives/assets/index-build.js'},
  };
  vm.runInNewContext(readFileSync(new URL('../public/startup-diagnostics-v2.js',import.meta.url),'utf8'),
    {window,document,navigator:window.navigator,URL,Date,JSON,fetch,console,
      MutationObserver:class{constructor(callback:()=>void){observe=callback;}observe(){}disconnect(){}},
    });
  return {values,step,output,summary,download,fetch,email,manual,shareStatus,writeText,clickCopy:()=>clicks.get('click')?.(),emit:(name:string,event:unknown={})=>events.get(name)?.forEach(callback=>callback(event)),
    phase:(text:string)=>{step.textContent=text;observe?.();},report:()=>JSON.parse(values.get(key)!) };
}

it('retains an unfinished attempt across the next load without calling it a crash',()=>{
  const first=boot();first.phase('Loading character models');
  const second=boot(first.values.get(key));
  expect(second.report().attempts).toHaveLength(2);
  expect(second.report().attempts[0]).toMatchObject({state:'loading',phase:'Loading character models',build:'/terrilives/assets/index-build.js',gameVersion:'1.0.0'});
  expect(first.values.get(key)).not.toContain('private=query');
});

it('copies the full report and puts the same details into a correctly encoded email draft',async()=>{
  const first=boot();first.emit('terrilives:startup-failure',{detail:new Error('503 & # ? % café')});
  const view=boot(first.values.get(key),true);await view.clickCopy();
  const copied=view.writeText.mock.calls[0]?.[0];expect(copied).toBeTruthy();
  const parsed=JSON.parse(copied!);expect(parsed.attempts).toEqual(first.report().attempts);
  expect(view.shareStatus.textContent).toMatch(/Copied/);
  const mail=new URL(view.email.href);
  expect(mail.protocol).toBe('mailto:');expect(mail.pathname).toBe('bugreport@stfuai.com');
  expect(mail.searchParams.get('subject')).toBe('[Bug report] Natural Causes v1.0.0');
  expect(mail.searchParams.get('body')).toBe(copied!.replace(/\r?\n/g,'\r\n'));
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
  const view=boot(saved,true),body=JSON.parse(new URL(view.email.href).searchParams.get('body')!);
  expect(body.reportContext).toMatchObject({gameVersion:'1.0.0',versionSource:'report page'});
  expect(body.attempts[0].gameVersion).toBeUndefined();
});

it('does not truncate large reports in the email body',()=>{
  const saved=JSON.stringify({version:1,attempts:[{state:'failed',error:{message:'Z'.repeat(25000)}}]});
  const view=boot(saved,true),body=JSON.parse(new URL(view.email.href).searchParams.get('body')!);
  expect(body.attempts[0].error.message).toHaveLength(25000);
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
  expect(game.indexOf('startup-diagnostics-v2.js')).toBeGreaterThan(-1);
  expect(game.indexOf('startup-diagnostics-v2.js')).toBeLessThan(game.indexOf('type="module"'));
  const page=readFileSync(new URL('../startup-report/template.html',import.meta.url),'utf8');
  expect(page).toContain('data-startup-report');
  expect(page).not.toContain('type="module"');
  expect(page).not.toMatch(/<canvas|wasm|main\.ts/);
});
