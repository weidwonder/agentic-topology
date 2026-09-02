import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FX, data, intersects } from './helpers.mjs';
import { layout, EDGE_PAIR_OFFSET } from '../scripts/lib/layout.mjs';

/** 把一条 d 均匀采样成一串点，用来量两条线离得有多远。 */
function 采样(d, count = 60) {
  const n = d.match(/-?[\d.]+/g).map(Number);
  const curved = d.includes('C');
  const at = (t) => {
    if (!curved) return { x: n[0] + (n[2] - n[0]) * t, y: n[1] + (n[3] - n[1]) * t };
    const u = 1 - t;
    return {
      x: u ** 3 * n[0] + 3 * u ** 2 * t * n[2] + 3 * u * t ** 2 * n[4] + t ** 3 * n[6],
      y: u ** 3 * n[1] + 3 * u ** 2 * t * n[3] + 3 * u * t ** 2 * n[5] + t ** 3 * n[7],
    };
  };
  return Array.from({ length: count + 1 }, (_, i) => at(i / count));
}

/** 两条线之间最近的距离——为 0 就是叠在一起，看上去只有一条。 */
function 最近距离(d1, d2) {
  let min = Infinity;
  for (const a of 采样(d1)) for (const b of 采样(d2)) min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
  return min;
}

/** 把 app.js 里那段浏览器几何规则抠出来跑——它不是模块，只能按文本取。 */
function 取浏览器几何() {
  const js = readFileSync('assets/page-shell/app.js', 'utf8');
  const source = js.match(/const PAIR_OFFSET[\s\S]*?\nfunction routeEdge\([\s\S]*?\n}\n/);
  assert.ok(source, 'app.js 里找不到 PAIR_OFFSET + routeEdge 这一段');
  return new Function(`${source[0]}\nreturn { PAIR_OFFSET, pairSeparation, routeEdge };`)();
}

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
// multica 那张图曾经有一条标注怎么退都放不下：只沿中点一列试 13 个位置太窄了，
// 沿线多取几个 t、法线两侧再放宽之后才有落脚点。这几份都 MUST 一条都不剩。
test('真实数据上标注退让 MUST 真的成功，不能整片失败', () => {
  for (const name of ['benchmarks/aiudit.topology.yaml', 'benchmarks/multica.topology.yaml',
    'benchmarks/cpah-docs.topology.yaml', 'aiudit-internal-control.topology.yaml',
    'three-groups.topology.yaml']) {
    const L = layout(data(FX(name)));
    const failed = L.edges.filter((e) => e.overlapUnresolved).length;
    assert.equal(failed, 0, `${name}：${failed}/${L.edges.length} 条标注退让失败`);
  }
});

test('退让失败时不静默：置 overlapUnresolved 与 warning 一一对应，不许只有其中一样', () => {
  for (const name of ['dense-labels.topology.yaml', 'benchmarks/cpah-docs.topology.yaml']) {
    const L = layout(data(FX(name)));
    const 失败的 = L.edges.filter((x) => x.overlapUnresolved);
    for (const e of 失败的)
      assert.ok(L.warnings.some((w) => w.includes(`${e.from}->${e.to}`)),
        `${e.from}→${e.to} 退让失败却没有 warning`);
    const 报了的 = L.warnings.filter((w) => w.startsWith('layout: label overlap at edge'));
    assert.equal(报了的.length, 失败的.length,
      `${name}：报了 ${报了的.length} 条 warning，却只有 ${失败的.length} 条标注真的没放下——两边 MUST 对得上`);
  }
});

// 三处一起测「来回两条边看得出是两条」：出图的走线、浏览器重算的走线、以及两边用的是同一个错开量。
test('来回两条边各自让开，MUST NOT 叠成一条', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  const 单向 = layout(doc);
  const 单向卡片 = 单向.nodes.get('N1');
  const 单向起点X = Number(E(单向, 'N1', 'N2').d.match(/^M(-?[\d.]+),/)[1]);
  assert.equal(单向起点X, 单向卡片.x + 单向卡片.w / 2, '没有反向边的照旧从卡片正中拉出去');

  const 模板 = JSON.parse(JSON.stringify(doc.edges.find((e) => e.from === 'N1' && e.to === 'N2')));
  doc.edges.push({ ...模板, from: 'N2', to: 'N1' });
  const 双向 = layout(doc);
  const 卡片 = 双向.nodes.get('N1');
  const 去 = E(双向, 'N1', 'N2');
  const 回 = E(双向, 'N2', 'N1');
  const 去起点X = Number(去.d.match(/^M(-?[\d.]+),/)[1]);
  assert.equal(去起点X, 卡片.x + 卡片.w / 2 - EDGE_PAIR_OFFSET,
    '有反向边时 MUST 沿卡片边框让开一个错开量，两条线才不会共用同一条中轴');
  assert.equal(去.d.match(/^M-?[\d.]+,(-?[\d.]+)/)[1], String(卡片.y + 卡片.h),
    '让开只许沿边框滑，不许离开卡片下边框');
  assert.ok(最近距离(去.d, 回.d) >= EDGE_PAIR_OFFSET * 2,
    `两个方向最近只差 ${最近距离(去.d, 回.d).toFixed(1)}px，看上去还是一条线`);
});

test('拖动后重算的走线同样错开：routeEdge 两个方向分到路径两侧', () => {
  const { PAIR_OFFSET, routeEdge } = 取浏览器几何();
  const 甲 = { x: 0, y: 0, w: 184, h: 90 };
  const 乙 = { x: 420, y: 60, w: 184, h: 90 };
  const 去 = routeEdge(甲, 乙, PAIR_OFFSET);
  const 回 = routeEdge(乙, 甲, PAIR_OFFSET);
  assert.ok(最近距离(去.d, 回.d) >= PAIR_OFFSET * 1.4,
    `拖动后来回两条边最近只差 ${最近距离(去.d, 回.d).toFixed(1)}px——不给 separation 时两条一模一样，等于只画了一条`);
  const 不让开 = 最近距离(routeEdge(甲, 乙, 0).d, routeEdge(乙, 甲, 0).d);
  assert.ok(不让开 < 1, '这条用例的前提是：不让开时两条线本来就是同一条');
  assert.ok(Math.abs(去.labelY - 回.labelY) >= PAIR_OFFSET, '两条边的标注也要跟着分开，否则叠在一起看不清');
});

test('浏览器那份几何规则与出图同源：反向边才错开，错开量取同一个常数', () => {
  const { PAIR_OFFSET, pairSeparation } = 取浏览器几何();
  assert.equal(PAIR_OFFSET, EDGE_PAIR_OFFSET, 'app.js 与 layout.mjs 的错开量 MUST 一致，否则拖动前后错开距离会变');
  assert.equal(pairSeparation(new Set(['A->B']), 'A', 'B'), 0, '单向边不该被挪开');
  assert.equal(pairSeparation(new Set(['A->B', 'B->A']), 'A', 'B'), PAIR_OFFSET);
  assert.equal(pairSeparation(new Set(['A->B', 'B->A']), 'B', 'A'), PAIR_OFFSET, '两个方向同号，才会分到路径两侧');
  assert.equal(pairSeparation(new Set(['A->A']), 'A', 'A'), 0, '自环没有「反向」可言');
});

test('标签宽度用 measureLabel 算，不是自己估的', () => {
  const L = layout(data(FX('edge-shapes.topology.yaml')));
  const e = L.edges.find((x) => x.label);
  const cn = [...e.label].filter((c) => c.charCodeAt(0) > 0x2E80).length;
  assert.equal(e.labelW, cn * 12 + ([...e.label].length - cn) * 6);
});
