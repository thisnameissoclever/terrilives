import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {expect,it,vi} from 'vitest';

const key='terrilives.startup-report.v1';
function boot(saved?:string,reportPage=false,denied=false){
  const values=new Map<string,string>(saved?[[key,saved]]:[]),events=new Map<string,((event:unknown)=>void)[]>();
  const step={textContent:'Downloading the game'},output={textContent:''},summary={textContent:''};
  const download={disabled:true,addEventListener:vi.fn()},fetch=vi.fn(()=>{throw Error('Unexpected network request');});
  let observe:(()=>void)|undefined;
  const storage={getItem:(name:string)=>values.get(name)??null,setItem:(name:string,value:string)=>values.set(name,value)};
  const window={navigator:{userAgent:'test-browser',gpu:{}},devicePixelRatio:3,innerWidth:402,innerHeight:874,isSecureContext:true,
    location:{href:'https://game.test/terrilives/?private=query'},
    get localStorage(){if(denied)throw Error('storage denied');return storage;},
    addEventListener:(name:string,callback:(event:unknown)=>void)=>events.set(name,[...(events.get(name)??[]),callback]),
  };
  const document={readyState:'complete',documentElement:{hasAttribute:()=>reportPage},
    getElementById:(id:string)=>({'startup-loading-step':step,'startup-report-data':output,'startup-report-summary':summary,'startup-report-download':download}[id]),
    querySelector:()=>({src:'https://game.test/terrilives/assets/index-build.js'}),
  };
  vm.runInNewContext(readFileSync(new URL('../public/startup-diagnostics.js',import.meta.url),'utf8'),
    {window,document,navigator:window.navigator,URL,Date,JSON,fetch,console,
      MutationObserver:class{constructor(callback:()=>void){observe=callback;}observe(){}disconnect(){}},
    });
  return {values,step,output,summary,download,fetch,emit:(name:string,event:unknown={})=>events.get(name)?.forEach(callback=>callback(event)),
    phase:(text:string)=>{step.textContent=text;observe?.();},report:()=>JSON.parse(values.get(key)!) };
}

it('retains an unfinished attempt across the next load without calling it a crash',()=>{
  const first=boot();first.phase('Loading character models');
  const second=boot(first.values.get(key));
  expect(second.report().attempts).toHaveLength(2);
  expect(second.report().attempts[0]).toMatchObject({state:'loading',phase:'Loading character models',build:'/terrilives/assets/index-build.js'});
  expect(first.values.get(key)).not.toContain('private=query');
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
  })});
  expect(run.report().attempts[0]).toMatchObject({state:'failed',error:{message:'503 /asset.bin',
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
  expect(game.indexOf('startup-diagnostics.js')).toBeGreaterThan(-1);
  expect(game.indexOf('startup-diagnostics.js')).toBeLessThan(game.indexOf('type="module"'));
  const page=readFileSync(new URL('../public/startup-report.html',import.meta.url),'utf8');
  expect(page).toContain('data-startup-report');
  expect(page).not.toContain('type="module"');
  expect(page).not.toMatch(/<canvas|wasm|main\.ts/);
});
