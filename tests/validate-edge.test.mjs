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
  ['R-15b', 'E_CONDITIONAL_REQUIRED', 'edges[0].carrier_note'],
  ['R-16', 'E_REQUIRED', 'edges[0].payloads[1].delivered_at'],
  ['R-17', 'E_DANGLING_EDGE', 'edges[0].to'],
  ['R-18', 'E_SELF_LOOP', 'edges[0]'],
  ['R-19', 'E_BIDIRECTIONAL', 'edges[0].bidirectional'],
  ['R-20', 'E_DUPLICATE_EDGE', 'edges[3]'],
  ['R-21', 'E_UNKNOWN_FIELD', 'nodes[2].field_confidence.stop.limits.nope'],
  ['R-21b', 'E_ENUM', 'nodes[2].field_confidence.stop.limits.steps'],
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

test('R-20 的消息必须提示合并并用多个传递物表达，且两条边都被指名', () => {
  const errs = run('R-20').errors.filter((e) => e.code === 'E_DUPLICATE_EDGE');
  assert.ok(errs.length >= 1);
  assert.match(errs[0].message, /合并为一条|合成 1 条/);
  assert.match(errs[0].message, /传递物/);
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
