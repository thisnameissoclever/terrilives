import {spriteIndex} from './atlas.js';
import {
 FLOATS_PER_INSTANCE,OFFSET_DEPTH,OFFSET_FOOTPRINT_SPAN,OFFSET_PROJECTION_ANCHOR_X,OFFSET_SCREEN_X,OFFSET_SCREEN_Y,
 OFFSET_TINT_B,OFFSET_TINT_G,OFFSET_TINT_R,OFFSET_WALL_DEPTH_STEP,OFFSET_WALL_MASK,VERTICES_PER_QUAD,writeInstance,
 type InstanceArray,
} from './instances.js';
import {DEPTH_LAYER_STEP,FLOOR_DEPTH,TILE_HALF_HEIGHT,TILE_HALF_WIDTH} from './iso.js';
import {type SceneTarget} from './scene-target.js';

/**
 * The packed command of every floor marker row: the ellipse under the
 * selected housemate and the one under an object being placed in Build mode.
 * A marker row keeps its packed position but bypasses bitmap sampling: the
 * sprite pass skips it and `GroundSelectionRenderer` draws it after the
 * opaque scene. The Walls tool's tile highlight is ordinary ring sprites,
 * not markers.
 */
export const GROUND_SELECTION_COMMAND=-14;

/*
 * A marker row reuses fields the sprite pass would read as projection data,
 * which is safe only because no sprite, grime or annotation draw ever sees a
 * marker row:
 *   0, 1   the marker's centre on screen
 *   2      depth, GROUND_MARKER_DEPTH
 *   3      the selection ring sprite, never sampled
 *   4..6   the marker colour, sRGB
 *   7      emissive 1, unused by the marker pass
 *   8      GROUND_SELECTION_COMMAND
 *   9      the border style
 *   10, 11 the marker's semi-axes along world x and world y, in tiles
 */
export const OFFSET_MARKER_BORDER=OFFSET_WALL_DEPTH_STEP;
export const OFFSET_MARKER_SEMI_AXIS_X=OFFSET_FOOTPRINT_SPAN;
export const OFFSET_MARKER_SEMI_AXIS_Y=OFFSET_PROJECTION_ANCHOR_X;

/** A border of constant screen width all the way round, for any marker shape. */
export const MARKER_BORDER_CONSTANT=0;
/**
 * The housemate marker's approved border, which measures distance along the
 * screen ellipse's short axis. That makes it 1.95 pixels at the top and
 * bottom and about 1.5 times as thick at the left and right ends.
 */
export const MARKER_BORDER_SHORT_AXIS=1;

/**
 * The selection ring's atlas slot, resolved by name once at module load.
 * A hardcoded index would silently name whatever sprite later took that
 * slot; `spriteIndex` throws on an unknown name. The marker pass never
 * samples it, but tests and buffer readers recognize marker rows by it.
 */
const MARKER_SPRITE=spriteIndex('selectionRing');
/** Semantic overlay strength: a marker must stay legible at midnight. */
const MARKER_EMISSIVE=1;

/** Every marker lies on the floor-decal plane, in front of the floor and behind every raised surface. */
export const GROUND_MARKER_DEPTH=FLOOR_DEPTH-DEPTH_LAYER_STEP/4;

/**
 * The housemate marker is a world circle of this radius in tiles. Through
 * the isometric projection it is the approved 30 by 19.6875 pixel ellipse at
 * scale 1: 30 = 32 * sqrt(2) * r and 19.6875 = 21 * sqrt(2) * r.
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
 colour:readonly [number,number,number],border:number):void {
 writeInstance(out,slot,x,y,GROUND_MARKER_DEPTH,MARKER_SPRITE,colour[0],colour[1],colour[2],MARKER_EMISSIVE,
  GROUND_SELECTION_COMMAND,border);
 const base=slot*FLOATS_PER_INSTANCE;
 out[base+OFFSET_MARKER_SEMI_AXIS_X]=semiAxisX;
 out[base+OFFSET_MARKER_SEMI_AXIS_Y]=semiAxisY;
}

/** The ellipse under the selected housemate's feet, at screen position (x, y). */
export function writeHousemateMarker(out:Float32Array,slot:number,x:number,y:number):void {
 writeGroundMarker(out,slot,x,y,HOUSEMATE_MARKER_RADIUS,HOUSEMATE_MARKER_RADIUS,MARKER_BLUE,MARKER_BORDER_SHORT_AXIS);
}

/**
 * One ellipse under an object being placed, centred at screen position
 * (x, y) and sized to its `width` by `depth` footprint after facing. A
 * refused placement draws it red.
 */
