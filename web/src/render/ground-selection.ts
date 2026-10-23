import {spriteIndex} from './atlas.js';
import {
 FLOATS_PER_INSTANCE,OFFSET_DEPTH,OFFSET_FOOTPRINT_SPAN,OFFSET_PROJECTION_ANCHOR_X,OFFSET_SCREEN_X,OFFSET_SCREEN_Y,
 OFFSET_TINT_B,OFFSET_TINT_G,OFFSET_TINT_R,OFFSET_WALL_DEPTH_STEP,OFFSET_WALL_MASK,VERTICES_PER_QUAD,writeInstance,
 type InstanceArray,
} from './instances.js';
import {DEPTH_LAYER_STEP,FLOOR_DEPTH,TILE_HALF_HEIGHT,TILE_HALF_WIDTH} from './iso.js';
import {SCENE_COLOR_FORMAT} from './scene-sampling.js';
import {type SceneTarget} from './scene-target.js';

/**
 * The packed command of every floor marker row: the ellipse under the
 * selected housemate and the one under an object being placed in Build mode.
 * A marker row keeps its packed position but bypasses bitmap sampling: the
 * sprite draws skip it and `GroundSelectionRenderer` draws it later in the
 * scene pass. The tile highlight that the Walls, Room, Floors, Land and
 * Window tools show is ordinary ring sprites, not markers.
 *
 * The value lies below every projection mode the sprite shader knows,
 * including the lowest architecture mode, architectureMode(true,
 * MAX_ARCHITECTURE_FINISH_SLOT), and 2^23 is exact in a 32-bit float.
 */
export const GROUND_MARKER_COMMAND=-(2**23);

/*
 * A marker row reuses fields the sprite shader would read as projection
 * data, which is safe only because no sprite, grime or annotation draw ever
 * sees a marker row:
 *   0, 1   the marker's center on screen
 *   2      depth, GROUND_MARKER_DEPTH
 *   3      the selection ring sprite, never sampled
 *   4..6   the marker color, sRGB
 *   7      emissive 1, unused by the marker draw
 *   8      GROUND_MARKER_COMMAND
 *   10, 11 the marker's semi-axes along world x and world y, in tiles
 */
export const OFFSET_MARKER_SEMI_AXIS_X=OFFSET_FOOTPRINT_SPAN;
export const OFFSET_MARKER_SEMI_AXIS_Y=OFFSET_PROJECTION_ANCHOR_X;
/** Field 9 of a marker row: its shape, one of the MARKER_* kinds. */
export const OFFSET_MARKER_KIND=OFFSET_WALL_DEPTH_STEP;
/** An ellipse under a housemate or a placed object. */
export const MARKER_ELLIPSE=0;
/** A rounded bar along a chosen wall line or run ([WB-mark]). */
export const MARKER_SEGMENT=1;
/** The fainter bar along the line a click would choose. */
export const MARKER_SEGMENT_HOVER=2;
/** A segment bar's half-width across its line, in tiles. */
export const SEGMENT_MARKER_RADIUS=.09;
/** How far a segment bar runs past each end of its lines, in tiles. */
export const SEGMENT_MARKER_OVERHANG=.04;

/**
 * The selection ring's atlas slot, resolved by name once at module load.
 * A hardcoded index would silently name whatever sprite later took that
 * slot; `spriteIndex` throws on an unknown name. The marker draw never
 * samples it, but tests and buffer readers recognize marker rows by it.
 */
const MARKER_SPRITE=spriteIndex('selectionRing');
/** Semantic overlay strength: a marker must stay legible at midnight. */
const MARKER_EMISSIVE=1;

/** Every marker lies on the floor-decal plane, in front of the floor and behind every raised surface. */
export const GROUND_MARKER_DEPTH=FLOOR_DEPTH-DEPTH_LAYER_STEP/4;

/**
 * The housemate marker is a world circle of this radius in tiles. Through
 * the isometric projection it is the 30 by 19.6875 pixel ellipse the game
 * already shipped at scale 1: 30 = 32 * sqrt(2) * r and
 * 19.6875 = 21 * sqrt(2) * r.
 */
export const HOUSEMATE_MARKER_RADIUS=30/(TILE_HALF_WIDTH*Math.SQRT2);

