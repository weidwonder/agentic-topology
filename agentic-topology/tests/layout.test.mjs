import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, data, intersects } from './helpers.mjs';
import { layout } from '../scripts/lib/layout.mjs';
import { measureLabel } from '../scripts/lib/measure.mjs';

test('measureLabel：中文 12px、ASCII 6px、高 16', () => {
  assert.deepEqual(measureLabel('abc'), { w: 18, h: 16 });
  assert.deepEqual(measureLabel('中文'), { w: 24, h: 16 });
  assert.deepEqual(measureLabel('a中'), { w: 18, h: 16 });
});

test('分组各占一列，列序按 order', () => {
  const L = layout(data(FX('three-groups.topology.yaml')));
  assert.ok(L.groups.get('g1').x < L.groups.get('g2').x);
  assert.ok(L.groups.get('g2').x < L.groups.get('g3').x);
  assert.equal(L.groups.get('g1').col, 0);
});

test('组内按最长路径分层，同层同行', () => {
  const L = layout(data(FX('three-groups.topology.yaml')));
  assert.equal(L.nodes.get('N1').row, 0);
  assert.equal(L.nodes.get('N2').row, 1);
  assert.equal(L.nodes.get('N3').row, 2);
  assert.ok(L.nodes.get('N2').y > L.nodes.get('N1').y);
});

test('分组框包住本组全部节点，且不与别的分组框相交', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  const L = layout(doc);
  for (const n of doc.nodes) {
    const box = L.groups.get(n.group), b = L.nodes.get(n.id);
    assert.ok(b.x >= box.x && b.x + b.w <= box.x + box.w, `${n.id} 横向超出分组框`);
    assert.ok(b.y >= box.y && b.y + b.h <= box.y + box.h, `${n.id} 纵向超出分组框`);
  }
  const boxes = [...L.groups.values()];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      assert.equal(intersects(boxes[i], boxes[j]), false, '两个分组框相交了');
});

test('布局确定性：两次运行完全相同', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  assert.equal(JSON.stringify([...layout(doc).nodes]), JSON.stringify([...layout(doc).nodes]));
});

test('分组之间成环不失败，按原始顺序排并给出提示', () => {
  const L = layout(data(FX('cyclic-groups.topology.yaml')));
  assert.ok(L.warnings.some((w) => /成环/.test(w)));
  assert.ok(L.stage.w > 0 && L.stage.h > 0);
  assert.equal(L.nodes.size, 5);
});

test('全都没填分组时归入一个隐式分组，全部节点仍有坐标', () => {
  const L = layout(data(FX('no-group.topology.yaml')));
  assert.equal(L.nodes.size, 4);
  for (const [, b] of L.nodes) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
});

test('部分节点没填分组时归入「没标堆的」并排最右', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  delete doc.nodes[0].group;
  const L = layout(doc);
  const un = L.groups.get('__ungrouped__');
  assert.ok(un, '应当有隐式分组 __ungrouped__');
  for (const [id, g] of L.groups) if (id !== '__ungrouped__') assert.ok(g.x < un.x);
});
