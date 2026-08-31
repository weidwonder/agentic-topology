import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// FR-039 对全貌视图的要求是「重叠时 MUST 仍**完整可辨**」，不是「不许重叠」——
// AC-013 那条"不相交"只管折叠视图的堆间标注（见 tests/folded.test.mjs）。
// 这里分两步断言"完整可辨"：
//   ① 标注 MUST NOT 压在节点卡片上——卡片是不透明的，会把它整个盖住；
//   ② 标注压在分组框上是允许的（堆内的边整条线都在自己那个框里，躲不开），
//      但 MUST 由层叠顺序与描边光晕保证看得清。
test('标注一律不压在节点卡片上', () => {
  const L = layout(data(FX('edge-shapes.topology.yaml')));
  const cards = [...L.nodes.values()];
  let checked = 0;
  for (const e of L.edges) {
    if (!e.label) continue;
    assert.equal(typeof e.labelW, 'number');
    if (e.overlapUnresolved) continue;
    checked++;
    const lb = { x: e.labelX - e.labelW / 2, y: e.labelY - e.labelH / 2, w: e.labelW, h: e.labelH };
    for (const c of cards)
      assert.equal(intersects(lb, c), false, `边 ${e.from}→${e.to} 的标签压在节点卡片上`);
  }
  const message = `至少应有 4 条边的标签是可解决的，实际 ${checked} —— ` +
    '实现不得靠把标签全标成 unresolved 来绕过本测试';
  assert.ok(checked >= 4, message);
});

test('压在分组框上的标注 MUST 仍完整可辨：层叠顺序 + 描边光晕', () => {
  const css = readFileSync('assets/page-shell/topo.css', 'utf8');
  const zIndexOf = (selector) => {
    const rule = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `topo.css 里找不到 ${selector}`);
    const z = rule[1].match(/z-index:\s*(-?\d+)/);
    assert.ok(z, `${selector} 没写 z-index——不写就按 DOM 顺序叠，分组框会盖住标注`);
    return Number(z[1]);
  };
  const frame = zIndexOf('.topo-frame');
  const edges = zIndexOf('.topo-edges');
  const node = zIndexOf('.topo-node');
  assert.ok(frame < edges, `分组框(${frame}) MUST 在连线标注(${edges})之下，否则标注被整个盖住`);
  assert.ok(edges < node, `连线(${edges}) MUST 在节点卡片(${node})之下`);

  // 光晕：压在任何底色上都读得出字
  const label = css.match(/\.topo-elabel\s*\{([^}]*)\}/);
  assert.ok(label, 'topo.css 里找不到 .topo-elabel');
  assert.match(label[1], /paint-order:\s*stroke fill/, '标注没有描边光晕，压在底色上会糊');
  assert.match(label[1], /stroke-width:\s*[\d.]+px/);
});

// 反面：真实数据上，标注退让 MUST 真的能成功，不能整片退回原点。
// 曾经把分组框也当成障碍物，结果堆内每一条边都无处可放——12 条边全部退让失败，
// 每条标注都退回线段中点、被分组框盖住。指标全绿而图不可读。
test('真实数据上标注退让 MUST 真的成功，不能整片失败', () => {
  for (const name of ['benchmarks/aiudit.topology.yaml', 'three-groups.topology.yaml']) {
    const L = layout(data(FX(name)));
    const failed = L.edges.filter((e) => e.overlapUnresolved).length;
    assert.equal(failed, 0, `${name}：${failed}/${L.edges.length} 条标注退让失败`);
  }
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