/** Floor left between a placed object's footprint corners and its marker, in tiles along each world axis. */
export const PLACEMENT_MARKER_MARGIN=0.08;

/**
 * The world semi-axis of a placement marker along a footprint side `span`
 * tiles long. Without the margin, an ellipse with semi-axes w / sqrt(2) and
 * d / sqrt(2) passes exactly through the four corners of a w by d footprint,
 * so the whole object stands inside its marker.
 */
export function placementMarkerSemiAxis(span:number,margin=PLACEMENT_MARKER_MARGIN):number {
 return span/Math.SQRT2+margin;
}

/** The housemate marker's blue, also used for a placement the game accepts. sRGB. */
export const MARKER_BLUE=[.29,.77,.98] as const;
/**
 * A refused placement: the blue's saturation and brightness at the hue of
 * the refused ghost tint (229, 140, 133), a clear coral red. sRGB.
 */
export const MARKER_RED=[.98,.34,.29] as const;

/** Writes one marker row. Every marker writer goes through here, so the row layout has one owner. */
function writeGroundMarker(out:Float32Array,slot:number,x:number,y:number,semiAxisX:number,semiAxisY:number,
 color:readonly [number,number,number],kind=MARKER_ELLIPSE):void {
 writeInstance(out,slot,x,y,GROUND_MARKER_DEPTH,MARKER_SPRITE,color[0],color[1],color[2],MARKER_EMISSIVE,
  GROUND_MARKER_COMMAND);
 const base=slot*FLOATS_PER_INSTANCE;
 out[base+OFFSET_MARKER_SEMI_AXIS_X]=semiAxisX;
 out[base+OFFSET_MARKER_SEMI_AXIS_Y]=semiAxisY;
 out[base+OFFSET_MARKER_KIND]=kind;
}

/**
 * One rounded bar on the floor along `length` wall lines that start at a
 * line on `axis`, centred at screen position (x, y): blue where a wall may
 * stand, coral where it may not, fainter for the line under the pointer.
 */
export function writeSegmentMarker(out:Float32Array,slot:number,x:number,y:number,axis:0|1,length:number,
 valid:boolean,hover=false):void {
 const along=length/2+SEGMENT_MARKER_OVERHANG;
 writeGroundMarker(out,slot,x,y,axis===1?along:SEGMENT_MARKER_RADIUS,axis===1?SEGMENT_MARKER_RADIUS:along,
  valid?MARKER_BLUE:MARKER_RED,hover?MARKER_SEGMENT_HOVER:MARKER_SEGMENT);
}

/** The ellipse under the selected housemate's feet, at screen position (x, y). */
export function writeHousemateMarker(out:Float32Array,slot:number,x:number,y:number):void {
 writeGroundMarker(out,slot,x,y,HOUSEMATE_MARKER_RADIUS,HOUSEMATE_MARKER_RADIUS,MARKER_BLUE);
}

/**
 * One ellipse under an object being placed, centered at screen position
 * (x, y) and sized to its `width` by `depth` footprint after facing. A
 * refused placement draws it red.
 */
export function writePlacementMarker(out:Float32Array,slot:number,x:number,y:number,
 width:number,depth:number,valid:boolean):void {
 writeGroundMarker(out,slot,x,y,placementMarkerSemiAxis(width),placementMarkerSemiAxis(depth),
  valid?MARKER_BLUE:MARKER_RED);
}

/**
 * The most marker rows one frame can hold: the housemate's, a placement's,
 * and the bars of a wall selection, one per stretch of like validity, and
 * the line under the pointer.
 */
export const MAX_GROUND_MARKERS=64;

/**
 * Fills `rows` with the marker rows among the first `count`, in order, and
 * returns how many there are. More markers than `rows` holds is a writer
 * bug, and it throws rather than letting a skipped marker reach the sprite
 * draws.
 */
export function groundMarkerRows(instances:Float32Array,count:number,rows:Int32Array):number {
 let found=0;
 for(let row=0;row<count;row++){
  if(instances[row*FLOATS_PER_INSTANCE+OFFSET_WALL_MASK]!==GROUND_MARKER_COMMAND)continue;
  if(found===rows.length)throw new Error('The frame holds more floor markers than the marker draw can hold.');
  rows[found++]=row;
 }
 return found;
}

