import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, data, intersects } from './helpers.mjs';
import { layout } from '../scripts/lib/layout.mjs';
import { measureLabel, wrapLineCount } from '../scripts/lib/measure.mjs';

test('measureLabel：中文 12px、ASCII 6px、高 16', () => {
  assert.deepEqual(measureLabel('abc'), { w: 18, h: 16 });
  assert.deepEqual(measureLabel('中文'), { w: 24, h: 16 });
  assert.deepEqual(measureLabel('a中'), { w: 18, h: 16 });
});

test('wrapLineCount：按全角/半角宽度换行，恰好撑满不换行', () => {
  assert.equal(wrapLineCount('a'.repeat(10), 60), 1); // 10*6=60，刚好不超
  assert.equal(wrapLineCount('a'.repeat(11), 60), 2); // 第 11 个字符超了
  assert.equal(wrapLineCount('中'.repeat(5), 60), 1); // 5*12=60，刚好不超
  assert.equal(wrapLineCount('中'.repeat(6), 60), 2);
});

test('wrapLineCount：换行符按空白折叠，不当强制断行（卡片描述没设 white-space:pre-line）', () => {
  assert.equal(wrapLineCount('a\n\nb', 100), 1);
  assert.equal(wrapLineCount('', 100), 1);
});

test('nodeHeight 修复回归：中文责任描述按实际换行数算高度，不能再用「每行 26 字」估半截', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  const longText = '瑞星久宇被识成互久宇、瑞昱久宇、福建久宇，判同一实体看地址税号账号合同号型号这些硬信息。'
    .repeat(4); // 302 字左右，中文为主，跟 aiudit_platform 实际炸掉的 A3 节点同一量级
  doc.nodes[2].responsibility = longText;
  const contentWidth = 184 - 20;
  const expectedLines = wrapLineCount(longText, contentWidth);
  const expectedHeight = 76 + 14 * Math.max(0, expectedLines - 2);
  const oldBuggyExtraLines = Math.max(0, Math.ceil(longText.length / 26) - 2);
  const oldBuggyHeight = 76 + 14 * oldBuggyExtraLines;
  const box = layout(doc).nodes.get('N3');
  assert.equal(box.h, expectedHeight, '应按真实换行数出高度');
  assert.ok(box.h > oldBuggyHeight, '不能再退回旧的「长度/26」估算，那会比实际需要矮一大截');
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
