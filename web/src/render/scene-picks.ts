export interface SceneHit {
  readonly entity:number;
  readonly sim:number|null;
  readonly kind:'person'|'fixture';
  readonly cleanup?:{readonly surface:number;readonly dishes:readonly number[]};
  readonly bookCopy?:number;
}

/** Tokens describe the displayed frame, including props without simulation rows. */
export class ScenePickRegistry {
  private rows=new Uint32Array(0);
  private kinds=new Uint32Array(0);
  private sims=new Uint32Array(0);
  private count=0;
  private next=1;
  private readonly extra=new Map<number,SceneHit>();

  begin(ids:Uint32Array,kinds:Uint32Array,sims?:Uint32Array):void {
    this.count=ids.length;this.next=this.count+1;this.extra.clear();
    if(this.rows.length<this.count){this.rows=new Uint32Array(this.count);this.kinds=new Uint32Array(this.count);this.sims=new Uint32Array(this.count);}
    this.rows.set(ids);this.kinds.set(kinds);this.sims.fill(0xffffffff);
    if(sims)this.sims.set(sims);
  }
  reset():void {this.count=0;this.next=1;this.extra.clear();}
  private register(hit:SceneHit):number {
    if(this.next>0xffffffff)throw new Error('Scene pick identity capacity exceeded.');
    const token=this.next++;this.extra.set(token,hit);return token;
  }
  cleanup(surface:number,dishes:readonly number[]):number {
    return this.register({entity:surface,sim:null,kind:'fixture',cleanup:{surface,dishes}});
  }
  book(copy:number):number {
    return this.register({entity:0xffffffff,sim:null,kind:'fixture',bookCopy:copy});
  }
  /** Copy before awaiting GPU readback; later frames may reuse every row and token. */
  snapshot():ReadonlyMap<number,SceneHit> {
    const snapshot=new Map(this.extra);
    for(let row=0;row<this.count;row++)snapshot.set(row+1,{entity:this.rows[row],
      kind:this.kinds[row]===0?'person':'fixture',sim:this.kinds[row]===0&&this.sims[row]!==0xffffffff?this.sims[row]:null});
    return snapshot;
  }
}
