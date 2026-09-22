import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, fx, parseReceipt } from './helpers.mjs';

const CASE = fx('mini-case.case.json');

test('verify：结构齐全 + 人工留账 + 评审签署 + 真实 validate.mjs 通过 → 三闸全过，exit 0', () => {
  const { status, stdout } = run([
    'verify', '--case', CASE,
    '--candidate', fx('mini-candidate-pass.topology.yaml'),
    '--run', fx('mini-run-pass.json'),
  ]);
  const receipt = parseReceipt(stdout);
  assert.equal(receipt.gates.protocol.status, 'pass');
  assert.equal(receipt.gates.scope.status, 'pass');
  assert.equal(receipt.gates.coverage.status, 'pass');
  assert.equal(receipt.gates.validate.status, 'pass');
  assert.equal(receipt.first_pass_usable, true);
  assert.equal(status, 0);
});

test('verify：候选缺一条必需边 → 覆盖闸 fail（missing_edge），exit 1', () => {
  const { status, stdout } = run([
    'verify', '--case', CASE,
    '--candidate', fx('mini-candidate-missingedge.topology.yaml'),
    '--run', fx('mini-run-pass.json'),
  ]);
  const receipt = parseReceipt(stdout);
  assert.equal(receipt.gates.coverage.status, 'fail');
  const failedEdge = receipt.gates.coverage.edges.failures.find((f) => f.reason === 'missing_edge');
  assert.ok(failedEdge, 'A→B 那条边应该被判 missing_edge');
  assert.equal(receipt.first_pass_usable, false);
  assert.equal(status, 1);
});

test('verify：候选没读到必须覆盖的路径 → 范围闸 fail，exit 1', () => {
  const { status, stdout } = run([
    'verify', '--case', CASE,
    '--candidate', fx('mini-candidate-noscope.topology.yaml'),
    '--run', fx('mini-run-pass.json'),
  ]);
  const receipt = parseReceipt(stdout);
  assert.equal(receipt.gates.scope.status, 'fail');
  assert.equal(receipt.gates.scope.missing[0].path_contains, 'src/a.ts');
  assert.equal(status, 1);
});

test('verify：run.json 里 benchmarks_dir_excluded=false → 协议闸 fail，即使结构与校验都过，exit 1', () => {
  const { status, stdout } = run([
    'verify', '--case', CASE,
    '--candidate', fx('mini-candidate-pass.topology.yaml'),
    '--run', fx('mini-run-protocolfail.json'),
  ]);
  const receipt = parseReceipt(stdout);
  assert.equal(receipt.gates.protocol.status, 'fail');
  assert.equal(receipt.gates.coverage.status, 'pass', '协议闸失败不应该连带把结构本来能过的覆盖闸也改判');
  assert.equal(receipt.first_pass_usable, false);
  assert.equal(status, 1);
});

test('verify：run.json 完全没有 protocol 字段 → 视为输入不合规，exit 2，且不出收据', () => {
  const { status, stdout, stderr } = run([
    'verify', '--case', CASE,
    '--candidate', fx('mini-candidate-pass.topology.yaml'),
    '--run', fx('mini-run-noprotocol.json'),
  ]);
  assert.equal(status, 2);
  assert.equal(stdout.trim(), '', '协议字段结构性缺失时不应该出收据');
  assert.match(stderr, /run.protocol 缺失/);
});

test('verify：合并进同一节点但没有 ledger_review 留账 → unledgered_merge，exit 1', () => {
  const { status, stdout } = run([
    'verify', '--case', CASE,
    '--candidate', fx('mini-candidate-pass.topology.yaml'),
    '--run', fx('mini-run-unledgered.json'),
  ]);
  const receipt = parseReceipt(stdout);
  const failedEdge = receipt.gates.coverage.edges.failures.find((f) => f.reason === 'unledgered_merge');
  assert.ok(failedEdge, 'P1→P2 应该因为没留账被判 unledgered_merge');
  assert.equal(status, 1);
});

test('verify：结构全过，但 coverage_review 被标 skipped → 覆盖闸仍然 fail（skipped 不能升级成 pass），exit 1', () => {
  const { status, stdout } = run([
    'verify', '--case', CASE,
    '--candidate', fx('mini-candidate-pass.topology.yaml'),
    '--run', fx('mini-run-skippedreview.json'),
  ]);
  const receipt = parseReceipt(stdout);
  assert.equal(receipt.gates.coverage.structural_pass, true);
  assert.equal(receipt.gates.coverage.reviewer_signed_off, false);
  assert.equal(receipt.gates.coverage.status, 'fail');
  assert.equal(status, 1);
});

test('verify：run.json 缺 coverage_review → 结构性不合规，exit 2', () => {
  const { status, stderr } = run([
    'verify', '--case', CASE,
    '--candidate', fx('mini-candidate-pass.topology.yaml'),
    '--run', fx('mini-run-nofailure-fields.json'),
  ]);
  assert.equal(status, 2);
  assert.match(stderr, /coverage_review/);
});

test('verify：run.case_id 与 case.id 对不上 → exit 2', () => {
  const { status, stderr } = run([
    'verify', '--case', CASE,
    '--candidate', fx('mini-candidate-pass.topology.yaml'),
    '--run', fx('mini-run-wrongcase.json'),
  ]);
  assert.equal(status, 2);
  assert.match(stderr, /case_id/);
});

test('verify：case 被判 blind_test_eligible=false 时默认拒绝出收据，exit 2', () => {
  const { status, stdout, stderr } = run([
    'verify', '--case', fx('mini-case-compromised.case.json'),
    '--candidate', fx('mini-candidate-pass.topology.yaml'),
    '--run', fx('mini-run-pass-compromised.json'),
  ]);
  assert.equal(status, 2);
  assert.equal(stdout.trim(), '');
  assert.match(stderr, /blind_test_eligible=false/);
});

test('verify：加 --allow-compromised-case 后可以跑，但收据的 evidence_eligible 被强制标 false', () => {
  const { status, stdout } = run([
    'verify', '--case', fx('mini-case-compromised.case.json'),
    '--candidate', fx('mini-candidate-pass.topology.yaml'),
    '--run', fx('mini-run-pass-compromised.json'),
    '--allow-compromised-case',
  ]);
  const receipt = parseReceipt(stdout);
  assert.equal(receipt.evidence_eligible, false);
  assert.equal(status, 0); // 三道闸本身仍然能过，只是不算数
});

test('verify：候选文件读不出来 → exit 2', () => {
  const { status, stderr } = run([
    'verify', '--case', CASE,
    '--candidate', fx('does-not-exist.topology.yaml'),
    '--run', fx('mini-run-pass.json'),
  ]);
  assert.equal(status, 2);
  assert.match(stderr, /候选描述不存在/);
});
