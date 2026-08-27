import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, data, intersects } from './helpers.mjs';
import { layout } from '../scripts/lib/layout.mjs';

const E = (L, f, t) => {
  const e = L.edges.find((x) => x.from === f && x.to === t);
  assert.ok(e, `没有 ${f}→${t} 这条边`);
  return e;
};

test('五种走线情形各自有正确形状，且分支互斥', () => {
  const L = layout(data(FX('edge-shapes.topology.yaml')));
  assert.match(E(L, 'N1', 'N2').d, /^M[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+$/, '同列相邻层必须是直线');
  assert.match(E(L, 'N1', 'N3').d, /^M[\d.-]+,[\d.-]+ C/, '同列跨层必须是贝塞尔');
  assert.match(E(L, 'N3', 'N1').d, /^M[\d.-]+,[\d.-]+ C/, '同列回边必须是贝塞尔');
  assert.match(E(L, 'N3', 'N4').d, /^M[\d.-]+,[\d.-]+ C/, '跨列必须是贝塞尔');
  assert.match(E(L, 'N5', 'N1').d, /^M[\d.-]+,[\d.-]+ C/, '跨列回边必须是贝塞尔');
  // 同列跨层走右外侧、同列回边走左外侧，控制点方向相反
  const fwd = E(L, 'N1', 'N3').d.match(/C([\d.-]+),/)[1];
  const back = E(L, 'N3', 'N1').d.match(/C([\d.-]+),/)[1];
  assert.notEqual(fwd, back, '跨层与回边不能走同一侧');
});

test('颜色管类别、线型管可信度，两者不互相覆盖', () => {
  const L = layout(data(FX('edge-shapes.topology.yaml')));
  const e = E(L, 'N3', 'N1');
  assert.equal(e.category, 'reject_or_halt', '可信度不得覆盖类别');
  assert.equal(e.confidence, 'inferred');
  assert.equal(E(L, 'N1', 'N2').confidence, 'certain');
});

test('可解决的标签一律不与节点框、分组框相交', () => {
  const L = layout(data(FX('edge-shapes.topology.yaml')));
  const boxes = [...L.nodes.values(), ...L.groups.values()];
  let checked = 0;
  for (const e of L.edges) {
    if (!e.label) continue;
    assert.equal(typeof e.labelW, 'number');
    if (e.overlapUnresolved) continue;
    checked++;
    const lb = { x: e.labelX - e.labelW / 2, y: e.labelY - e.labelH / 2, w: e.labelW, h: e.labelH };
    for (const b of boxes)
      assert.equal(intersects(lb, b), false, `边 ${e.from}→${e.to} 的标签压在方块上`);
  }
  const message = `至少应有 4 条边的标签是可解决的，实际 ${checked} —— ` +
    '实现不得靠把标签全标成 unresolved 来绕过本测试';
  assert.ok(checked >= 4, message);
});

test('退让失败时不静默：置 overlapUnresolved 并各记一条 warning', () => {
  const L = layout(data(FX('dense-labels.topology.yaml')));
  for (const e of L.edges.filter((x) => x.overlapUnresolved))
    assert.ok(L.warnings.some((w) => w.includes(`${e.from}->${e.to}`)),
      `${e.from}→${e.to} 退让失败却没有 warning`);
});

test('标签宽度用 measureLabel 算，不是自己估的', () => {
  const L = layout(data(FX('edge-shapes.topology.yaml')));
  const e = L.edges.find((x) => x.label);
  const cn = [...e.label].filter((c) => c.charCodeAt(0) > 0x2E80).length;
  assert.equal(e.labelW, cn * 12 + ([...e.label].length - cn) * 6);
});
