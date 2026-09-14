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

// 筛掉一条边，它线上那行字也 MUST 一起收起来。
// 标注身上没有 data-edge-id（它不是连线浮层的入口），所以按那个属性收元素收不到它——
// 2026-09-02 摘属性时漏的就是这一处与拖动重算那一处，两处同根因。
test('筛掉一条边，它线上的标注也跟着收起来', () => {
  const js = readFileSync('assets/page-shell/app.js', 'utf8');
  const source = js.match(/function syncFilters\(\)[\s\S]*?\n}\n/);
  assert.ok(source, 'app.js 里找不到 syncFilters');

  const 元素 = (属性, 值) => ({ dataset: { [属性]: 值 }, classes: new Set(),
    classList: { toggle(name, on) { if (on) this.owner.classes.add(name);
      else this.owner.classes.delete(name); } } });
  const 建 = (属性, 值) => { const e = 元素(属性, 值); e.classList.owner = e; return e; };

  const 方块 = [建('nodeId', 'N1'), 建('nodeId', 'N2')];
  const 线 = [建('edgeId', 'N1->N2')];
  const 标注 = [建('labelFor', 'N1->N2')];
  const doc = data(FX('three-confidence.topology.yaml'));

  const 假document = {
    getElementById: () => ({ textContent: JSON.stringify(doc) }),
    querySelectorAll: (sel) => {
      if (sel.includes('data-filter-dimension')) return [];       // 一个都没勾 → 全可见
      if (sel.includes('data-node-id')) return 方块;
      if (sel.includes('data-edge-id')) return 线;
      if (sel.includes('data-label-for')) return 标注;
      return [];
    },
  };
  const 跑 = new Function('document', 'readData', 'applyFilter',
    `${source[0]}\nreturn syncFilters;`);

  // 造一次「这条边被筛掉」：applyFilter 换成只回一个空的可见集
  跑(假document, () => doc, () => ({ visibleNodeIds: ['N1', 'N2'], visibleEdgeKeys: [] }))();
  assert.ok(线[0].classes.has('is-hidden'), '前提：这条边确实被筛掉了');
  assert.ok(标注[0].classes.has('is-hidden'),
    '边被筛掉了，它线上那行字还留在图上——收元素时漏了 data-label-for');

  // 再放回来：标注也要跟着回来，不能筛一次就永久消失
  跑(假document, () => doc, () => ({ visibleNodeIds: ['N1', 'N2'], visibleEdgeKeys: ['N1->N2'] }))();
  assert.equal(标注[0].classes.has('is-hidden'), false, '取消筛选后标注没放回来');
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
