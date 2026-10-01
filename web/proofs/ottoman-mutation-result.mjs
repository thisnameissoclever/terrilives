export function classifyMutation(report, exitCode, runtime, filter, marker) {
  if (!runtime || runtime.reason !== 'failed' || !Array.isArray(runtime.unhandledErrors) || runtime.unhandledErrors.length) {
    throw new Error('Unexpected runtime error or missing error report');
  }
  const failed = report.testResults.flatMap(file => file.assertionResults).filter(test => test.status === 'failed');
  if (exitCode !== 1 || failed.length === 0 || failed.length !== report.numFailedTests ||
      report.testResults.some(file => file.status === 'failed' &&
        !file.assertionResults.some(test => test.status === 'failed')) ||
      failed.some(test => !test.fullName.includes(filter) || !test.failureMessages.length ||
        test.failureMessages.some(message => !message.includes('AssertionError:') || !message.includes(marker)))) {
    throw new Error('Mutation did not fail its specific assertion');
  }
  return failed;
}