/**
 * Draws instance slots `start` to `start + count - 1` as sprites, leaving
 * out the first `slotCount` entries of `slots`, which must be ascending.
 */
export function drawAroundMarkers(pass:Pick<GPURenderPassEncoder,'draw'>,start:number,count:number,
 slots:Int32Array,slotCount:number):void {
 const end=start+count;
 let from=start;
 for(let i=0;i<slotCount;i++){
  const slot=slots[i];
  if(slot<from||slot>=end)continue;
  if(slot>from)pass.draw(VERTICES_PER_QUAD,slot-from,0,from);
  from=slot+1;
 }
 if(from<end)pass.draw(VERTICES_PER_QUAD,end-from,0,from);
}

/**
 * The screen images of a marker's world semi-axes, written to `out` from
 * `at` as u.x, u.y, v.x, v.y. With screen x = (wx - wy) * 32 * scale and
 * screen y = (wx + wy) * 21 * scale, world x maps to u = a * scale * (32, 21)
 * and world y to v = b * scale * (-32, 21). The marker is every point
 * center + cos(t) * u + sin(t) * v; when a and b differ it is tilted.
 */
export function markerAxes(semiAxisX:number,semiAxisY:number,scale:number,out:Float32Array|Float64Array,at=0):void {
 out[at]=TILE_HALF_WIDTH*semiAxisX*scale;
 out[at+1]=TILE_HALF_HEIGHT*semiAxisX*scale;
 out[at+2]=-TILE_HALF_WIDTH*semiAxisY*scale;
 out[at+3]=TILE_HALF_HEIGHT*semiAxisY*scale;
}

/** Floats ahead of the markers in the uniform, matching `struct Markers`: the canvas size and padding. */
export const MARKER_UNIFORM_HEADER_FLOATS=4;
/** Floats per marker in the uniform, `struct Marker` padded to its 16-byte alignment. */
export const MARKER_UNIFORM_FLOATS=16;
/**
 * Where each `struct Marker` member starts within a marker's block, in
 * floats: center (2), the screen box's half-extent (2), the two rows of the
 * matrix that maps screen offsets into the ellipse's unit-circle space
 * (2 each), color (4), depth (1), kind (1) and the screen lengths of the two
 * semi-axes (2), which a segment bar measures its distances in.
 */
export const MARKER_UNIFORM_LAYOUT={center:0,extent:2,row0:4,row1:6,color:8,depth:12,kind:13,semi:14} as const;
const axes=new Float64Array(4);

/**
 * Writes marker row `row`'s uniform block into `out` from `at`. The block
 * maps a screen offset from the center into the space where the ellipse is
 * the unit circle, with the inverse of the matrix whose columns are
 * `markerAxes`' u and v; points outside the ellipse, such as the quad's
 * corners, land outside that circle. It also bounds the ellipse with its
 * screen box and carries the row's color and depth.
 */
export function writeMarkerUniform(out:Float32Array|Float64Array,at:number,instances:Float32Array,row:number,scale:number):void {
 const base=row*FLOATS_PER_INSTANCE,L=MARKER_UNIFORM_LAYOUT;
 const semiAxisX=instances[base+OFFSET_MARKER_SEMI_AXIS_X],semiAxisY=instances[base+OFFSET_MARKER_SEMI_AXIS_Y];
 if(!(semiAxisX>0&&semiAxisY>0&&scale>0))throw new Error('A floor marker needs two positive semi-axes and a positive scale.');
 markerAxes(semiAxisX,semiAxisY,scale,axes);
 const ux=axes[0],uy=axes[1],vx=axes[2],vy=axes[3];
 const det=ux*vy-vx*uy;
 const kind=instances[base+OFFSET_MARKER_KIND];
 out.fill(0,at,at+MARKER_UNIFORM_FLOATS);
 out[at+L.center]=instances[base+OFFSET_SCREEN_X];
 out[at+L.center+1]=instances[base+OFFSET_SCREEN_Y];
 // An ellipse's screen box; a bar's square ends reach the box of its corners.
 out[at+L.extent]=kind===MARKER_ELLIPSE?Math.hypot(ux,vx):Math.abs(ux)+Math.abs(vx);
 out[at+L.extent+1]=kind===MARKER_ELLIPSE?Math.hypot(uy,vy):Math.abs(uy)+Math.abs(vy);
 out[at+L.kind]=kind;
 out[at+L.semi]=Math.hypot(ux,uy);
 out[at+L.semi+1]=Math.hypot(vx,vy);
 out[at+L.row0]=vy/det;
 out[at+L.row0+1]=-vx/det;
 out[at+L.row1]=-uy/det;
 out[at+L.row1+1]=ux/det;
 out[at+L.color]=instances[base+OFFSET_TINT_R];
 out[at+L.color+1]=instances[base+OFFSET_TINT_G];
 out[at+L.color+2]=instances[base+OFFSET_TINT_B];
 out[at+L.color+3]=1;
 out[at+L.depth]=instances[base+OFFSET_DEPTH];
}

