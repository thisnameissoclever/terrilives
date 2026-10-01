import { expect, it } from 'vitest';
import { classifyMutation } from '../proofs/ottoman-mutation-result.mjs';

const result = message => ({ numFailedTests: 1, testResults: [{ status: 'failed', assertionResults: [
  { status: 'failed', fullName: 'two simultaneous Sit actions', failureMessages: [message] },
] }] });
const runtime = { reason: 'failed', unhandledErrors: [] };
const check = (report, errors = runtime) => classifyMutation(report, 1, errors,
  'two simultaneous Sit actions', 'other-sitter-keeps-target');

it('accepts the named cancellation assertion without runtime errors', () => {
  expect(check(result('AssertionError: other-sitter-keeps-target'))).toHaveLength(1);
});
it('rejects an unrelated fixture assertion in the correct named test', () => {
  expect(() => check(result('AssertionError: placement failed')), 'reject-unrelated-assertion').toThrow('specific assertion');
});
it('rejects an intended assertion accompanied by an unhandled error', () => {
  expect(() => check(result('AssertionError: other-sitter-keeps-target'),
    { reason: 'failed', unhandledErrors: [{ message: 'fixture crashed' }] }), 'reject-unhandled-error').toThrow('runtime error');
});
it('rejects missing runtime evidence and a suite which failed before its assertions', () => {
  expect(() => check(result('AssertionError: other-sitter-keeps-target'), null)).toThrow('runtime error');
  const report = result('AssertionError: other-sitter-keeps-target');
  report.testResults.push({ status: 'failed', assertionResults: [] });
  expect(() => check(report)).toThrow('specific assertion');
});
