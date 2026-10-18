import {expect, it} from 'vitest';
import {failureBubbleAnchor, OrderFailureBubbles} from '../src/ui/order-failure-bubbles.js';

it('anchors failure feedback to the displayed head through camera zoom and canvas scaling', () => {
  const view = {originX:100,originY:200,scale:2,width:1000,height:600,rect:{left:30,top:40,width:500,height:300}};
  const anchor = failureBubbleAnchor([3,2,1],view)!;
  expect(anchor.x).toBe(112);
  expect(anchor.y).toBeCloseTo(245-Math.sqrt(1166));
  expect(failureBubbleAnchor([3,2,1],{...view,width:0})).toBeNull();
});

it('uses initiating entity ownership and removes the squiggle when its timer expires', () => {
  const nodes: Array<{className:string;innerHTML:string;dataset:Record<string,string>;style:Record<string,string>;hidden:boolean;remove():void;setAttribute():void}> = [];
  const root = {ownerDocument:{createElement:()=>{
    const node={className:'',innerHTML:'',dataset:{},style:{},hidden:false,remove(){nodes.splice(nodes.indexOf(node),1);},setAttribute(){}};
    return node;
  }},append(node:typeof nodes[number]){nodes.push(node);}};
  const bubbles=new OrderFailureBubbles(root as unknown as HTMLElement);
  const source={ids:()=>new Uint32Array([7,9]),positions:()=>new Float32Array([3,2,4,2]),activities:()=>new Uint32Array([0,0])};
  const view={originX:100,originY:200,scale:2,width:1000,height:600,rect:{left:30,top:40,width:500,height:300}};
  bubbles.update(new Set([7]),source,view,()=>[3,2,1]);
  expect(nodes).toHaveLength(1); expect(nodes[0].dataset.entity).toBe('7'); expect(nodes[0].innerHTML).toContain('<path');
  expect(nodes[0].style.left).toBe('112px');
  bubbles.update(new Set(),source,view,()=>null);
  expect(nodes).toHaveLength(0);
});
