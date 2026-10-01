export default class OttomanErrorReporter {
  onTestRunEnd(_modules, unhandledErrors, reason) {
    process.stderr.write('OTTOMAN_RUN_ERRORS=' + JSON.stringify({
      reason, unhandledErrors: unhandledErrors.map(error => ({ name: error.name, message: error.message })),
    }) + '\n');
  }
}
