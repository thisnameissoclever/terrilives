/** Wall-clock preview time excludes hidden, paused and unopened intervals. */
export class CreatorClock {
  private previous:number|null=null;
  private elapsed=0;
  private active=false;
  private paused=false;
  setActive(active:boolean):void {if(this.active!==active){this.active=active;this.previous=null;}}
  setPaused(paused:boolean):void {if(this.paused!==paused){this.paused=paused;this.previous=null;}}
  reset():void {this.previous=null;this.elapsed=0;}
  tick(now:number,frames:number,durationSeconds:number):number {
    if(this.active&&!this.paused){if(this.previous!==null)this.elapsed+=Math.max(0,now-this.previous);this.previous=now;}
    return frames>1&&durationSeconds>0?(this.elapsed/1000%durationSeconds)/durationSeconds*frames:0;
  }
}
