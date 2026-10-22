import { vi } from 'vitest';

/** Deliver browser observer callbacks only to targets production code actually subscribed to. */
export function sceneObserverHarness() {
  type Subscription = { callback:()=>void; targets:Set<object> };
  const resize:Subscription[]=[],mutation:Subscription[]=[];
  vi.stubGlobal('ResizeObserver',class {
    private subscription:Subscription;
    constructor(callback:()=>void){this.subscription={callback,targets:new Set()};resize.push(this.subscription);}
    observe(target:object){this.subscription.targets.add(target);}
    disconnect(){this.subscription.targets.clear();}
  });
  vi.stubGlobal('MutationObserver',class {
    private subscription:Subscription;
    constructor(callback:()=>void){this.subscription={callback,targets:new Set()};mutation.push(this.subscription);}
    observe(target:object){this.subscription.targets.add(target);}
    disconnect(){this.subscription.targets.clear();}
  });
  const deliver=(subscriptions:Subscription[],target:object)=>subscriptions.forEach(row=>{if(row.targets.has(target))row.callback();});
  return {resize:(target:object)=>deliver(resize,target),mutation:(target:object)=>deliver(mutation,target),restore:()=>vi.unstubAllGlobals()};
}