/**
 * The marker's look, shared by the shader below and by the tests' CPU replay
 * of its fragment math. Distances are canvas pixels.
 */
export const MARKER_LOOK={
 /** Half the border: the approved 1.3-pixel border made 1.5 times as thick is 1.95 pixels. */
 borderHalfWidth:.975,
 borderOpacity:.94,
 fillOpacity:.105,
 /** The least edge softening, in pixels. */
 minSoftening:.42,
 /** A fragment fainter than this is discarded. */
 discardOpacity:.001,
 /** Pixels added to every side of the ellipse's screen box, so the border and its softening fit inside. */
 boxMargin:4,
 /** Below this unit-circle radius the gradient's direction falls back to world x. */
 centerRadius:1e-4,
 /** The least gradient length the distance divides by. */
 minSlope:1e-6,
 /** A chosen wall line's bar: a firm body with the same border as the ellipse. */
 segmentFillOpacity:.62,
 /** The bar under the pointer before a click: an outline with a faint body. */
 hoverFillOpacity:.16,
 hoverBorderOpacity:.7,
} as const;

/** A number as a WGSL floating-point literal: 4 becomes 4.0, and 0.975 stays 0.975. */
export function wgslFloat(value:number):string {
 const text=String(value);
 return /[.e]/.test(text)?text:`${text}.0`;
}

const look=MARKER_LOOK,float=wgslFloat;

export const groundSelectionShader=`
struct Marker { center:vec2f, extent:vec2f, row0:vec2f, row1:vec2f, color:vec4f, depth:f32, kind:f32, semi:vec2f };
struct Markers { canvas:vec2f, pad:vec2f, items:array<Marker,${MAX_GROUND_MARKERS}> };
@group(0) @binding(0) var<uniform> u:Markers;
struct Vertex { @builtin(position) position:vec4f, @location(0) unit:vec2f, @location(1) @interpolate(flat) marker:u32 };
@vertex fn vs(@builtin(vertex_index) i:u32,@builtin(instance_index) marker:u32)->Vertex {
 let q=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1))[i];
 let m=u.items[marker];
 // The ellipse's screen box, widened on every side for the border.
 let offset=q*(m.extent+vec2f(${float(look.boxMargin)}));
 var o:Vertex; let p=m.center+offset;
 o.position=vec4f(p/u.canvas*vec2f(2,-2)+vec2f(-1,1),m.depth,1);
 // The ellipse is the unit circle in this space; the map is linear, so interpolation keeps it exact.
 o.unit=vec2f(dot(m.row0,offset),dot(m.row1,offset));o.marker=marker;return o;
}
fn linear(c:vec3f)->vec3f {
 return select(pow((c+.055)/1.055,vec3f(2.4)),c/12.92,c<=vec3f(.04045));
}
fn segment(i:Vertex,m:Marker)->f32 {
 // The bar is a rounded box in world space; scaling the unit space by each
 // semi-axis's screen length measures it in pixels along both world axes.
 let p=abs(i.unit)*m.semi;
 let radius=min(m.semi.x,m.semi.y);
 let q=p-m.semi+vec2f(radius);
 let dist=length(max(q,vec2f(0)))+min(max(q.x,q.y),0.)-radius;
 let aa=max(fwidth(dist),${float(look.minSoftening)});
 let edge=1.-smoothstep(${float(look.borderHalfWidth)}-aa,${float(look.borderHalfWidth)}+aa,abs(dist));
 let inside=1.-smoothstep(-aa,aa,dist);
 let hover=m.kind>1.5;
 let border=select(${float(look.borderOpacity)},${float(look.hoverBorderOpacity)},hover);
 let fill=select(${float(look.segmentFillOpacity)},${float(look.hoverFillOpacity)},hover);
 return edge*border+(1.-edge)*inside*fill;
}
@fragment fn fs(i:Vertex)->@location(0) vec4f {
 let m=u.items[i.marker];
 // Both shapes are evaluated: derivatives must stay in uniform control flow.
 let bar=segment(i,m);
 let r=length(i.unit);
 let f=r-1.;
 // slope is the length of f's screen gradient, so f / slope approximates the
 // distance to the edge in pixels and the border keeps one width on
 // stretched and tilted ellipses. At the exact center every direction gives
 // the same f, so any direction serves.
 let n=select(vec2f(1,0),i.unit/r,r>${float(look.centerRadius)});
 let slope=max(length(n.x*m.row0+n.y*m.row1),${float(look.minSlope)});
 let dist=f/slope;
 // The softening comes from f, which has a bounded gradient even at the
 // center, where dist jumps between directions.
 let aa=max(fwidth(f)/slope,${float(look.minSoftening)});
 let edge=1.-smoothstep(${float(look.borderHalfWidth)}-aa,${float(look.borderHalfWidth)}+aa,abs(dist));
 let fill=(1.-smoothstep(-aa,aa,dist))*${float(look.fillOpacity)};
 let opacity=select(edge*${float(look.borderOpacity)}+(1.-edge)*fill,bar,m.kind>.5);
 if(opacity<${float(look.discardOpacity)}){discard;}
 return vec4f(linear(m.color.rgb)*opacity,opacity);
}`;

