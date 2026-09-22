/**
 * 诊断收据升级（评审任务①）：warnings 带码、每条诊断带 evidence、
 * supportedFixes 来自 diagnostics.mjs 的对照表而不是就地手写或按 message 猜。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { FX, load, data, validateCli } from './helpers.mjs';
import { validate } from '../scripts/lib/validate.mjs';
import { fixesFor } from '../scripts/lib/diagnostics.mjs';

const run = (name) => {
  const { data: d, lines } = load(FX(`rules/${name}.topology.yaml`));
  return validate(d, lines);
};

// ---- warnings 带码、带 path、带 line ----------------------------------------

test('screening 未填写的 warning 带 W_NO_SCREENING、path 与 line', () => {
  const { data: d, lines } = load(FX('base.topology.yaml'));
  delete d.edges[0].screening;
  const r = validate(d, lines);
  const w = r.warnings.find((x) => x.path === 'edges[0].screening');
  assert.ok(w, `没找到 edges[0].screening 的 warning：${JSON.stringify(r.warnings)}`);
  assert.equal(w.code, 'W_NO_SCREENING');
  assert.equal(typeof w.line, 'number', 'warning 也必须带行号');
  assert.deepEqual(w.evidence, {});
  assert.deepEqual(w.supportedFixes, fixesFor('W_NO_SCREENING'));
  assert.ok(w.supportedFixes.length > 0);
});

test('分组未填写的 warning 带 W_NO_GROUP', () => {
  const { data: d, lines } = load(FX('optional-missing.topology.yaml'));
  const r = validate(d, lines);
  const w = r.warnings.find((x) => x.path === 'nodes[1].group');
  assert.ok(w, `没找到 nodes[1].group 的 warning：${JSON.stringify(r.warnings)}`);
  assert.equal(w.code, 'W_NO_GROUP');
  assert.equal(typeof w.line, 'number');
});

// ---- evidence：放实测到的值，不编 -------------------------------------------

test('E_ENUM 的 evidence 放 actual 与 allowed', () => {
  const r = run('R-04'); // nodes[0].kind 不在闭集内
  const hit = r.errors.find((e) => e.code === 'E_ENUM' && e.path === 'nodes[0].kind');
  assert.ok(hit);
  assert.ok('actual' in hit.evidence, 'evidence 缺 actual');
  assert.ok(Array.isArray(hit.evidence.allowed), 'evidence 缺 allowed');
  assert.ok(hit.evidence.allowed.includes('agent'), 'allowed 应当是 node_kind 的闭集');
});

test('E_DANGLING_EDGE 的 evidence 放这条边的 from/to 与 knownIds', () => {
  const r = run('R-17'); // edges[0].to 指向不存在的节点
  const hit = r.errors.find((e) => e.code === 'E_DANGLING_EDGE' && e.path === 'edges[0].to');
  assert.ok(hit);
  assert.ok('from' in hit.evidence && 'to' in hit.evidence, 'evidence 缺 from/to');
  assert.ok(Array.isArray(hit.evidence.knownIds), 'evidence 缺 knownIds');
  assert.ok(hit.evidence.knownIds.every((id) => typeof id === 'string'), 'knownIds 里不该混进非字符串');
});

test('E_PROMPT_RANGE 的 evidence 放实际写的行区间；能读到文件时还带文件总行数', () => {
  const doc = data(FX('base.topology.yaml'));
  doc.nodes[2].system_prompt.to = 0; // from=1, to=0 → to < from，结构性非法
  const { lines } = load(FX('base.topology.yaml'));
  // 不给 baseDir：读不到文件，evidence 只放 from/to，不编 totalLines
  const withoutFile = validate(doc, lines);
  const hitNoFile = withoutFile.errors.find((e) => e.code === 'E_PROMPT_RANGE');
  assert.ok(hitNoFile);
  assert.deepEqual(hitNoFile.evidence, { from: 1, to: 0 });

  // 给对 baseDir：prompts/planner.v2.md 在 tests/fixtures 下，读得到，带上 totalLines
  const withFile = validate(doc, lines, { baseDir: 'tests/fixtures' });
  const hitFile = withFile.errors.find((e) => e.code === 'E_PROMPT_RANGE');
  assert.ok(hitFile);
  assert.equal(hitFile.evidence.from, 1);
  assert.equal(hitFile.evidence.to, 0);
  assert.equal(typeof hitFile.evidence.totalLines, 'number', '能读到文件时 evidence 要带文件总行数');
  assert.ok(hitFile.evidence.totalLines > 0);
});

test('不知道该放什么 evidence 的诊断给 {}，不编——以 E_REQUIRED 为例', () => {
  const r = run('R-02'); // 缺 generated_at
  const hit = r.errors.find((e) => e.code === 'E_REQUIRED' && e.path === 'generated_at');
  assert.ok(hit);
  assert.deepEqual(hit.evidence, {});
});

// ---- supportedFixes：来自对照表，未登记的码给空数组 --------------------------

test('supportedFixes 与 diagnostics.mjs 的对照表逐条一致', () => {
  const r = run('R-04');
  for (const error of r.errors) {
    assert.deepEqual(error.supportedFixes, fixesFor(error.code),
      `${error.code} 的 supportedFixes 跟对照表对不上`);
  }
});

test('对照表里没登记的码，fixesFor 给空数组，不兜底', () => {
  assert.deepEqual(fixesFor('E_NOT_A_REAL_CODE'), []);
  assert.deepEqual(fixesFor(''), []);
  assert.deepEqual(fixesFor(undefined), []);
});

test('同一个码不管在哪个校验点触发，supportedFixes 都必须完全一样——证明不是就地手写', () => {
  // E_ENUM 至少在两处不同的字段上触发：node.kind 与 edge.category
  const r1 = run('R-04'); // nodes[0].kind
  const { data: d2, lines: l2 } = load(FX('rules/R-15.topology.yaml'));
  d2.edges[0].category = '不存在的类别';
  const r2 = validate(d2, l2);
  const fixesA = r1.errors.find((e) => e.code === 'E_ENUM').supportedFixes;
  const fixesB = r2.errors.find((e) => e.code === 'E_ENUM' && e.path === 'edges[0].category').supportedFixes;
  assert.deepEqual(fixesA, fixesB);
});

// ---- 顶层信封：schemaVersion ------------------------------------------------

test('validate.mjs --format json 的顶层信封带 schemaVersion: 1', () => {
  const { out } = validateCli(FX('base.topology.yaml'));
  assert.equal(out.schemaVersion, 1);
  assert.equal(out.ok, true);
});

test('校验不通过时的 JSON 收据也带同样的信封', () => {
  const { out } = validateCli(FX('rules/R-04.topology.yaml'));
  assert.equal(out.schemaVersion, 1);
  assert.equal(out.ok, false);
  assert.ok(out.errors.every((e) => 'evidence' in e && 'supportedFixes' in e));
});

// ---- 人读文案：supportedFixes 补进去，仍然可读 -------------------------------

// ---- 完备性：validate.mjs 里出现的每一个 E_ 码，对照表里都登记了修复手段 --------
// 防的是「加了新错误码却忘了登记」——那样 supportedFixes 会悄悄变回空数组，
// 没有测试会告诉你少了什么。

test('validate.mjs 里出现的每个 E_ 码，diagnostics.mjs 的对照表都有登记（非空 supportedFixes）', () => {
  const source = readFileSync('scripts/lib/validate.mjs', 'utf8');
  const codes = new Set([...source.matchAll(/'(E_[A-Z_]+)'/g)].map(([, code]) => code));
  assert.ok(codes.size >= 20, `只扫到 ${codes.size} 个 E_ 码，正则可能失配了`);
  const unregistered = [...codes].filter((code) => fixesFor(code).length === 0);
  assert.deepEqual(unregistered, [], `这些错误码在 diagnostics.mjs 里没有登记修复手段：${unregistered.join('、')}`);
});

test('validate.mjs 里出现的每个 W_ 码，对照表也都有登记', () => {
  const source = readFileSync('scripts/lib/validate.mjs', 'utf8');
  const codes = new Set([...source.matchAll(/'(W_[A-Z_]+)'/g)].map(([, code]) => code));
  assert.ok(codes.size >= 2, `只扫到 ${codes.size} 个 W_ 码`);
  for (const code of codes) assert.ok(fixesFor(code).length > 0, `${code} 没有登记修复手段`);
});

test('textOutput 把 supportedFixes 写进人读文案里', () => {
  const r = spawnSync('node', ['scripts/validate.mjs', FX('rules/R-04.topology.yaml')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /\[E_ENUM\] nodes\[0\]\.kind/);
  assert.match(r.stdout, /可用的修复手段/);
});
