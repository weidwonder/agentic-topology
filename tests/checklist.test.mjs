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
