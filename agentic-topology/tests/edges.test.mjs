import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FX, data, intersects, renderOk, sect } from './helpers.mjs';
import { layout, EDGE_ANCHOR } from '../scripts/lib/layout.mjs';

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
  const source = js.match(/const ANCHOR_PAD[\s\S]*?\nfunction routeEdge\([\s\S]*?\n}\n/);
  assert.ok(source, 'app.js 里找不到 ANCHOR_PAD + routeEdge 这一段');
  return new Function(`${source[0]}\nreturn { ANCHOR_PAD, ANCHOR_SLOT, anchorRatio, anchorPoint,`
    + ' anchorSortKey, edgeSides, assignAnchors, routeEdge };')();
}

/** 造一张「一个节点扇出到 count 个节点」的最小图，用来看接点分不分得开。 */
function 扇形图(count) {
  const 节点 = (id, group) => ({ id, name: id, kind: 'program', responsibility: '', group,
    confidence: 'certain' });
  const 下游 = Array.from({ length: count }, (_, i) => `W${i + 1}`);
  return {
    groups: [{ id: 'g1', name: '甲', order: 1 }, { id: 'g2', name: '乙', order: 2 }],
    nodes: [节点('HUB', 'g1'), ...下游.map((id) => 节点(id, 'g2'))],
    edges: 下游.map((to) => ({ from: 'HUB', to, category: 'normal', confidence: 'certain',
      payloads: [] })),
    information: [],
  };
}

const 起点 = (d) => d.match(/^M(-?[\d.]+),(-?[\d.]+)/).slice(1, 3).map(Number);
const 终点 = (d) => d.match(/(-?[\d.]+),(-?[\d.]+)$/).slice(1, 3).map(Number);

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

// FR-001/FR-006：一个节点挂几条线，接点就得在那条边框上排开几个。
// 曾经不论挂多少条都取边框正中，扇出的线在节点处全部重合、箭头叠成一团，看不出哪条连的是谁。
test('扇出：一个节点的多条出边 MUST 各有各的接点，且都贴在同一条边框上', () => {
  const L = layout(扇形图(5));
  const 卡片 = L.nodes.get('HUB');
  const 起点们 = L.edges.map((e) => 起点(e.d));
  assert.equal(new Set(起点们.map((p) => p.join(','))).size, 5,
    `5 条出边只有 ${new Set(起点们.map((p) => p.join(','))).size} 个不同起点——重合的线看上去只有一条`);
  for (const [x, y] of 起点们) {
    assert.equal(x, 卡片.x + 卡片.w, '接点 MUST 贴在右边框上，不许跑到卡片里或卡片外');
    assert.ok(y >= 卡片.y && y <= 卡片.y + 卡片.h, `接点 y=${y} 跑出了卡片上下边界`);
  }
});

test('扇入：多条边指向同一个节点时，箭头 MUST NOT 全落在一点', () => {
  const doc = 扇形图(4);
  // 掉个头：四个节点各出一条边指向 HUB
  doc.edges = doc.edges.map((e) => ({ ...e, from: e.to, to: e.from }));
  const L = layout(doc);
  const 终点们 = L.edges.map((e) => 终点(e.d).join(','));
  assert.equal(new Set(终点们).size, 4, `4 条入边只有 ${new Set(终点们).size} 个不同终点`);
});

test('只挂一条线的边框照旧走正中——单边的图不能因为这次改动变样', () => {
  const L = layout(扇形图(1));
  const 卡片 = L.nodes.get('HUB');
  const [x, y] = 起点(L.edges[0].d);
  assert.equal(x, 卡片.x + 卡片.w);
  assert.equal(y, 卡片.y + 卡片.h / 2, '一条边框上只有一个接点时 MUST 仍落在正中');
});

