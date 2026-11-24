export interface PoolGraphKey {phase:number;pose:number}
export interface PoolGraphTrack {keys:PoolGraphKey[]}
export interface PoolCanonicalGraph<P> {poses:P[];entry:PoolGraphTrack;paddle:PoolGraphTrack;bridges:PoolGraphTrack[];climbOut?:PoolGraphTrack;takeoffPhase?:number}
export interface PoolGraphSample {left:number;right:number;amount:number;track:PoolGraphTrack;interval:number}

export function poolGraphTracks<T extends PoolGraphTrack>(graph:{entry:T;paddle:T;bridges:T[];climbOut?:T}):T[] {
  return [graph.entry,graph.paddle,...graph.bridges,...(graph.climbOut?[graph.climbOut]:[])];
}

export function validatePoolGraph<P>(graph:PoolCanonicalGraph<P>):void {
  if(!graph||!Array.isArray(graph.poses)||graph.poses.length<2||graph.poses.length>837
      ||!Array.isArray(graph.bridges)||graph.bridges.length!==12)throw new Error('Invalid canonical pool graph.');
  if(!graph.entry||!Array.isArray(graph.entry.keys)||!graph.paddle||!Array.isArray(graph.paddle.keys)||
    graph.climbOut!==undefined&&(!graph.climbOut||!Array.isArray(graph.climbOut.keys)))throw new Error('Invalid canonical pool tracks.');
  if((graph.climbOut===undefined)!==(graph.takeoffPhase===undefined)||
    (graph.takeoffPhase!==undefined&&(graph.takeoffPhase!==.6||
      !graph.entry.keys.some(k=>k.phase===graph.takeoffPhase))))throw new Error('Pool hop requires its actual takeoff and climb-out.');
  let references=0;const used=new Set<number>();
  for(const track of poolGraphTracks(graph)){
    if(!track||!Array.isArray(track.keys)||track.keys.length<2||track.keys.length>837)throw new Error('Invalid pool graph track.');
    references+=track.keys.length;if(references>2048)throw new Error('Pool graph exceeds its reference budget.');
    let previous=-1;
    for(const key of track.keys){
      if(!Number.isFinite(key.phase)||key.phase<0||key.phase>1||key.phase<=previous)throw new Error('Pool graph phases must increase.');
      if(!Number.isInteger(key.pose)||key.pose<0||key.pose>=graph.poses.length)throw new Error('Invalid pool graph pose reference.');
      used.add(key.pose);previous=key.phase;
    }
    if(track.keys[0].phase!==(track===graph.climbOut ? .1 : 0)||track.keys.at(-1)!.phase!==1)throw new Error('Pool graph track needs both endpoints.');
  }
  if(used.size!==graph.poses.length)throw new Error('Pool graph contains unreferenced poses.');
  const common=graph.entry.keys.at(-1)!.pose;
  if(graph.paddle.keys[0].pose!==common)throw new Error('Pool entry and paddle do not share their endpoint.');
  if(graph.paddle.keys.at(-1)!.pose!==common)throw new Error('Pool loop must close on its shared pose.');
  if(graph.climbOut&&(graph.climbOut.keys[0].pose!==common||graph.climbOut.keys.at(-1)!.pose!==graph.entry.keys[0].pose))
    throw new Error('Pool climb-out must go from the settled swim pose to standing.');
  graph.bridges.forEach((bridge,origin)=>{
    const key=graph.paddle.keys.find(key=>key.phase===origin/12);
    if(!key||bridge.keys[0].pose!==key.pose)throw new Error('Pool bridge origin does not match the native paddle phase.');
    if(bridge.keys.at(-1)!.pose!==common)throw new Error('Pool bridge does not return to canonical entry.');
  });
}

export function samplePoolTrack(track:PoolGraphTrack,phase:number):PoolGraphSample {
  let low=0,high=track.keys.length-1;
  while(high-low>1){const middle=(low+high)>>1;if(track.keys[middle].phase<=phase)low=middle;else high=middle;}
  const a=track.keys[low],b=track.keys[high];
  if(phase===a.phase)return {left:a.pose,right:a.pose,amount:0,track,interval:low};
  if(phase===b.phase)return {left:b.pose,right:b.pose,amount:0,track,interval:Math.min(high,track.keys.length-2)};
  return {left:a.pose,right:b.pose,amount:(phase-a.phase)/(b.phase-a.phase),track,interval:low};
}

/** Entry retreat uses the entry track. A released hop finishes before the ordinary exit. */
export function samplePoolGraph<P>(graph:PoolCanonicalGraph<P>,action:'entry'|'paddle'|'exit',phase:number,origin=0,reducedMotion=false):PoolGraphSample {
  if(!Number.isFinite(phase)||phase<0||phase>1)throw new Error('Pool graph phase is outside its interval.');
  if(action==='entry')return samplePoolTrack(graph.entry,phase);
  if(action==='paddle')return samplePoolTrack(graph.paddle,reducedMotion?0:phase);
  if(!Number.isInteger(origin)||origin<0||origin>=12)throw new Error('Pool graph has an invalid native exit origin.');
  if(phase>.1)return graph.climbOut?samplePoolTrack(graph.climbOut,phase):samplePoolTrack(graph.entry,(1-phase)/.9);
  return reducedMotion?samplePoolTrack(graph.paddle,0):samplePoolTrack(graph.bridges[origin],phase/.1);
}

export function poolGraphCounts<P>(graph:PoolCanonicalGraph<P>){
  const tracks=poolGraphTracks(graph),references=tracks.reduce((count,track)=>count+track.keys.length,0);
  return {poses:graph.poses.length,references,intervals:references-tracks.length,
    initialObservations:graph.poses.length+references-tracks.length};
}
