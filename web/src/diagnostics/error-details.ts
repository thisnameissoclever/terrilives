type Primitive=string|number|boolean|null;
export type ErrorDetails=
  |{kind:'error';name?:string;message?:string;stack?:string;cause?:ErrorDetails;unavailableFields?:string[];truncated?:true}
  |{kind:'value';value:Primitive;truncated?:true}|{kind:'undefined'}
  |{kind:'object';entries:[string,ErrorDetails][];truncated?:true}
  |{kind:'array';items:ErrorDetails[];truncated?:true}
  |{kind:'limit';reason:'cycle'|'depth'|'unsupported'|'accessor'};
const MESSAGE=16384,STACK=65536,DEPTH=6,NODES=64,ENTRIES=16;
const clipped=(value:string,size:number)=>value.slice(0,size);
function dataField(value:object,key:PropertyKey):{found:boolean;value?:unknown;unavailable?:true}{
  try{for(let current:object|null=value,depth=0;current&&depth<8;current=Object.getPrototypeOf(current),depth++){
    const descriptor=Object.getOwnPropertyDescriptor(current,key);if(descriptor)return 'value' in descriptor?{found:true,value:descriptor.value}:{found:true,unavailable:true};
  }}catch{return {found:true,unavailable:true};}return {found:false};
}

// Capture actual engine operations once; no function spelling or application getter is trusted.
const EngineError=Error,engineStackGetter=Object.getOwnPropertyDescriptor(new EngineError(),'stack')?.get;
const initialFormatter=dataField(EngineError,'prepareStackTrace'),engineToString=dataField(EngineError.prototype,'toString').value;
function nativeStack(value:Error,fields:{name?:string;message?:string}):string|undefined {
  const descriptor=Object.getOwnPropertyDescriptor(value,'stack'),formatter=dataField(EngineError,'prepareStackTrace');
  if(typeof engineStackGetter!=='function'||descriptor?.get!==engineStackGetter||globalThis.Error!==EngineError
      ||typeof fields.name!=='string'||typeof fields.message!=='string'||initialFormatter.unavailable||formatter.unavailable
      ||formatter.found!==initialFormatter.found||formatter.value!==initialFormatter.value
      ||dataField(value,'toString').value!==engineToString||dataField(value,Symbol.toPrimitive).found||dataField(value,Symbol.toStringTag).found)return undefined;
  try{const stack=Reflect.apply(engineStackGetter,value,[]);return typeof stack==='string'?stack:undefined;}catch{return undefined;}
}

function setConservedStack(error:Error,stack:string|undefined):void {
  Object.defineProperty(error,'stack',{value:stack,writable:true,configurable:true});
}

function errorRepresentation(value:Error):Extract<ErrorDetails,{kind:'error'}>{
  const record:Extract<ErrorDetails,{kind:'error'}>={kind:'error'},unavailable:string[]=[];
  for(const [field,maximum] of [['name',256],['message',MESSAGE],['stack',STACK]] as const){
    const data=dataField(value,field);
    if(data.found&&typeof data.value==='string'){record[field]=clipped(data.value,maximum);if(data.value.length>maximum)record.truncated=true;}
    else if(field==='stack'){
      const stack=nativeStack(value,record);if(stack===undefined)unavailable.push(field);else {record.stack=clipped(stack,STACK);if(stack.length>STACK)record.truncated=true;}
    }else unavailable.push(field);
  }
  if(unavailable.length)record.unavailableFields=unavailable;return record;
}

export function diagnosticMessage(details:ErrorDetails,fallbackMessage:string):string {
  if(details.kind==='error')return details.message??fallbackMessage;
  if(details.kind==='value')return details.value===null?'null':typeof details.value==='string'?details.value:typeof details.value==='boolean'?(details.value?'true':'false'):Number.prototype.toString.call(details.value);
  if(details.kind==='undefined')return 'undefined';return fallbackMessage;
}

export function requireDiagnosticKeys(value:unknown,allowed:readonly string[],invalidMessage:string):asserts value is Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error(invalidMessage);
  for(const key of Reflect.ownKeys(value))if(typeof key!=='string'||!allowed.includes(key)||!('value' in Object.getOwnPropertyDescriptor(value,key)!))throw new Error(invalidMessage);
}
function boundedArray(value:unknown,maximum:number,invalidMessage:string):asserts value is unknown[]{
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>maximum||Reflect.ownKeys(value).length!==value.length+1)throw new Error(invalidMessage);
  for(let index=0;index<value.length;index++)if(!('value' in (Object.getOwnPropertyDescriptor(value,String(index))??{})))throw new Error(invalidMessage);
}

