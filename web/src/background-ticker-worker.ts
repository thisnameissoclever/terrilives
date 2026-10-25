/// <reference lib="webworker" />
// A number starts posting empty messages at that interval; null stops them.
const worker = self as unknown as DedicatedWorkerGlobalScope;
let timer: ReturnType<typeof setInterval> | undefined;
worker.onmessage = (event: MessageEvent<number | null>) => {
  clearInterval(timer);
  timer = undefined;
  if (typeof event.data === 'number') timer = setInterval(() => worker.postMessage(null), event.data);
};