// FR-002：排序不是为了整齐，是为了少交叉——对端靠上的线，接点也排在上面。
test('同一条边框上的接点按对端方位排，线不互相穿过去', () => {
  const L = layout(扇形图(5));
  const 对端Y = (e) => L.nodes.get(e.to).y;
  const 按对端排 = [...L.edges].sort((a, b) => 对端Y(a) - 对端Y(b));
  const 接点Y = 按对端排.map((e) => 起点(e.d)[1]);
  for (let i = 1; i < 接点Y.length; i += 1)
    assert.ok(接点Y[i] > 接点Y[i - 1],
      `对端更靠下的边，接点却更靠上（${接点Y[i - 1]} → ${接点Y[i]}），两条线会交叉`);
});

// FR-005：来回两条边分到同一条边框的两个槽位，不再需要单独的成对错开量。
test('来回两条边各自占一个槽位，MUST NOT 叠成一条', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  const 模板 = JSON.parse(JSON.stringify(doc.edges.find((e) => e.from === 'N1' && e.to === 'N2')));
  doc.edges.push({ ...模板, from: 'N2', to: 'N1' });
  const 双向 = layout(doc);
  const 去 = E(双向, 'N1', 'N2');
  const 回 = E(双向, 'N2', 'N1');
  assert.notDeepEqual(起点(去.d), 终点(回.d), 'N1 上一出一进 MUST 分在两个槽位');
  assert.notDeepEqual(终点(去.d), 起点(回.d), 'N2 上一进一出 MUST 分在两个槽位');
  // 地板取一个槽距：分到两个相邻槽位的两条线，至少也该差这么远。
  // 写成 > 0 是守不住的——接点退化到几乎重合它照样绿。
  // 注意这个地板是**相对**的（拿被测常量当尺子），绝对下界由下面那条单独的用例守。
  assert.ok(最近距离(去.d, 回.d) >= EDGE_ANCHOR.SLOT,
    `两个方向最近只差 ${最近距离(去.d, 回.d).toFixed(1)}px，看上去还是一条线`);
});

test('边界：一条边框上挂 12 条线，接点 MUST 仍落在边框内且两两不同', () => {
  const L = layout(扇形图(12));
  const 卡片 = L.nodes.get('HUB');
  const 起点们 = L.edges.map((e) => 起点(e.d));
  assert.equal(new Set(起点们.map((p) => p.join(','))).size, 12, '挤是可以的，重合不行');
  for (const [, y] of 起点们)
    assert.ok(y >= 卡片.y && y <= 卡片.y + 卡片.h, `接点 y=${y} 被挤出了卡片边框`);
});

test('边界：没有边、以及自环，MUST NOT 出错；自环两端也不重合', () => {
  const 空图 = 扇形图(1);
  空图.edges = [];
  assert.doesNotThrow(() => layout(空图));
  assert.equal(layout(空图).edges.length, 0);

  // 「一个节点、一条边都没有」是另一格：连分桶都进不去，别在取 endpoints[0] 时炸掉。
  const 独苗 = { groups: [{ id: 'g1', name: '甲', order: 1 }],
    nodes: [{ id: 'ONE', name: 'ONE', kind: 'program', responsibility: '', group: 'g1',
      confidence: 'certain' }],
    edges: [], information: [] };
  assert.doesNotThrow(() => layout(独苗));
  assert.equal(layout(独苗).nodes.size, 1);
  assert.equal(layout(独苗).edges.length, 0);

  const 自环 = 扇形图(1);
  自环.edges = [{ from: 'HUB', to: 'HUB', category: 'normal', confidence: 'certain', payloads: [] }];
  const L = layout(自环);
  assert.equal(L.edges.length, 1);
  assert.notDeepEqual(起点(L.edges[0].d), 终点(L.edges[0].d),
    '自环的出点与入点重合，就是一个看不见的点');
});

// 出图 MUST 是确定性的：分槽的排序有并列时靠边的键收尾，两次跑出来 MUST 逐字节一样。
test('同一份描述连出两次图，全部走线逐字节一致', () => {
  for (const name of ['three-groups.topology.yaml', 'benchmarks/multica.topology.yaml']) {
    const 第一次 = layout(data(FX(name))).edges.map((e) => e.d);
    const 第二次 = layout(data(FX(name))).edges.map((e) => e.d);
    assert.deepEqual(第一次, 第二次, `${name}：两次出图的走线不一样，分槽排序不确定`);
  }
});

