const assert = require('node:assert/strict');

function assertCaptureSweep(cases) {
  assert.equal(cases.length,216,'Every appearance, action and facing must be captured');
  assert.deepEqual(cases.filter(row=>row.error),[],'Appearance or facing capture failed');
}
module.exports={assertCaptureSweep};
