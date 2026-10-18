import { writeSync } from 'node:fs';

function record(event, item) {
  writeSync(1, JSON.stringify({
    event,
    module: item.moduleId ?? item.module?.moduleId,
    name: item.fullName,
    time: new Date().toISOString(),
  }) + '\n');
}

export default class ProgressReporter {
  onTestModuleQueued(module) { record('module-queued', module); }
  onTestModuleCollected(module) { record('module-collected', module); }
  onTestModuleStart(module) { record('module-start', module); }
  onTestModuleEnd(module) { record('module-end', module); }
  onTestCaseReady(testCase) { record('case-ready', testCase); }
}
