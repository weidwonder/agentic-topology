import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, load, validateCli, renderFail, renderOk, bodyText } from './helpers.mjs';
import { validate } from '../scripts/lib/validate.mjs';

const run = (name) => {
  const { data, lines } = load(FX(`rules/${name}.topology.yaml`));
  return validate(data, lines);
};

const CASES = [
  ['R-15', 'E_REQUIRED', 'edges[0].concurrency_control'],
  ['R-15b', 'E_CONDITIONAL_REQUIRED', 'edges[0].payloads[0].carrier_note'],
  ['R-16', 'E_REQUIRED', 'edges[0].payloads[1].delivered_at'],
  ['R-17', 'E_DANGLING_EDGE', 'edges[0].to'],
  ['R-18', 'E_SELF_LOOP', 'edges[0]'],
  ['R-19', 'E_BIDIRECTIONAL', 'edges[0].bidirectional'],
  ['R-20', 'E_DUPLICATE_EDGE', 'edges[3]'],
  ['R-21', 'E_UNKNOWN_FIELD', 'nodes[2].field_confidence.stop.limits.nope'],
  ['R-21b', 'E_ENUM', 'nodes[2].field_confidence.stop.limits.steps'],
  // 信息块的九类拒绝规则，一类一份负例
  ['R-22', 'E_DANGLING_INFO', 'edges[0].payloads[0].info'],
  ['R-23', 'E_ORPHAN_INFO', 'information[5]'],
  ['R-24', 'E_DUPLICATE_INFO_REF', 'edges[0].payloads[1]'],
  ['R-25', 'E_REQUIRED', 'edges[1].payloads'],
  ['R-26', 'E_DUP_INFO_NAME', 'information[1].name'],
  ['R-27', 'E_REQUIRED', 'information[2].id'],
  ['R-28', 'E_DUP_ID', 'information[1].id'],
  ['R-29', 'E_DANGLING_INFO', 'information[3].same_as'],
  ['R-30', 'E_SELF_SAME_AS', 'information[3].same_as'],
  ['R-31', 'E_REQUIRED', 'information'],
];
for (const [name, code, path] of CASES) {
  test(`${name} → ${code} @ ${path}`, () => {
    const r = run(name);
    assert.equal(r.ok, false);
    const hit = r.errors.find((e) => e.code === code && e.path === path);
    assert.ok(hit, `期望 ${code} @ ${path}，实际：${JSON.stringify(r.errors, null, 2)}`);
  });
}

test('R-19 的消息必须提示拆成两条单向边', () => {
  assert.match(run('R-19').errors.find((e) => e.code === 'E_BIDIRECTIONAL').message, /拆成两条/);
});

test('R-20 的消息必须提示合并并用多份信息表达，且两条边都被指名', () => {
  const errs = run('R-20').errors.filter((e) => e.code === 'E_DUPLICATE_EDGE');
  assert.ok(errs.length >= 1);
  assert.match(errs[0].message, /合并为一条|合成 1 条/);
  assert.match(errs[0].message, /多份信息/);
  assert.match(errs[0].message, /edges\[0\]/, '要指名与它重复的是哪一条');
});

test('一次报出全部问题，不短路', () => {
  const { data, lines } = load(FX('three-errors.topology.yaml'));
  const r = validate(data, lines);
  assert.equal(r.ok, false);
  const codes = new Set(r.errors.map((e) => e.code));
  for (const c of ['E_REQUIRED', 'E_DANGLING_EDGE', 'E_DUPLICATE_EDGE'])
    assert.ok(codes.has(c), `缺 ${c}；实际：${[...codes].join(',')}`);
});

test('CLI json 形态：退出码 2、ok=false、errors ≥3、stats 齐', () => {
  const { status, out } = validateCli(FX('three-errors.topology.yaml'));
  assert.equal(status, 2);
  assert.equal(out.ok, false);
  assert.ok(out.errors.length >= 3);
  assert.equal(typeof out.stats.nodes, 'number');
  assert.equal('checklist_items' in out.stats, false);
});

test('校验不通过时 render.mjs 不产出任何 HTML（spec Invariant 3）', () => {
  const r = renderFail(FX('three-errors.topology.yaml'), 'never.html', 2);
  assert.match(r.stdout + r.stderr, /没有出图|不合格/);
});

test('语法错退出码 3', () => {
  renderFail(FX('syntax/tab-indent.topology.yaml'), 'never2.html', 3);
});

test('选填缺失只报 warning，且照常出图、该处显示「未填写」', () => {
  const { data, lines } = load(FX('optional-missing.topology.yaml'));
  const r = validate(data, lines);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
  assert.ok(r.warnings.some((w) => w.path === 'nodes[1].group'));
  const html = renderOk(FX('optional-missing.topology.yaml'), 'opt.html');
  assert.ok(bodyText(html).includes('未填写'), 'HTML 里应当显示「未填写」');
});

test('随本仓一起交付的样例描述必须能通过校验', () => {
  const { status } = validateCli('assets/templates/example.topology.yaml');
  assert.equal(status, 0);
});

// ---- 信息块：报文要指名，且一次报全 -----------------------------------------

test('缺 information 一节时，报文要说清补什么，不能只说「缺少必填项」', () => {
  const hit = run('R-31').errors.find((e) => e.path === 'information');
  assert.match(hit.message, /信息清单/, '没说要补信息清单');
  assert.match(hit.message, /每条线.*哪几份|哪几份/, '没说边要写清传的是哪几份');
});

test('引用不上、重名、自指三类报文都点名到具体的那一个', () => {
  assert.match(run('R-22').errors.find((e) => e.code === 'E_DANGLING_INFO').message, /nope/);
  assert.match(run('R-26').errors.find((e) => e.code === 'E_DUP_INFO_NAME').message, /材料清册/);
  assert.match(run('R-23').errors.find((e) => e.code === 'E_ORPHAN_INFO').message, /没人传的东西/);
});

test('information: [] 是合法的空态，MUST NOT 因此拒绝出图', () => {
  const { data, lines } = load(FX('empty.topology.yaml'));
  const r = validate(data, lines);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
});

test('信息块的四类问题同时出现时一次全报，不短路', () => {
  const { data, lines } = load(FX('info-four-errors.topology.yaml'));
  const r = validate(data, lines);
  assert.equal(r.ok, false);
  for (const code of ['E_DANGLING_INFO', 'E_ORPHAN_INFO', 'E_DUPLICATE_INFO_REF', 'E_DUP_INFO_NAME'])
    assert.ok(r.errors.some((e) => e.code === code), `漏报 ${code}：${JSON.stringify(r.errors, null, 2)}`);
});

test('carrier 与 form 是两个闭集：interface 能当形态，不能当交法', () => {
  const { data, lines } = load(FX('base.topology.yaml'));
  const bad = structuredClone(data);
  bad.edges[0].payloads[0].carrier = 'interface';
  assert.ok(validate(bad, lines).errors.some((e) => e.code === 'E_ENUM'
    && e.path === 'edges[0].payloads[0].carrier'), 'interface 不该被当成合法交法');
  const good = structuredClone(data);
  good.information[0].form = 'interface';
  assert.equal(validate(good, lines).errors.some((e) => e.path === 'information[0].form'), false,
    'interface 是合法形态');
});
