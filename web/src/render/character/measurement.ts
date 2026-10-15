export interface CharacterFrameReport {
  timingVersion:2;samples:number;elapsedMs:number;
  cpuMs:number[];completionMs:number[];intervalMs:number[];
  callbackDelayMs:number[];frameLatencyMs:number[];latencyMs:number[];
  timestamps:{animation:number[];entered:number[];cpuEnd:number[];completed:number[]};
}

/** Diagnostic-only sampling includes completion of the frame's submitted graphics work. */
export class CharacterFrameMeasurement {
  private run:{start:number;duration:number;count:number;pending:number;accepting:boolean;previous:number;cpu:Float64Array;complete:Float64Array;interval:Float64Array;
    animation:Float64Array;entered:Float64Array;cpuEnd:Float64Array;completed:Float64Array;
    resolve:(report:CharacterFrameReport)=>void;reject:(error:unknown)=>void}|null=null;
  constructor(private readonly queue:()=>GPUQueue){}
  start(durationMs:number):Promise<CharacterFrameReport>{
    if(this.run||!Number.isFinite(durationMs)||durationMs<1000||durationMs>120000)throw new Error('Invalid or overlapping character measurement.');
    return new Promise((resolve,reject)=>{this.run={start:performance.now(),duration:durationMs,count:0,pending:0,accepting:true,previous:0,
      cpu:new Float64Array(30000),complete:new Float64Array(30000),interval:new Float64Array(30000),
      animation:new Float64Array(30000),entered:new Float64Array(30000),cpuEnd:new Float64Array(30000),completed:new Float64Array(30000),resolve,reject};});
  }
  frame(animationTime:number,entered:number,cpuEnd:number):void {
    const run=this.run;if(!run?.accepting)return;
    const index=run.count++;if(index>=run.cpu.length){this.run=null;run.reject(new Error('Character measurement exceeded its sample capacity.'));return;}
    run.animation[index]=animationTime;run.entered[index]=entered;run.cpuEnd[index]=cpuEnd;
    run.cpu[index]=cpuEnd-entered;run.interval[index]=run.previous?animationTime-run.previous:0;run.previous=animationTime;run.pending++;
    if(cpuEnd-run.start>=run.duration)run.accepting=false;
    void this.queue().onSubmittedWorkDone().then(()=>{
      const completed=performance.now();run.completed[index]=completed;run.complete[index]=completed-entered;run.pending--;
      if(!run.accepting&&!run.pending&&this.run===run){
        this.run=null;const values=(array:Float64Array)=>Array.from(array.subarray(0,run.count));
        const animation=values(run.animation),entries=values(run.entered),ends=values(run.cpuEnd),completions=values(run.completed);
        run.resolve({timingVersion:2,samples:run.count,elapsedMs:performance.now()-run.start,
          cpuMs:values(run.cpu),completionMs:values(run.complete),intervalMs:Array.from(run.interval.subarray(1,run.count)),
          callbackDelayMs:entries.map((value,i)=>value-animation[i]),frameLatencyMs:ends.map((value,i)=>value-animation[i]),
          latencyMs:completions.map((value,i)=>value-animation[i]),timestamps:{animation,entered:entries,cpuEnd:ends,completed:completions}});
      }
    },error=>{if(this.run===run){this.run=null;run.reject(error);}});
  }
}
