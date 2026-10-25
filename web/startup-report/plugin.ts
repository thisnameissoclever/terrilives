import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';

const template=fileURLToPath(new URL('./template.html',import.meta.url));
function checkedVersion(version:string):string {
  if(!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version))throw new Error('Invalid startup report game version');
  return version;
}
export function renderStartupReport(version:string):string {
  return readFileSync(template,'utf8').replace('__NATURAL_CAUSES_VERSION__',checkedVersion(version));
}

/** The report and early recorder receive the same package version as the game. */
export function startupReportPlugin(version:string):Plugin {
  checkedVersion(version);
  return {
    name:'natural-causes-startup-report',
    buildStart(){this.addWatchFile(template);},
    transformIndexHtml(){return [{tag:'meta',attrs:{name:'natural-causes-version',content:version},injectTo:'head-prepend' as const}];},
    generateBundle(){this.emitFile({type:'asset',fileName:'startup-report.html',source:renderStartupReport(version)});},
    configureServer(server){
      server.watcher.add(template);
      server.middlewares.use((request,response,next)=>{
        if(new URL(request.url??'/','http://localhost').pathname!=='/startup-report.html'){next();return;}
        try{response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(renderStartupReport(version));}
        catch(error){next(error);}
      });
    },
  };
}
