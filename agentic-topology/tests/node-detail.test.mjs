import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, renderOk, renderFail, sect, dataOf, validateCli } from './helpers.mjs';

const D = (fx, out) => sect(renderOk(FX(fx), out), 'detail-store');

test('详情用原生 <details> 分段，Agent 有六段', () => {
  const d = D('base.topology.yaml', 'nd.html');
  const n3 = d.slice(d.indexOf('data-detail-for="N3"'));
  assert.ok((n3.match(/<details class="topo-acc-item"/g) || []).length >= 6);
  // 一次只展开一段：至多一个 details 带 open
  assert.ok((n3.slice(0, n3.indexOf('data-detail-for="N4"') + 1 || undefined)
               .match(/<details class="topo-acc-item" open/g) || []).length <= 1);
});

test('第一段必须含 干什么 / 收到什么 / 交出什么', () => {
  const d = D('base.topology.yaml', 'nd.html');
  const seg = d.slice(d.indexOf('data-detail-for="N1"'));
  for (const w of ['干什么', '收到什么', '交出什么', '它夹在中间是为了解决什么'])
    assert.ok(seg.includes(w), `节点详情缺「${w}」`);
  assert.ok(seg.includes('三个材料目录'));      // inputs 的值
  assert.ok(seg.includes('材料清册与两个指纹')); // outputs 的值
});

test('工具/MCP/Skill 三份清单分列在三个独立容器', () => {
  const d = D('base.topology.yaml', 'nd.html');
  const seg = d.slice(d.indexOf('它能用哪些能力'));
  const a = seg.indexOf('自带的工具'), b = seg.indexOf('外挂的能力'), c = seg.indexOf('装的技能');
  assert.ok(a >= 0 && b > a && c > b, '三份清单必须按 工具 → MCP → Skill 的顺序分列');
  assert.match(seg.slice(c, c + 260), /一个都没有/, 'skills: [] 要显式说「一个都没有」');
});

test('「没设」中性呈现且不进核对清单', () => {
  const html = renderOk(FX('base.topology.yaml'), 'nd.html');
  const d = sect(html, 'detail-store');
  const m = d.match(/花钱[\s\S]{0,200}/)[0];
  assert.match(m, /没设/);
  assert.doesNotMatch(m, /alert-destructive|badge-destructive|is-unknown|警示/);
  const cl = dataOf(html).checklist;
  assert.equal(cl.some((c) => /cost|花钱/.test(JSON.stringify(c))), false, '「没设」不得进核对清单');
});

test('可信度徽章在分段标题栏，不混进属性列表', () => {
  const d = D('base.topology.yaml', 'nd.html');
  assert.match(d, /<summary class="topo-acc-head"[\s\S]{0,400}?topo-flag is-sure[\s\S]{0,60}?<\/summary>/);
});

test('子代理是一等节点：图上有它、父详情有子卡且可跳转、有独立反向边', () => {
  const html = renderOk(FX('subagent.topology.yaml'), 'sa.html');
  assert.match(sect(html, 'view-overview'), /data-node-id="SUB1"/, '子代理必须作为一等节点上图');
  const d = sect(html, 'detail-store');
  assert.match(d, /topo-sub/);
  assert.match(d, /data-goto="SUB1"/, '子卡要能跳到该节点');
  assert.match(d, /data-detail-for="SUB1"/, '子代理自己要有完整详情');
  const edges = dataOf(html).edges.map((e) => `${e.from}->${e.to}`);
  assert.ok(edges.includes('N3->SUB1') && edges.includes('SUB1->N3'), '父子必须是两条独立单向边');
});

test('父子回传边缺「收下之前先查什么」→ 拒绝出图（AC-011 负例）', () => {
  const r = renderFail(FX('subagent-no-screening.topology.yaml'), 'never3.html', 2);
  assert.match(r.stdout + r.stderr, /E_CONDITIONAL_REQUIRED/);
  const { out } = validateCli(FX('subagent-no-screening.topology.yaml'));
  const hit = out.errors.find((e) => e.code === 'E_CONDITIONAL_REQUIRED' && /screening$/.test(e.path));
  assert.ok(hit, `期望 screening 的条件必填错误，实际：${JSON.stringify(out.errors)}`);
});

test('每一层都关得掉：折叠视图有返回入口，详情弹层有关闭按钮', () => {
  const html = renderOk(FX('subagent.topology.yaml'), 'sa.html');
  const foldedView = sect(html, 'view-folded');
  assert.match(foldedView, /data-back/, '折叠视图没有返回入口');
  assert.match(foldedView, /topo-crumb/, '折叠视图没有面包屑');
  const modal = sect(html, 'topo-modal');
  assert.match(modal, /data-modal-close/, '详情弹层没有关闭入口');
  assert.match(modal, /topo-modal-backdrop[^>]*data-modal-close/, '点弹层外关不掉');
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.match(script, /key === 'Escape'/, 'Esc 关不掉弹层');
  assert.match(sect(html, 'view-overview'), /topo-crumb/);
});