/**
 * The marker pipeline joins the scene pass: it blends into scene color and
 * leaves the surface and identity targets untouched, as the short-wall
 * pipeline does. It tests opaque depth without writing it.
 */
export function groundMarkerPipelineDescriptor(module:GPUShaderModule):GPURenderPipelineDescriptor {
 return {label:'Floor marker ellipses',layout:'auto',vertex:{module,entryPoint:'vs'},
  fragment:{module,entryPoint:'fs',targets:[
   {format:SCENE_COLOR_FORMAT,blend:{
    color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}},
   {format:'r32float',writeMask:0},{format:'r32uint',writeMask:0}]},
  primitive:{topology:'triangle-list'},
  depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}};
}

/**
 * Translucent floor markers never replace world identity or physical depth.
 * Every marker in a frame is one instance of one draw inside the scene pass.
 * The uniform and its staging array are allocated once for
 * MAX_GROUND_MARKERS, so the markers add no pass, texture view or buffer to
 * a frame.
 */
export class GroundSelectionRenderer {
 private readonly pipeline:GPURenderPipeline;
 private readonly uniform:GPUBuffer;
 private readonly group:GPUBindGroup;
 private readonly values=new Float32Array(MARKER_UNIFORM_HEADER_FLOATS+MAX_GROUND_MARKERS*MARKER_UNIFORM_FLOATS);
 constructor(private readonly device:GPUDevice){
  const module=device.createShaderModule({label:'Floor marker ellipses',code:groundSelectionShader});
  this.pipeline=device.createRenderPipeline(groundMarkerPipelineDescriptor(module));
  this.uniform=device.createBuffer({size:this.values.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  this.group=device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});
 }
 /**
  * Records the first `markerCount` marker rows named in `rows`, as found by
  * `groundMarkerRows`, into the open scene pass. It changes the pass's
  * pipeline and bind group 0; the caller restores its own before drawing
  * again.
  */
 draw(pass:GPURenderPassEncoder,target:SceneTarget,instances:InstanceArray,rows:Int32Array,markerCount:number,scale:number):void {
  if(markerCount<=0)return;
  const v=this.values;
  v[0]=target.logicalWidth;v[1]=target.logicalHeight;
  for(let i=0;i<markerCount;i++)
   writeMarkerUniform(v,MARKER_UNIFORM_HEADER_FLOATS+i*MARKER_UNIFORM_FLOATS,instances,rows[i],scale);
  this.device.queue.writeBuffer(this.uniform,0,v,0,MARKER_UNIFORM_HEADER_FLOATS+markerCount*MARKER_UNIFORM_FLOATS);
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.group);pass.draw(VERTICES_PER_QUAD,markerCount);
 }
 destroy():void {this.uniform.destroy();}
}
