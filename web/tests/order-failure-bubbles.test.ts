import {expect, it} from 'vitest';
import {failureBubbleAnchor, failureBubblePlacement, OrderFailureBubbles} from '../src/ui/order-failure-bubbles.js';

it('keeps phone failure feedback above its head and beside Build and Options', () => {
  const head = {x:163,y:259};
  const controls = {left:8,top:8,width:182,height:213};
  const placement = failureBubblePlacement(head, {width:62,height:42},
    {left:0,top:0,width:390,height:844}, [controls]);
  expect(placement.left).toBeGreaterThanOrEqual(controls.left + controls.width + 8);
  expect(placement.top + 42).toBeLessThan(head.y);
  expect(placement.left + 62).toBeLessThanOrEqual(390 - 8);
  expect(placement.left + placement.tailX).toBe(head.x);
});

it('uses the other side of controls when the right side has no room', () => {
  const placement = failureBubblePlacement({x:355,y:259}, {width:62,height:42},
    {left:0,top:0,width:390,height:844}, [{left:300,top:8,width:82,height:213}]);
  expect(placement.left + 62).toBeLessThanOrEqual(300 - 8);
  expect(placement.left + placement.tailX).toBe(355);
});

it('keeps an unobstructed bubble centered and clamps its body inside the canvas edges', () => {
  const viewport = {left:30,top:40,width:390,height:844};
  const centered = failureBubblePlacement({x:200,y:259}, {width:62,height:42}, viewport, []);
  expect(centered).toEqual({left:169,top:207,tailX:31});
  const edge = failureBubblePlacement({x:32,y:259}, {width:62,height:42}, viewport, []);
  expect(edge.left).toBeGreaterThanOrEqual(38);
  expect(edge.left + edge.tailX).toBe(32);
});

it('anchors failure feedback to the displayed head through camera zoom and canvas scaling', () => {
  const view = {originX:100,originY:200,scale:2,width:1000,height:600,rect:{left:30,top:40,width:500,height:300}};
  const anchor = failureBubbleAnchor([3,2,1],view)!;
  expect(anchor.x).toBe(112);
  expect(anchor.y).toBeCloseTo(245-Math.sqrt(1166));
  expect(failureBubbleAnchor([3,2,1],{...view,width:0})).toBeNull();
});

it('uses initiating entity ownership and removes the squiggle when its timer expires', () => {
  let controls: Array<{getBoundingClientRect(): {left:number;top:number;width:number;height:number}}> = [];
  const nodes: Array<{className:string;innerHTML:string;dataset:Record<string,string>;style:Record<string,string>;hidden:boolean;offsetWidth:number;offsetHeight:number;remove():void;setAttribute():void;querySelector():{setAttribute():void}}> = [];
  const root = {getBoundingClientRect:()=>({left:0,top:0,width:1000,height:600}),ownerDocument:{querySelectorAll:()=>controls,createElement:()=>{
    const node={className:'',innerHTML:'',dataset:{},style:{},hidden:false,offsetWidth:62,offsetHeight:42,remove(){nodes.splice(nodes.indexOf(node),1);},setAttribute(){},querySelector:()=>({setAttribute(){}})};
    return node;
  }},append(node:typeof nodes[number]){nodes.push(node);}};
  const bubbles=new OrderFailureBubbles(root as unknown as HTMLElement);
  const source={ids:()=>new Uint32Array([7,9]),positions:()=>new Float32Array([3,2,4,2]),activities:()=>new Uint32Array([0,0])};
  const view={originX:100,originY:200,scale:2,width:1000,height:600,rect:{left:30,top:40,width:500,height:300}};
  bubbles.update(new Set([7]),source,view,()=>[3,2,1]);
  expect(nodes).toHaveLength(1); expect(nodes[0].dataset.entity).toBe('7'); expect(nodes[0].innerHTML).toContain('<path');
  expect(nodes[0].style.left).toBe('81px');
  controls = [{getBoundingClientRect:()=>({left:8,top:8,width:182,height:213})}];
  bubbles.update(new Set([7]),source,view,()=>[3,2,1]);
  expect(nodes[0].style.left).toBe('198px');
  bubbles.update(new Set(),source,view,()=>null);
  expect(nodes).toHaveLength(0);
  bubbles.update(new Set([9]),source,view,()=>[3,2,1]);
  expect(nodes).toHaveLength(1);
  expect(nodes[0].dataset.entity).toBe('9');
});