test('拖动后重算的走线同样分开：routeEdge 按分好的接点画', () => {
  const { anchorSortKey, edgeSides, assignAnchors, routeEdge } = 取浏览器几何();
  const 方块 = (x, y) => ({ x, y, w: 184, h: 90 });
  const 甲 = 方块(0, 300);
  const 乙们 = [方块(420, 0), 方块(420, 150), 方块(420, 300), 方块(420, 450), 方块(420, 600)];
  const plans = 乙们.map((乙, i) => {
    const { fromSide, toSide } = edgeSides(甲, 乙);
    const key = `A->B${i}`;
    return { key, fromSide,
      tail: { nodeId: 'A', side: fromSide, box: 甲, sortKey: anchorSortKey(fromSide, 乙),
        tieBreak: `${key}#tail` },
      head: { nodeId: `B${i}`, side: toSide, box: 乙, sortKey: anchorSortKey(toSide, 甲),
        tieBreak: `${key}#head` } };
  });
  assignAnchors(plans);
  const 起点们 = plans.map((p) => routeEdge(p.tail.point, p.head.point, p.fromSide))
    .map((g) => g.d.match(/^M(-?[\d.]+),(-?[\d.]+)/).slice(1, 3).join(','));
  assert.equal(new Set(起点们).size, 5,
    `拖动后 5 条线只有 ${new Set(起点们).size} 个不同起点——等于只画了一条`);
});

// 上面那些「分得开」的断言全都拿 EDGE_ANCHOR.SLOT 当尺子，尺子本身缩水就一起缩水：
// 把两份 ANCHOR_SLOT 从 18 改成 0.5，接点间距退化到 0.5px（正是本次要修的原症状），
// 那些用例却一条都不红。所以这里给尺子本身钉一个写死的绝对下界。
test('分槽的绝对下界：槽距与接点间距 MUST NOT 缩到看不出是两条线', () => {
  assert.ok(EDGE_ANCHOR.SLOT >= 12,
    `槽距上限 ${EDGE_ANCHOR.SLOT}px 太小，两条线在图上就分不出来了`);

  const L = layout(扇形图(5));
  const 接点Y = L.edges.map((e) => 起点(e.d)[1]).sort((a, b) => a - b);
  const 间距 = Math.min(...接点Y.slice(1).map((y, i) => y - 接点Y[i]));
  assert.ok(间距 >= 8,
    `最小的卡片上挂 5 条线时相邻接点只差 ${间距.toFixed(1)}px，箭头还是糊在一起`);
});

/**
 * 把 app.js 里 boxOf..redrawEdges 整段抠出来，配一个最小的假 DOM 跑一遍。
 * 只有这样才量得到「一条边在 DOM 里有两个 path」这件事有没有被数成两条边。
 */
