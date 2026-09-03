import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, data, renderOk, dataOf, sect } from './helpers.mjs';
import { enrich } from '../scripts/lib/enrich.mjs';

const E = () => enrich(data(FX('three-confidence.topology.yaml')), { baseDir: 'tests/fixtures' });

test('核对清单同时收 node / edge / field 三类', async () => {
  const { checklist } = await E();
  for (const lv of ['node', 'edge', 'field'])
    assert.ok(checklist.some((c) => c.level === lv), `核对清单缺 ${lv} 级条目`);
  assert.ok(checklist.some((c) => c.level === 'node' && c.ref === 'N1'));
  assert.ok(checklist.some((c) => c.level === 'edge' && c.ref === 'N2->N3'));
  assert.ok(checklist.some((c) => c.level === 'field' && c.field === 'stop.limits.steps'));
});

test('字段级条目不把整个节点降档', async () => {
  const { checklist } = await E();
  assert.equal(checklist.some((c) => c.level === 'node' && c.ref === 'N3'), false,
    'N3 整体是 certain，不该以节点级进清单');
});

test('not_set 不进清单', async () => {
  const { checklist } = await E();
  assert.equal(checklist.some((c) => /not_set|没设/.test(JSON.stringify(c))), false);
});

test('排序稳定：unread 在前，两次运行完全一致', async () => {
  const a = JSON.stringify((await E()).checklist);
  const b = JSON.stringify((await E()).checklist);
  assert.equal(a, b);
  const list = JSON.parse(a);
  const firstInferred = list.findIndex((c) => c.confidence === 'inferred');
  const lastUnread = list.map((c) => c.confidence).lastIndexOf('unread');
  assert.ok(firstInferred === -1 || lastUnread < firstInferred, 'unread 必须全部排在 inferred 之前');
});

test('每条清单条目都带来源与确认时间', async () => {
  for (const c of (await E()).checklist) {
    assert.ok(Array.isArray(c.source.refs) && c.source.refs.length >= 1, JSON.stringify(c));
    assert.match(c.source.confirmed_at, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('页面上有核对清单，条数与数据一致', () => {
  const html = renderOk(FX('three-confidence.topology.yaml'), 'cl.html');
  const n = dataOf(html).checklist.length;
  assert.ok(n >= 3);
  assert.match(sect(html, 'view-folded') + sect(html, 'view-overview'),
    new RegExp(`这几处得你自己去核实[\\s\\S]{0,400}?${n}\\s*处`));
});

// ---- 信息块级条目 -----------------------------------------------------------

const I = () => enrich(data(FX('info-checklist.topology.yaml')), { baseDir: 'tests/fixtures' });

test('核对清单收第四类：信息块级', async () => {
  const { checklist } = await I();
  assert.ok(checklist.some((c) => c.level === 'information' && c.ref === '材料清册'));
  assert.ok(checklist.some((c) => c.level === 'information' && c.ref === '四个指纹'));
});

test('标了 design 的信息不进清单', async () => {
  const { checklist } = await I();
  assert.equal(checklist.some((c) => c.ref === '规划输入'), false,
    'design 是「还在设计稿上」，不是「你去核实一下」');
});

test('「可能与哪份是同一份」生成一条点名两份的条目；互指只出一条', async () => {
  const { checklist } = await I();
  const pairs = checklist.filter((c) => c.field === 'same_as');
  assert.equal(pairs.length, 1, `互指的两份只该出 1 条，实际 ${pairs.length} 条`);
  assert.match(pairs[0].text, /材料清册/);
  assert.match(pairs[0].text, /四个指纹/);
});

test('信息块写的起终点与线上算出的对不上时，点出来交给人核实', async () => {
  const { checklist } = await I();
  const hit = checklist.find((c) => c.field === 'origin');
  assert.ok(hit, '没生成不一致条目');
  assert.match(hit.text, /N1 到 N3/, '要说清描述里写的是什么');
  assert.match(hit.text, /N2 到 N4/, '要说清线上看是什么');
});

test('四级排序：信息块排在连线之后、字段之前', async () => {
  const { checklist } = await I();
  const order = { node: 0, edge: 1, information: 2, field: 3 };
  const unread = checklist.filter((c) => c.confidence === 'unread').map((c) => order[c.level]);
  assert.deepEqual(unread, [...unread].sort((a, b) => a - b), '同一可信度档内没按四级排');
});

test('信息块级条目的来源取那份信息自己的', async () => {
  const { checklist } = await I();
  const hit = checklist.find((c) => c.level === 'information' && c.ref === '材料清册' && !c.field);
  assert.deepEqual(hit.source.refs, ['src/material-inventory.ts:102-137']);
  assert.equal(hit.source.confirmed_at, '2026-08-26');
});

// ---- design 的两个组合分支（评审门查出来的，之前完全没测到）--------------------

const D = () => enrich(data(FX('info-design.topology.yaml')), { baseDir: 'tests/fixtures' });

test('两份都在设计稿上时，「可能是同一份」不出条目', async () => {
  const { checklist } = await D();
  assert.equal(checklist.some((c) => c.field === 'same_as'), false,
    '拿一份还没造出来的东西去比对，比不出结果——不该派这个活');
});

test('设计稿上的信息，起终点对不上也不出条目', async () => {
  const { checklist } = await D();
  assert.equal(checklist.some((c) => c.field === 'origin'), false);
});

test('但 certain 的自相矛盾照样要报——挡的只有 design 这一档', async () => {
  const { checklist } = await I();
  const ends = checklist.find((c) => c.field === 'origin');
  assert.ok(ends, '标了查实却自相矛盾，恰恰最该让人去看一眼');
  assert.equal(checklist.some((c) => c.field === 'same_as'), true);
});

test('design 的信息一条清单条目都不产生', async () => {
  const { checklist } = await D();
  assert.equal(checklist.some((c) => c.level === 'information'), false,
    `设计稿上的东西不该进核对清单：${JSON.stringify(checklist, null, 2)}`);
});
