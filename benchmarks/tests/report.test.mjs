import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, fx, parseReceipt } from './helpers.mjs';

const CASE = fx('mini-case.case.json');
const MANIFEST = fx('report-manifest.json');

function verifyOnce(candidate, runFile) {
  const { stdout } = run(['verify', '--case', CASE, '--candidate', fx(candidate), '--run', fx(runFile)]);
  return parseReceipt(stdout);
}

test('report：恰好一条 attempt-1 收据 → evidenceEligible 为 true', () => {
  const receipt = verifyOnce('mini-candidate-pass.topology.yaml', 'mini-run-pass.json');
  const dir = mkdtempSync(path.join(tmpdir(), 'atbench-report-'));
  const resultsPath = path.join(dir, 'results.jsonl');
  writeFileSync(resultsPath, `${JSON.stringify(receipt)}\n`);
  try {
    const { status, stdout } = run(['report', '--results', resultsPath, '--manifest', MANIFEST]);
    assert.equal(status, 0, stdout);
    const summary = JSON.parse(stdout);
    assert.equal(summary.evidence_eligible, true);
    assert.deepEqual(summary.ready_case_ids, ['mini-case']);
    assert.equal(summary.failure_clusters.pass, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('report：同一配置同一 case 出现两条 attempt-1 收据 → evidenceEligible 为 false', () => {
  const r1 = verifyOnce('mini-candidate-pass.topology.yaml', 'mini-run-pass.json');
  const r2 = verifyOnce('mini-candidate-missingedge.topology.yaml', 'mini-run-pass.json');
  const dir = mkdtempSync(path.join(tmpdir(), 'atbench-report-'));
  const resultsPath = path.join(dir, 'results.jsonl');
  writeFileSync(resultsPath, `${JSON.stringify(r1)}\n${JSON.stringify(r2)}\n`);
  try {
    const { stdout } = run(['report', '--results', resultsPath, '--manifest', MANIFEST]);
    const summary = JSON.parse(stdout);
    assert.equal(summary.evidence_eligible, false);
    assert.equal(summary.matrix[0].attempt1_receipts, 2);
    assert.equal(summary.failure_clusters.pass, 1);
    assert.equal(summary.failure_clusters.coverage, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('report：一份 case 在结果里从没出现过收据 → evidenceEligible 为 false', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'atbench-report-'));
  const resultsPath = path.join(dir, 'results.jsonl');
  writeFileSync(resultsPath, '');
  try {
    const { stdout } = run(['report', '--results', resultsPath, '--manifest', MANIFEST]);
    const summary = JSON.parse(stdout);
    assert.equal(summary.evidence_eligible, false);
    assert.equal(summary.total_receipts, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('report：results 文件不存在 → exit 2', () => {
  const { status, stderr } = run(['report', '--results', fx('does-not-exist.jsonl'), '--manifest', MANIFEST]);
  assert.equal(status, 2);
  assert.match(stderr, /不存在/);
});