function 跑一遍重画(节点们, 边键们, { 带标注 = false } = {}) {
  const js = readFileSync('assets/page-shell/app.js', 'utf8');
  const source = js.match(/function boxOf\([\s\S]*?\nfunction redrawEdges\([\s\S]*?\n}\n/);
  assert.ok(source, 'app.js 里找不到 boxOf..redrawEdges 这一段');
  const 方块们 = 节点们.map(([id, box]) => ({
    dataset: { nodeId: id },
    style: { left: `${box.x}px`, top: `${box.y}px` },
    offsetWidth: box.w,
    offsetHeight: box.h,
  }));
  // 一条边在页面上是两个 path：画出来那条 + 加宽的点击区，共用一个 data-edge-id。
  const 线们 = 边键们.flatMap((edgeId) => [0, 1].map(() => ({
    dataset: { edgeId },
    d: null,
    setAttribute(name, value) { if (name === 'd') this.d = value; },
  })));
  // 线上标注按出图产物的真实形状：class + data-label-for，**没有** data-edge-id。
  const 标注 = { dataset: { labelFor: 边键们[0] }, attrs: { x: '111', y: '222' },
    setAttribute(name, value) { this.attrs[name] = String(value); } };
  const 假document = {
    querySelectorAll: (selector) => (selector.includes('.topo-node') ? 方块们 : 线们),
    querySelector: (selector) => (带标注 && /text\[data-label-for/.test(selector) ? 标注 : null),
  };
  new Function('document', 'CSS', `${source[0]}\nreturn redrawEdges;`)(
    假document, { escape: (value) => value })();
  return 带标注 ? { 线们, 标注 } : 线们;
}

// 曾经差点按 path 数分槽：一条边两个 path，5 条线会被当成 10 条，接点摊开一倍、
// 而且两个 path 各自算各自的，画出来那条和点击区还会错位。
test('重画时分槽按边算而不是按 path 算：一条边的两个 path 走同一条线', () => {
  const 甲 = { x: 0, y: 300, w: 184, h: 90 };
  const 乙们 = [0, 150, 300, 450, 600].map((y, i) => [`B${i}`, { x: 520, y, w: 184, h: 90 }]);
  const 线们 = 跑一遍重画([['A', 甲], ...乙们], 乙们.map(([id]) => `A->${id}`));
  assert.equal(线们.length, 10, '前提：每条边两个 path');
  for (let i = 0; i < 线们.length; i += 2)
    assert.equal(线们[i].d, 线们[i + 1].d, '同一条边的画线与点击区 MUST 重合，否则点不到线上');

  const 接点Y = [...new Set(线们.map((line) => Number(line.d.match(/^M-?[\d.]+,(-?[\d.]+)/)[1])))]
    .sort((a, b) => a - b);
  assert.equal(接点Y.length, 5, `5 条边应有 5 个接点，实际 ${接点Y.length}`);
  const 间距 = 接点Y[1] - 接点Y[0];
  const 期望 = Math.min(EDGE_ANCHOR.SLOT, (甲.h - EDGE_ANCHOR.PAD * 2) / 5);
  assert.ok(Math.abs(间距 - 期望) < 0.2,
    `接点间距 ${间距}，按 5 条边算应是 ${期望}——对不上说明把两个 path 当成了两条边`);
});

// 两边是逐字复制的两份代码，所以四样都要钉：常量、比例、排序、分槽。
// 只钉常量与比例是不够的——排序取反或 tie-break 变了，接点集合还是那几个坐标，
// 只是谁排在谁前面悄悄错位，别的用例（只查"两两不同"和"槽距多少"）一条都发现不了。
// 线拖走了、线上的材料标记留在原地——2026-09-02 把标注的 data-edge-id 摘掉时
// （它不再是连线浮层的入口），漏改了重算那一处，它至今还按 data-edge-id 找这行字，
// 永远找不到。所以这里钉的是两件事：出图产物带得出定位属性、重算按同一个属性找。
test('出图给线上标注留了定位属性，且不是 data-edge-id', () => {
  // 只查全貌视图：折叠视图的卡片不参与拖动，那边的标注不需要定位属性。
  const html = sect(renderOk(FX('three-groups.topology.yaml'), 'label-follow.html'), 'view-overview');
  const 标注们 = [...html.matchAll(/<text class="topo-elabel"([^>]*)>/g)].map((m) => m[1]);
  assert.ok(标注们.length > 0, '这份 fixture 出图后一条线上标注都没有，钉不住东西');
  for (const attrs of 标注们) {
    assert.match(attrs, /data-label-for="[^"]+"/,
      '线上标注没有定位属性，拖动后 app.js 找不到它，字就留在原地');
    assert.doesNotMatch(attrs, /data-edge-id=/,
      '标注不许带 data-edge-id——点击派发按它认「连线浮层入口」，一次点击不能同时干两件事');
  }
  const app = readFileSync('assets/page-shell/app.js', 'utf8');
  assert.match(app, /text\[data-label-for=/,
    'app.js 没按 data-label-for 找标注——出图侧和重算侧用的属性 MUST 是同一个');
  assert.doesNotMatch(app, /text\[data-edge-id=/,
    'app.js 还在按 data-edge-id 找标注，那个属性标注身上没有，找出来永远是 null');
});

// 光断言属性还不够：属性在、代码也按它找，中间接错一个键照样不动。这里真跑一遍重算。
test('拖动后重算：线上标注 MUST 跟着线走', () => {
  const 甲 = { x: 0, y: 300, w: 184, h: 90 };
  const 乙 = { x: 520, y: 100, w: 184, h: 90 };
  const { 标注 } = 跑一遍重画([['A', 甲], ['B', 乙]], ['A->B'], { 带标注: true });
  assert.notEqual(标注.attrs.x, '111', '标注的 x 没动——线跟着走了，材料标记留在原地');
  assert.notEqual(标注.attrs.y, '222', '标注的 y 没动');
  const x = Number(标注.attrs.x);
  const y = Number(标注.attrs.y);
  assert.ok(x > 甲.x + 甲.w && x < 乙.x, `标注落在 x=${x}，不在两个方块之间的那段线上`);
  assert.ok(y > 乙.y && y < 甲.y + 甲.h, `标注落在 y=${y}，离这条线太远`);
});

test('浏览器那份分槽规则与出图同源：常量与四个分槽函数逐个同解', () => {
  const { ANCHOR_PAD, ANCHOR_SLOT, anchorRatio, anchorPoint, anchorSortKey, assignAnchors }
    = 取浏览器几何();
  assert.equal(ANCHOR_PAD, EDGE_ANCHOR.PAD, 'app.js 与 layout.mjs 的边框留白 MUST 一致');
  assert.equal(ANCHOR_SLOT, EDGE_ANCHOR.SLOT, 'app.js 与 layout.mjs 的槽距上限 MUST 一致');

  for (const count of [1, 2, 3, 5, 12])
    for (const length of [76, 90, 184, 240])
      for (let index = 0; index < count; index += 1)
        assert.equal(anchorRatio(index, count, length), EDGE_ANCHOR.ratio(index, count, length),
          `第 ${index}/${count} 个接点在长 ${length} 的边框上算出的位置两边对不上`);

  const 方块 = { x: 40, y: 80, w: 184, h: 90 };
  for (const side of ['top', 'right', 'bottom', 'left'])
    for (const ratio of [0, 0.25, 0.5, 0.75, 1])
      assert.deepEqual(anchorPoint(方块, side, ratio), EDGE_ANCHOR.point(方块, side, ratio),
        `${side} 边框上 ratio=${ratio} 的接点坐标两边对不上`);

  const 对端 = { x: 300, y: 120, w: 184, h: 90 };
  for (const side of ['top', 'right', 'bottom', 'left'])
    assert.equal(anchorSortKey(side, 对端), EDGE_ANCHOR.sortKey(side, 对端),
      `${side} 边框上的排序依据两边对不上，接点顺序会静默错位`);

  // 故意让三条边的 sortKey 并列：只有 tie-break 也一致，两边排出来的顺序才会一样。
  const 造一组 = () => {
    const 本体 = { x: 0, y: 0, w: 184, h: 90 };
    const 对面 = { x: 400, y: 0, w: 184, h: 90 };
    return ['A->C', 'A->B', 'A->D'].map((key) => ({
      tail: { nodeId: 'A', side: 'right', box: 本体, sortKey: 0, tieBreak: `${key}#tail` },
      head: { nodeId: key.slice(-1), side: 'left', box: 对面, sortKey: 0, tieBreak: `${key}#head` },
    }));
  };
  const 页面侧 = 造一组();
  const 出图侧 = 造一组();
  assignAnchors(页面侧);
  EDGE_ANCHOR.assign(出图侧);
  assert.deepEqual(页面侧.map((p) => p.tail.point), 出图侧.map((p) => p.tail.point),
    'sortKey 并列时两边的 tie-break 排序对不上，拖动前后接点会换位');
  assert.deepEqual(页面侧.map((p) => p.head.point), 出图侧.map((p) => p.head.point));
});

test('标签宽度用 measureLabel 算，不是自己估的', () => {
  const L = layout(data(FX('edge-shapes.topology.yaml')));
  const e = L.edges.find((x) => x.label);
  const cn = [...e.label].filter((c) => c.charCodeAt(0) > 0x2E80).length;
  assert.equal(e.labelW, cn * 12 + ([...e.label].length - cn) * 6);
});
