import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, load } from './helpers.mjs';
import { layout, layoutFolded } from '../scripts/lib/layout.mjs';
import { edgeLabel, CARRIER_MARK, FORM_MARK } from '../scripts/lib/marks.mjs';

const lay = (name) => layout(load(FX(name)).data);
const labelOf = (name, key) => lay(name).edges
  .find((edge) => `${edge.from}->${edge.to}` === key).label;

test('线上写的是这条线传的信息，不再是什么情况下走这条线', () => {
  const label = labelOf('base.topology.yaml', 'N2->N3');
  assert.ok(label.includes('规划输入'), `线上没写信息名：${label}`);
  assert.equal(label.includes('复用未命中'), false, '触发条件已移进浮层，不该还留在线上');
});

test('一条线上几份，各带各的交法小标', () => {
  const label = labelOf('base.topology.yaml', 'N1->N2');
  assert.equal((label.match(/📦/g) || []).length, 2, '两份都该有小标');
  assert.ok(label.indexOf('材料清册') < label.indexOf('四个指纹'), '要按引用顺序排');
});

test('超过 3 份收成「等 N 份」，N 是总份数不是剩下的份数', () => {
  const label = labelOf('multi-payload.topology.yaml', 'N2->N3');
  assert.match(label, /等 5 份/, `实际：${label}`);
  assert.equal((label.match(/📄|📦|💬|⚡|•/g) || []).length, 3, '线上只列前 3 份');
});

test('信息名超过 10 个字线上截断，浮层与清单不截', () => {
  const info = new Map([['x', { id: 'x', name: '一二三四五六七八九十十一十二' }]]);
  const label = edgeLabel({ payloads: [{ info: 'x', carrier: 'file' }] }, info);
  assert.ok(label.endsWith('…'), `没截断：${label}`);
  assert.equal([...label.replace('📄 ', '').replace('…', '')].length, 10);
});

test('小标取的是这条引用自己的交法，同一条线上可以各不相同', () => {
  const info = new Map([['a', { name: 'A' }], ['b', { name: 'B' }]]);
  const label = edgeLabel({ payloads: [
    { info: 'a', carrier: 'file' }, { info: 'b', carrier: 'prompt' },
  ] }, info);
  assert.ok(label.includes(`${CARRIER_MARK.file} A`) && label.includes(`${CARRIER_MARK.prompt} B`), label);
});

test('形态比交法多一档接口，且两张表其余各档一致', () => {
  assert.equal(FORM_MARK.interface !== undefined, true);
  assert.equal(CARRIER_MARK.interface, undefined, '接口不能当交法');
  for (const key of Object.keys(CARRIER_MARK)) assert.equal(FORM_MARK[key], CARRIER_MARK[key]);
});

test('折叠视图跨堆连线也写信息名，且几条并一条时按编号去重', () => {
  const { edges } = layoutFolded(load(FX('folded-span.topology.yaml')).data);
  assert.ok(edges.length >= 1);
  for (const item of edges) {
    assert.equal(/带 \d+ 样东西/.test(item.label), false, `折叠视图还在写旧说法：${item.label}`);
    assert.ok(/📄|📦|💬|⚡|•/.test(item.label), `折叠标注缺交法小标：${item.label}`);
  }
});

test('几条线并成一条时同一份信息只算一次', () => {
  const { edges } = layoutFolded(load(FX('folded-span.topology.yaml')).data);
  for (const item of edges) {
    const names = item.label.split('  ').map((part) => part.slice(2));
    assert.equal(new Set(names).size, names.length, `折叠标注里有重复的信息：${item.label}`);
  }
});

test('线上标注是确定性的：同一份描述两次算出完全一样', () => {
  assert.deepEqual(lay('base.topology.yaml').edges.map((e) => e.label),
    lay('base.topology.yaml').edges.map((e) => e.label));
});