/** Clone only bounded diagnostic data; getters and arbitrary thrown objects never execute. */
export function serializeErrorDetails(value:unknown):ErrorDetails {
  let remaining=NODES;const seen=new Set<object>();
  const visit=(value:unknown,depth:number):ErrorDetails=>{
    remaining--;
    if(value===undefined)return {kind:'undefined'};
    if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return {kind:'value',value};
    if(typeof value==='string')return {kind:'value',value:clipped(value,MESSAGE),...(value.length>MESSAGE?{truncated:true as const}:{})};
    if(typeof value!=='object')return {kind:'limit',reason:'unsupported'};
    if(seen.has(value))return {kind:'limit',reason:'cycle'};
    if(depth>=DEPTH)return {kind:'limit',reason:'depth'};
    seen.add(value);
    try{
    if(value instanceof Error){
      const record=errorRepresentation(value);
      const cause=Object.getOwnPropertyDescriptor(value,'cause');
      if(cause){if(remaining>0){if('value' in cause)record.cause=visit(cause.value,depth+1);else {remaining--;record.cause={kind:'limit',reason:'accessor'};}}else record.truncated=true;}
      return record;
    }
    const descriptors=Object.getOwnPropertyDescriptors(value),keys=Object.keys(descriptors).filter(key=>key!=='length');
    const entries:[string,ErrorDetails][]=[],emitted=new Set<string>();
    for(const key of keys.slice(0,ENTRIES)){
      if(remaining<=0)break;
      const name=clipped(key,256);if(emitted.has(name))continue;emitted.add(name);
      const descriptor=descriptors[key];let entry:ErrorDetails;
      if('value' in descriptor)entry=visit(descriptor.value,depth+1);else {remaining--;entry={kind:'limit',reason:'accessor'};}
      entries.push([name,entry]);
    }
    return Array.isArray(value)?{kind:'array',items:entries.map(([,entry])=>entry),...(entries.length<keys.length?{truncated:true as const}:{})}
      :{kind:'object',entries,...(entries.length<keys.length?{truncated:true as const}:{})};
    }finally{seen.delete(value);}
  };
  return visit(value,0);
}

export function validateErrorDetails(value:unknown,invalidMessage:string):asserts value is ErrorDetails {
  let count=0;const seen=new Set<object>();
  const text=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max;
  const visit=(value:unknown,depth:number):void=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||depth>DEPTH||++count>NODES||seen.has(value))throw new Error(invalidMessage);
    seen.add(value);const kind=Object.getOwnPropertyDescriptor(value,'kind')?.value;
    const allowed:Record<string,string[]>={error:['kind','name','message','stack','cause','unavailableFields','truncated'],value:['kind','value','truncated'],array:['kind','items','truncated'],object:['kind','entries','truncated'],undefined:['kind'],limit:['kind','reason']};
    if(typeof kind!=='string'||!Object.hasOwn(allowed,kind))throw new Error(invalidMessage);
    requireDiagnosticKeys(value,allowed[kind],invalidMessage);const row=value;
    if(row.truncated!==undefined&&row.truncated!==true)throw new Error(invalidMessage);
    if(row.kind==='error'){
      if(row.name!==undefined&&!text(row.name,256)||row.message!==undefined&&!text(row.message,MESSAGE)||row.stack!==undefined&&!text(row.stack,STACK))throw new Error(invalidMessage);
      if(row.unavailableFields!==undefined){boundedArray(row.unavailableFields,3,invalidMessage);
        if(new Set(row.unavailableFields).size!==row.unavailableFields.length||row.unavailableFields.some(field=>typeof field!=='string'||!['name','message','stack'].includes(field)||row[field]!==undefined))throw new Error(invalidMessage);
      }
      for(const field of ['name','message','stack'])if(row[field]===undefined&&!(row.unavailableFields as unknown[]|undefined)?.includes(field))throw new Error(invalidMessage);
      if(row.cause!==undefined)visit(row.cause,depth+1);
    }else if(row.kind==='value'){
      if(!(row.value===null||typeof row.value==='boolean'||typeof row.value==='number'&&Number.isFinite(row.value)||text(row.value,MESSAGE)))throw new Error(invalidMessage);
    }else if(row.kind==='array'){
      boundedArray(row.items,ENTRIES,invalidMessage);row.items.forEach(item=>visit(item,depth+1));
    }else if(row.kind==='object'){
      boundedArray(row.entries,ENTRIES,invalidMessage);
      const keys=new Set<string>();for(const entry of row.entries){boundedArray(entry,2,invalidMessage);if(entry.length!==2||!text(entry[0],256)||keys.has(entry[0] as string))throw new Error(invalidMessage);keys.add(entry[0] as string);visit(entry[1],depth+1);}
    }else if(row.kind!=='undefined'&&(row.kind!=='limit'||typeof row.reason!=='string'||!['cycle','depth','unsupported','accessor'].includes(row.reason)))throw new Error(invalidMessage);
  };visit(value,0);
}

/** Validate untrusted wire data before restoring its bounded representation. */
export function restoreErrorDetails(value:ErrorDetails,fallbackMessage:string):unknown {
  if(value.kind==='value')return value.value;if(value.kind==='undefined')return undefined;
  if(value.kind==='limit')return Object.freeze({diagnosticLimit:value.reason});
  if(value.kind==='array')return value.items.map(item=>restoreErrorDetails(item,fallbackMessage));
  if(value.kind==='object')return Object.fromEntries(value.entries.map(([key,value])=>[key,restoreErrorDetails(value,fallbackMessage)]));
  const constructors:Record<string,ErrorConstructor>={Error,TypeError,RangeError,ReferenceError,SyntaxError,URIError,EvalError};
  const ErrorType=value.name&&Object.hasOwn(constructors,value.name)?constructors[value.name]:Error;
  const error=new ErrorType(diagnosticMessage(value,fallbackMessage),value.cause?{cause:restoreErrorDetails(value.cause,fallbackMessage)}:undefined);if(value.name!==undefined)error.name=value.name;
  setConservedStack(error,value.stack);return error;
}

export function copyOriginalError(original:Error,fallbackMessage:string):Error {
  const fields=errorRepresentation(original),error=new Error(diagnosticMessage(fields,fallbackMessage));if(fields.name!==undefined)error.name=fields.name;setConservedStack(error,fields.stack);
  const cause=dataField(original,'cause');if(cause.found&&!cause.unavailable)error.cause=cause.value;
  Object.assign(error,{originalError:original,unavailableErrorFields:fields.unavailableFields});return error;
}