export function writePlacementMarker(out:Float32Array,slot:number,x:number,y:number,
 width:number,depth:number,valid:boolean):void {
 writeGroundMarker(out,slot,x,y,placementMarkerSemiAxis(width),placementMarkerSemiAxis(depth),
  valid?MARKER_BLUE:MARKER_RED,MARKER_BORDER_CONSTANT);
}

/** The most marker rows one frame can hold. A frame writes at most two: the housemate's and a placement's. */
export const MAX_GROUND_MARKERS=4;

/**
 * Fills `rows` with the marker rows among the first `count`, in order, and
 * returns how many there are. More markers than `rows` holds is a writer
 * bug, and it throws rather than letting a skipped marker reach the sprite
 * pass, which would read its command as wall art.
 */
export function groundMarkerRows(instances:Float32Array,count:number,rows:Int32Array):number {
 let found=0;
 for(let row=0;row<count;row++){
  if(instances[row*FLOATS_PER_INSTANCE+OFFSET_WALL_MASK]!==GROUND_SELECTION_COMMAND)continue;
  if(found===rows.length)throw new Error('The frame holds more floor markers than the marker pass can draw.');
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
 * centre + cos(t) * u + sin(t) * v; when a and b differ it is tilted.
 */
export function markerAxes(semiAxisX:number,semiAxisY:number,scale:number,out:Float32Array|Float64Array,at=0):void {
 out[at]=TILE_HALF_WIDTH*semiAxisX*scale;
 out[at+1]=TILE_HALF_HEIGHT*semiAxisX*scale;
 out[at+2]=-TILE_HALF_WIDTH*semiAxisY*scale;
 out[at+3]=TILE_HALF_HEIGHT*semiAxisY*scale;
}

/** Floats ahead of the markers in the uniform: the canvas size and padding. */
const HEADER_FLOATS=4;
/**
 * Floats per marker in the uniform, matching `struct Marker`: centre (2),
 * bounding half-extent (2), the two rows of the screen-to-unit-circle
 * matrix (4), colour (4), depth, short-axis border scale and padding (4).
 */
export const MARKER_UNIFORM_FLOATS=16;
const axes=new Float64Array(4);

/**
 * Writes marker row `row`'s uniform block into `out` from `at`. The block
 * maps a screen offset from the centre to the unit circle with the inverse
 * of the matrix whose columns are `markerAxes`' u and v, and bounds the
 * ellipse with its screen box. The short-axis border scale is the smallest
 * singular value of that matrix for the housemate's approved border, and 0
 * for a constant-width border.
 */
export function writeMarkerUniform(out:Float32Array|Float64Array,at:number,instances:Float32Array,row:number,scale:number):void {
 const base=row*FLOATS_PER_INSTANCE;
 const semiAxisX=instances[base+OFFSET_MARKER_SEMI_AXIS_X],semiAxisY=instances[base+OFFSET_MARKER_SEMI_AXIS_Y];
 if(!(semiAxisX>0&&semiAxisY>0&&scale>0))throw new Error('A floor marker needs two positive semi-axes and a positive scale.');
 markerAxes(semiAxisX,semiAxisY,scale,axes);
 const ux=axes[0],uy=axes[1],vx=axes[2],vy=axes[3];
 const det=ux*vy-vx*uy;
 out[at]=instances[base+OFFSET_SCREEN_X];
 out[at+1]=instances[base+OFFSET_SCREEN_Y];
 out[at+2]=Math.hypot(ux,vx);
 out[at+3]=Math.hypot(uy,vy);
 out[at+4]=vy/det;
 out[at+5]=-vx/det;
 out[at+6]=-uy/det;
 out[at+7]=ux/det;
 out[at+8]=instances[base+OFFSET_TINT_R];
 out[at+9]=instances[base+OFFSET_TINT_G];
 out[at+10]=instances[base+OFFSET_TINT_B];
 out[at+11]=1;
 out[at+12]=instances[base+OFFSET_DEPTH];
 out[at+13]=instances[base+OFFSET_MARKER_BORDER]===MARKER_BORDER_SHORT_AXIS?shortRadius(ux,uy,vx,vy,det):0;
 out[at+14]=0;
 out[at+15]=0;
}

/** The ellipse's semi-minor axis in pixels: the smaller singular value of the matrix with columns u and v. */
function shortRadius(ux:number,uy:number,vx:number,vy:number,det:number):number {
 const sum=ux*ux+uy*uy+vx*vx+vy*vy;
 return Math.sqrt(2*det*det/(sum+Math.sqrt(Math.max(sum*sum-4*det*det,0))));
}

export const groundSelectionShader=`
struct Marker { centre:vec2f, extent:vec2f, row0:vec2f, row1:vec2f, colour:vec4f, depth:f32, shortRadius:f32, pad:vec2f };
struct Markers { canvas:vec2f, pad:vec2f, items:array<Marker,${MAX_GROUND_MARKERS}> };
@group(0) @binding(0) var<uniform> u:Markers;
struct Vertex { @builtin(position) position:vec4f, @location(0) unit:vec2f, @location(1) @interpolate(flat) marker:u32 };
@vertex fn vs(@builtin(vertex_index) i:u32,@builtin(instance_index) marker:u32)->Vertex {
 let q=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1))[i];
 let m=u.items[marker];
 // The ellipse's screen box, four pixels wider on every side for the border.
 let offset=q*(m.extent+vec2f(4));
 var o:Vertex; let p=m.centre+offset;
 o.position=vec4f(p/u.canvas*vec2f(2,-2)+vec2f(-1,1),m.depth,1);
 // The ellipse is the unit circle in this space; the map is linear, so interpolation keeps it exact.
 o.unit=vec2f(dot(m.row0,offset),dot(m.row1,offset));o.marker=marker;return o;
}
fn linear(c:vec3f)->vec3f {
 return select(pow((c+.055)/1.055,vec3f(2.4)),c/12.92,c<=vec3f(.04045));
}
@fragment fn fs(i:Vertex)->@location(0) vec4f {
 let m=u.items[i.marker];
 let r=length(i.unit);
 let f=r-1.;
 // The length of f's screen gradient; f divided by it approximates the
 // distance to the edge in pixels, so the border keeps one width on
 // stretched and tilted ellipses.
 let n=i.unit/max(r,1e-6);
 let slope=length(n.x*m.row0+n.y*m.row1);
 // The housemate marker keeps its approved border, measured along the short axis.
 let dist=select(f/max(slope,1e-6),f*m.shortRadius,m.shortRadius>0.);
 let aa=max(fwidth(dist),.42);
 // The approved 1.3-pixel border is now 1.5 times as thick: 1.95 pixels.
 let edge=1.-smoothstep(.975-aa,.975+aa,abs(dist));
 let fill=(1.-smoothstep(-aa,aa,dist))*.105;
 let opacity=edge*.94+(1.-edge)*fill;
 if(opacity<.001){discard;}
 return vec4f(linear(m.colour.rgb)*opacity,opacity);
}`;

/**
 * Translucent floor markers never replace world identity or physical depth.
 * Every marker in a frame is one instance of one draw, from a uniform sized
 * once for MAX_GROUND_MARKERS, so a steady frame allocates nothing here.
 */
export class GroundSelectionRenderer {
 private readonly pipeline:GPURenderPipeline;
 private readonly uniform:GPUBuffer;
 private readonly group:GPUBindGroup;
 private readonly values=new Float32Array(HEADER_FLOATS+MAX_GROUND_MARKERS*MARKER_UNIFORM_FLOATS);
 constructor(private readonly device:GPUDevice){
  const module=device.createShaderModule({label:'Floor marker ellipses',code:groundSelectionShader});
  this.pipeline=device.createRenderPipeline({label:'Floor marker ellipses',layout:'auto',vertex:{module,entryPoint:'vs'},
   fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float',blend:{
    color:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},
   primitive:{topology:'triangle-list'},
   depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less'}});
  this.uniform=device.createBuffer({size:this.values.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  this.group=device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});
 }
 /** Draws the first `markerCount` marker rows named in `rows`, as found by `groundMarkerRows`. */
 draw(encoder:GPUCommandEncoder,target:SceneTarget,instances:InstanceArray,rows:Int32Array,markerCount:number,scale:number):void {
  if(markerCount<=0)return;
  const v=this.values;
  v[0]=target.logicalWidth;v[1]=target.logicalHeight;
  for(let i=0;i<markerCount;i++)writeMarkerUniform(v,HEADER_FLOATS+i*MARKER_UNIFORM_FLOATS,instances,rows[i],scale);
  this.device.queue.writeBuffer(this.uniform,0,v,0,HEADER_FLOATS+markerCount*MARKER_UNIFORM_FLOATS);
  const pass=encoder.beginRenderPass({colorAttachments:[{view:target.color.createView(),loadOp:'load',storeOp:'store'}],
   depthStencilAttachment:{view:target.depth.createView(),depthLoadOp:'load',depthStoreOp:'store'}});
  pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.group);pass.draw(VERTICES_PER_QUAD,markerCount);pass.end();
 }
 destroy():void {this.uniform.destroy();}
}
