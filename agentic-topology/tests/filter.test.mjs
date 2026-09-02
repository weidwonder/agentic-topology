import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FX, data, renderOk, sect } from './helpers.mjs';
import { applyFilter } from '../scripts/lib/interactions.mjs';

const DOC = () => data(FX('three-confidence.topology.yaml'));
const NONE = { confidence: null, kind: null, group: null };

test('不筛时全可见', () => {
  const r = applyFilter(DOC(), NONE);
  assert.equal(r.visibleNodeIds.length, DOC().nodes.length);
  assert.equal(r.visibleEdgeKeys.length, DOC().edges.length);
});

test('按查得准不准筛', () => {
  const r = applyFilter(DOC(), { ...NONE, confidence: ['inferred', 'unread'] });
  assert.deepEqual(r.visibleNodeIds, ['N1']);
  assert.deepEqual(r.visibleEdgeKeys, []);  // N2->N3 的两端 N2/N3 被筛掉了
});

test('按 AI 还是程序筛', () => {
  const r = applyFilter(DOC(), { ...NONE, kind: ['agent'] });
  assert.deepEqual(r.visibleNodeIds, ['N3']);
});

test('按堆筛', () => {
  const r = applyFilter(DOC(), { ...NONE, group: ['g2'] });
  assert.deepEqual(r.visibleNodeIds, ['N4']);
});

test('组合筛选取交集', () => {
  const r = applyFilter(DOC(), { ...NONE, kind: ['program'], group: ['g1'] });
  assert.deepEqual(r.visibleNodeIds, ['N1']);
});

test('连线只在两端都可见时才可见', () => {
  const r = applyFilter(DOC(), { ...NONE, group: ['g1'] });
  assert.ok(r.visibleEdgeKeys.includes('N1->N2'));
  assert.ok(!r.visibleEdgeKeys.includes('N3->N4'), 'N4 在 g2，这条线不该可见');
});

test('筛选不改坐标：applyFilter 不返回也不修改任何位置字段', () => {
  const doc = DOC();
  const before = JSON.stringify(doc);
  const r = applyFilter(doc, { ...NONE, kind: ['agent'] });
  assert.equal(JSON.stringify(doc), before, 'applyFilter 修改了入参');
  assert.equal('nodes' in r, false);
  assert.deepEqual(Object.keys(r).sort(), ['visibleEdgeKeys', 'visibleNodeIds']);
});

test('app.js 只有一份筛选判据：不得自己再判 confidence/kind/group', () => {
  const js = readFileSync('assets/page-shell/app.js', 'utf8');
  assert.match(js, /applyFilter/, 'app.js 必须调用 applyFilter');
  for (const bad of [/\.confidence\s*===/, /\.kind\s*===/, /\.group\s*===/])
    assert.doesNotMatch(js, bad, `app.js 里出现了第二份筛选判据 ${bad}`);
});

test('页面上三组筛选控件齐全', () => {
  const ov = sect(renderOk(FX('three-confidence.topology.yaml'), 'flt.html'), 'view-overview');
  for (const w of ['方块情况', '分堆', 'AI'])
    assert.ok(ov.includes(w), `缺筛选项「${w}」`);
});
