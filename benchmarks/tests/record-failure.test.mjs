import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, fx, parseReceipt } from './helpers.mjs';

const CASE = fx('mini-case.case.json');
const RUN = fx('mini-run-nofailure-fields.json');

test('record-failure：无候选时补一条失败收据，三道闸都是 not_run，exit 1', () => {
  const { status, stdout } = run(['record-failure', '--case', CASE, '--run', RUN, '--failure', 'timeout']);
  const receipt = parseReceipt(stdout);
  assert.equal(receipt.operational_failure, 'timeout');
  assert.equal(receipt.gates.coverage.status, 'not_run');
  assert.equal(receipt.gates.scope.status, 'not_run');
  assert.equal(receipt.gates.validate.status, 'not_run');
  assert.equal(receipt.first_pass_usable, false);
  assert.equal(status, 1);
});

test('record-failure：--failure 只认三个白名单理由，自造理由 exit 2', () => {
  const { status, stderr } = run(['record-failure', '--case', CASE, '--run', RUN, '--failure', 'my_custom_reason']);
  assert.equal(status, 2);
  assert.match(stderr, /只接受/);
});

test('record-failure：case_id 对不上 exit 2', () => {
  const { status, stderr } = run(['record-failure', '--case', CASE, '--run', fx('mini-run-wrongcase.json'), '--failure', 'no_candidate']);
  assert.equal(status, 2);
  assert.match(stderr, /case_id/);
});
