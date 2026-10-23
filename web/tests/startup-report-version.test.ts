import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {renderStartupReport,startupReportPlugin} from '../startup-report/plugin.js';

it('renders the report with the supplied package version and no game module',()=>{
  const html=renderStartupReport('2.3.4');
  expect(html).toContain('name="natural-causes-version" content="2.3.4"');
  expect(html).not.toContain('__NATURAL_CAUSES_VERSION__');
  expect(html).not.toMatch(/type="module"|<canvas|\.wasm/);
});

it('uses the same version for the game metadata and generated report',()=>{
  const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
  const plugin=startupReportPlugin(version),emitted:unknown[]=[];
  (plugin.generateBundle as Function).call({emitFile:(asset:unknown)=>emitted.push(asset)});
  expect(emitted).toEqual([{type:'asset',fileName:'startup-report.html',source:renderStartupReport(version)}]);
  expect((plugin.transformIndexHtml as Function)()).toEqual([
    {tag:'meta',attrs:{name:'natural-causes-version',content:version},injectTo:'head-prepend'},
  ]);
});

it('rejects version text that could inject markup or email headers',()=>{
  expect(()=>renderStartupReport('1.0.0\r\nBcc: x@example.test')).toThrow();
  expect(()=>renderStartupReport('<script>')).toThrow();
});
