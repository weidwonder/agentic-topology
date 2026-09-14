import { baseGroups } from './groups.mjs';
import { measureLabel, wrapLineCount } from './measure.mjs';
import { edgeLabel, edgeLabelParts } from './marks.mjs';
import { foldSummary } from './interactions.mjs';

const M = {
  NODE_W: 184,
  NODE_MIN_H: 76,
  // 行列间距要留得开：连线是直接从方块边上拉出去的，间距一紧，跨堆的长线只能贴着别的方块过，
  // 看起来就是「线从卡片里穿出来」。留宽之后线有自己的走廊，人也有地方手动拖。
  ROW_GAP: 72,
  COL_GAP: 200,
  GROUP_PAD_X: 24,
  GROUP_PAD_TOP: 26,
  STAGE_PAD: 32,
};

// 卡片高度是程序算好写进 style 的，浏览器不会替它长高：估矮一点文字就直接溢出下边界。
// 所以逐段按 topo.css 里各自的字号与行高折算——name 12px/1.35、desc 10.5px/1.4，
// MUST NOT 让两者共用一张宽度表，字号不同、同样一句话换出来的行数就不同。
const CARD = {
  PAD_X: 10,
  PAD_Y: 8,
  // 上下（或左右）两条 1px 边框合计，卡片是 border-box，边框吃的是内容区
  BORDER: 2,
  // .topo-node-top 里那排 10px 的药丸：字 + 上下各 1px 内边距 + 1px 边框，留一点富余。
  TOP_ROW: 17,
  NAME_SIZE: 12,
  NAME_LINE: 12 * 1.35,
  NAME_GAP: 3,
  DESC_SIZE: 10.5,
  DESC_LINE: 10.5 * 1.4,
  DESC_GAP: 3,
  // .topo-marks：9.5px 药丸一行，外加 margin-top 5。
  MARKS: 22,
};

const CATEGORY_COLORS = {
  normal: 'var(--primary)',
  pass_or_skip: 'var(--success)',
  reject_or_halt: 'var(--destructive)',
};

const CATEGORY_MARKERS = {
  normal: 'ah-main',
  pass_or_skip: 'ah-ok',
  reject_or_halt: 'ah-back',
};

/** 估算一张节点卡片撑开后需要多高：名字与描述各按自己的字号换行，逐段累加。 */
export function nodeHeight(node) {
  // 内容区宽度 = 卡片宽 - 左右内边距 - 左右边框（.topo-node 是 border-box）。
  const contentWidth = M.NODE_W - CARD.PAD_X * 2 - CARD.BORDER;
  const name = String(node.name || '');
  const responsibility = String(node.responsibility || '');
  // 空文本那一段在页面上根本不占位，算成一行会让整列卡片凭空高一截。
  const nameBlock = name ? CARD.NAME_GAP + wrapLineCount(name, contentWidth, CARD.NAME_SIZE) * CARD.NAME_LINE : 0;
  const descBlock = responsibility
    ? CARD.DESC_GAP + wrapLineCount(responsibility, contentWidth, CARD.DESC_SIZE) * CARD.DESC_LINE
    : 0;
  const marked = Number(node.concurrency?.default) > 1 || node.spawns_subagents === true;
  const content = CARD.PAD_Y * 2 + CARD.BORDER + CARD.TOP_ROW + nameBlock + descBlock + (marked ? CARD.MARKS : 0);
  return Math.max(M.NODE_MIN_H, Math.ceil(content));
}

function topologicalGroups(groups, edges, nodes) {
  const index = new Map(groups.map((group, i) => [group.id, i]));
  const outgoing = groups.map(() => new Set());
  const indegree = groups.map(() => 0);
  for (const edge of edges) {
    const from = nodes.find((node) => node.id === edge.from)?.group;
    const to = nodes.find((node) => node.id === edge.to)?.group;
    if (!from || !to || from === to || !index.has(from) || !index.has(to)) continue;
    const a = index.get(from);
    const b = index.get(to);
    if (!outgoing[a].has(b)) {
      outgoing[a].add(b);
      indegree[b] += 1;
    }
  }
  const pending = [];
  for (let i = 0; i < groups.length; i += 1) if (indegree[i] === 0) pending.push(i);
  const result = [];
  while (pending.length > 0) {
    const current = pending.shift();
    result.push(groups[current]);
    for (const next of outgoing[current]) {
      indegree[next] -= 1;
      if (indegree[next] === 0) {
        const position = pending.findIndex((item) => item > next);
        if (position < 0) pending.push(next);
        else pending.splice(position, 0, next);
      }
    }
  }
  return result.length === groups.length ? result : groups.slice();
}

function hasGroupCycle(groups, edges, nodes) {
  const ids = new Set(groups.map((group) => group.id));
  const adjacency = new Map(groups.map((group) => [group.id, []]));
  for (const edge of edges) {
    const from = nodes.find((node) => node.id === edge.from)?.group;
    const to = nodes.find((node) => node.id === edge.to)?.group;
    if (from && to && from !== to && ids.has(from) && ids.has(to)) adjacency.get(from).push(to);
  }
  const state = new Map();
  const visit = (id) => {
    state.set(id, 1);
    for (const next of adjacency.get(id)) {
      if (state.get(next) === 1) return true;
      if (!state.get(next) && visit(next)) return true;
    }
    state.set(id, 2);
    return false;
  };
  return groups.some((group) => !state.has(group.id) && visit(group.id));
}

function groupDefinitions(data, nodes, edges) {
  const definitions = baseGroups(data, nodes);
  if (definitions.length === 1 && definitions[0].id === '__all__') return definitions;
  const allOrdered = definitions.every((group) => group.id === '__ungrouped__' || group.order !== undefined);
  if (allOrdered) {
    return definitions.slice().sort((a, b) => {
      if (a.id === '__ungrouped__') return 1;
      if (b.id === '__ungrouped__') return -1;
      if (a.order !== b.order) return a.order - b.order;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  return topologicalGroups(definitions, edges, nodes);
}

function findBackEdges(groupNodes, edges) {
  const ids = new Set(groupNodes.map((node) => node.id));
  const adjacency = new Map(groupNodes.map((node) => [node.id, []]));
  for (const edge of edges) if (ids.has(edge.from) && ids.has(edge.to)) adjacency.get(edge.from).push(edge);
  const state = new Map();
  const back = new Set();
  const visit = (id) => {
    state.set(id, 1);
    for (const edge of adjacency.get(id)) {
      if (state.get(edge.to) === 1) back.add(edge);
      else if (!state.get(edge.to)) visit(edge.to);
    }
    state.set(id, 2);
  };
  for (const node of groupNodes) if (!state.has(node.id)) visit(node.id);
  return back;
}

function assignRanks(groupNodes, edges) {
  if (groupNodes.length === 0) return new Map();
  const ids = new Set(groupNodes.map((node) => node.id));
  const internal = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  if (internal.length === 0) return new Map(groupNodes.map((node, index) => [node.id, index]));
  const back = findBackEdges(groupNodes, internal);
  const incoming = new Map(groupNodes.map((node) => [node.id, 0]));
  const outgoing = new Map(groupNodes.map((node) => [node.id, []]));
  for (const edge of internal) {
    if (back.has(edge)) continue;
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }
  const rank = new Map(groupNodes.map((node) => [node.id, 0]));
  const queue = groupNodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift();
    processed += 1;
    for (const next of outgoing.get(id)) {
      rank.set(next, Math.max(rank.get(next), rank.get(id) + 1));
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) queue.push(next);
    }
  }
  return processed === groupNodes.length
    ? rank
    : new Map(groupNodes.map((node, index) => [node.id, index]));
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function pointKey(point) {
  return `${round(point.x)},${round(point.y)}`;
}

function cubicPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 把起终点与控制点封成带 d 与 point(t) 的走线；没有控制点就是一条直线。 */
function buildGeometry({ start, end, c1, c2 }) {
  if (!c1) {
    return { start, end, d: `M${pointKey(start)} L${pointKey(end)}`, point: (t) => ({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    }) };
  }
  return { start, end, c1, c2,
    d: `M${pointKey(start)} C${pointKey(c1)} ${pointKey(c2)} ${pointKey(end)}`,
    point: (t) => cubicPoint(start, c1, c2, end, t) };
}

// 一个节点上挂着好几条线时，它们 MUST NOT 都从同一条边框的正中出入——全挤在一点，
// 箭头叠成一团，看不出哪条线连的是谁。所以分两步：先按走线情形定「走哪条边框」（edgeShape），
// 再把落在同一条边框上的接点沿这条边框排开（assignAnchors）。
// 这两个常量与下面四个分槽函数（anchorRatio / anchorPoint / anchorSortKey / assignAnchors）
// 在 assets/page-shell/app.js 里有一份逐字复制的副本，改这边 MUST 同改那边，否则拖动前后接点会跳；
// 六个符号是否还同解由 tests/edges.test.mjs 的「同源」用例逐个钉住。
const ANCHOR_PAD = 10;
const ANCHOR_SLOT = 18;

/** 同一条边框上第 index 个（共 count 个）接点落在这条边框的哪个比例位置。只有一条线时就是正中。 */
function anchorRatio(index, count, length) {
  if (count <= 1) return 0.5;
  // 摊开的总宽不超过边框减掉两头留白；线少时按 ANCHOR_SLOT 收着排，免得两条线也摊成一把扇子。
  const usable = Math.max(0, length - ANCHOR_PAD * 2);
  const spacing = Math.min(ANCHOR_SLOT, usable / count);
  return 0.5 + ((index - (count - 1) / 2) * spacing) / length;
}

/** 比例位置换成边框线上的实际坐标：接点永远贴在边框上，既不进卡片也不出卡片。 */
function anchorPoint(box, side, ratio) {
  if (side === 'top') return { x: box.x + box.w * ratio, y: box.y };
  if (side === 'bottom') return { x: box.x + box.w * ratio, y: box.y + box.h };
  if (side === 'left') return { x: box.x, y: box.y + box.h * ratio };
  return { x: box.x + box.w, y: box.y + box.h * ratio };
}

/** 同一条边框上谁排前面：看对端在哪边。对端靠上的线接点也靠上，线就不用互相穿过去。 */
function anchorSortKey(side, other) {
  return side === 'left' || side === 'right' ? other.y + other.h / 2 : other.x + other.w / 2;
}

/**
 * 一次算完整张图的接点：按「节点 + 哪条边框」归堆，堆内按对端方位排序，再沿边框均分。
 * 排序 MUST 有确定的 tie-break（这里用边的键 + 是首端还是尾端），
 * 否则同一份描述两次出图排出来的顺序可能不一样，图就不是确定性的了。
 */
function assignAnchors(plans) {
  const bySide = new Map();
  for (const plan of plans) {
    for (const endpoint of [plan.tail, plan.head]) {
      const key = `${endpoint.nodeId}\u0000${endpoint.side}`;
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key).push(endpoint);
    }
  }
  for (const endpoints of bySide.values()) {
    endpoints.sort((a, b) => (a.sortKey - b.sortKey)
      || (a.tieBreak < b.tieBreak ? -1 : a.tieBreak > b.tieBreak ? 1 : 0));
    // 同一桶里的端点按定义就是同一个方块的同一条边框，box 取第一个即可，下面一路用它。
    const { box, side } = endpoints[0];
    const length = side === 'left' || side === 'right' ? box.h : box.w;
    endpoints.forEach((endpoint, index) => {
      endpoint.point = anchorPoint(box, side, anchorRatio(index, endpoints.length, length));
    });
  }
}

// 拖动之后连线由 app.js 在浏览器里重算，那份几何规则里有一份逐字复制的分槽副本。
// 整套都导出来，是为了让测试逐个函数钉住两边同解——只钉常量不够：
// 排序取反或 tie-break 变了，画出来的接点集合还是那几个，只是顺序悄悄错位，测不出来。
export const EDGE_ANCHOR = {
  PAD: ANCHOR_PAD,
  SLOT: ANCHOR_SLOT,
  ratio: anchorRatio,
  point: anchorPoint,
  sortKey: anchorSortKey,
  assign: assignAnchors,
};

/** 五种走线情形各走哪条边框。这里只定「从哪条边出去、从哪条边进来」，具体落点交给分槽器。 */
function edgeShape(from, to, sourceGroup, targetGroup) {
  const sameColumn = sourceGroup.col === targetGroup.col;
  if (sameColumn && to.row === from.row + 1) return { shape: 'adjacent', fromSide: 'bottom', toSide: 'top' };
  if (sameColumn && to.row > from.row + 1) return { shape: 'skip', fromSide: 'bottom', toSide: 'top' };
  if (sameColumn) return { shape: 'loopback', fromSide: 'left', toSide: 'left' };
  if (targetGroup.col > sourceGroup.col) return { shape: 'forward', fromSide: 'right', toSide: 'left' };
  return { shape: 'backward', fromSide: 'top', toSide: 'top' };
}

function pathGeometry(shape, start, end) {
  if (shape === 'adjacent') return buildGeometry({ start, end });
  if (shape === 'skip') {
    return buildGeometry({ start, end,
      c1: { x: start.x + 40, y: start.y + 30 },
      c2: { x: end.x + 40, y: end.y - 30 } });
  }
  if (shape === 'loopback') {
    return buildGeometry({ start, end,
      c1: { x: start.x - 56, y: start.y + 16 },
      c2: { x: end.x - 56, y: end.y - 16 } });
  }
  if (shape === 'forward') {
    const offset = M.COL_GAP * 0.45;
    return buildGeometry({ start, end,
      c1: { x: start.x + offset, y: start.y },
      c2: { x: end.x - offset, y: end.y } });
  }
  return buildGeometry({ start, end,
    c1: { x: start.x, y: start.y - M.ROW_GAP },
    c2: { x: end.x, y: end.y - M.ROW_GAP } });
}

function labelBox(point, size) {
  return { x: point.x - size.w / 2, y: point.y - size.h / 2, w: size.w, h: size.h };
}

// 标注可以落在线上的哪些位置：沿线取一串 t，每个 t 再往法线两侧一格格挪。
// 只试中点那一列位置是不够的——密集区里中点附近整条走廊都被卡片和别人的标注占满，
// 沿线挪开一点往往就有地方，退回原点被卡片盖住是最差的结果。
const LABEL_T_VALUES = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82, 0.12, 0.88, 0.08, 0.92];
// 最远只挪到 96px：再远就认不出这行字是哪条线的了，那还不如老实报一条 warning。
const LABEL_OFFSET_STEP = 8;
const LABEL_OFFSET_STEPS = 12;

/** 曲线上某点的法线：用邻近两点的切线求，这样弯的地方也是真的「垂直于线」让开。 */
function normalAt(geometry, t) {
  const delta = 0.01;
  const before = geometry.point(Math.max(0, t - delta));
  const after = geometry.point(Math.min(1, t + delta));
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

function labelCandidates(geometry) {
  const candidates = [];
  for (const t of LABEL_T_VALUES) {
    const base = geometry.point(t);
    const normal = normalAt(geometry, t);
    for (let step = 0; step <= LABEL_OFFSET_STEPS; step += 1) {
      const distances = step === 0 ? [0] : [step * LABEL_OFFSET_STEP, -step * LABEL_OFFSET_STEP];
      for (const distance of distances) {
        candidates.push({
          point: { x: base.x + normal.x * distance, y: base.y + normal.y * distance },
          // 越靠中点、离线越近越好看，先试代价小的
          cost: Math.abs(distance) + 120 * Math.abs(t - 0.5),
        });
      }
    }
  }
  return candidates.sort((a, b) => a.cost - b.cost);
}

function placeLabel(geometry, size, obstacles, warnings, edge) {
  const fits = (point) => !obstacles.some((obstacle) => intersects(labelBox(point, size), obstacle));
  for (const candidate of labelCandidates(geometry)) {
    if (fits(candidate.point)) return { point: candidate.point, unresolved: false };
  }
  warnings.push(`layout: label overlap at edge ${edge.from}->${edge.to}`);
  return { point: geometry.point(0.5), unresolved: true };
}

/** 根据拓扑描述计算确定性的分组、节点、连线与标签布局。 */
export function layout(data, { lang = 'zh' } = {}) {
  const infoById = new Map((data.information || []).map((item) => [item.id, item]));
  const sourceNodes = Array.isArray(data.nodes) ? data.nodes : [];
  const sourceEdges = Array.isArray(data.edges) ? data.edges : [];
  const groups = groupDefinitions(data, sourceNodes, sourceEdges);
  const groupById = new Map();
  const nodes = new Map();
  const warnings = [];
  let columnX = M.STAGE_PAD;
  const hasUnordered = groups.length > 1 && groups.some((group) => group.order === undefined);
  const orderedGroups = hasUnordered ? topologicalGroups(groups, sourceEdges, sourceNodes) : groups;
  if (hasUnordered && hasGroupCycle(groups, sourceEdges, sourceNodes)) {
    warnings.push('分组之间成环，按你写的顺序排列');
  }
  for (let col = 0; col < orderedGroups.length; col += 1) {
    const group = orderedGroups[col];
    const ranks = assignRanks(group.nodes, sourceEdges);
    const rows = new Map();
    for (const node of group.nodes) {
      const row = ranks.get(node.id) ?? 0;
      if (!rows.has(row)) rows.set(row, []);
      rows.get(row).push(node);
    }
    const sortedRows = [...rows.keys()].sort((a, b) => a - b);
    const rowHeights = new Map(sortedRows.map((row) => [row, Math.max(...rows.get(row).map(nodeHeight))]));
    const rowWidths = new Map(sortedRows.map((row) => [row, rows.get(row).length * M.NODE_W
      + (rows.get(row).length - 1) * 24]));
    const maxRowWidth = Math.max(M.NODE_W, ...rowWidths.values());
    const groupWidth = maxRowWidth + M.GROUP_PAD_X * 2;
    let y = M.STAGE_PAD + M.GROUP_PAD_TOP;
    for (const row of sortedRows) {
      const rowNodes = rows.get(row);
      const startX = columnX + M.GROUP_PAD_X + (maxRowWidth - rowWidths.get(row)) / 2;
      rowNodes.forEach((node, index) => nodes.set(node.id, {
        x: startX + index * (M.NODE_W + 24),
        y,
        w: M.NODE_W,
        h: rowHeights.get(row),
        row,
        col,
      }));
      y += rowHeights.get(row) + M.ROW_GAP;
    }
    const maxBottom = group.nodes.length > 0
      ? Math.max(...group.nodes.map((node) => nodes.get(node.id).y + nodes.get(node.id).h))
      : M.STAGE_PAD + M.GROUP_PAD_TOP;
    groupById.set(group.id, {
      x: columnX,
      y: M.STAGE_PAD,
      w: groupWidth,
      h: Math.max(M.GROUP_PAD_TOP * 2, maxBottom - M.STAGE_PAD + M.GROUP_PAD_TOP),
      name: group.name,
      order: group.order,
      col,
    });
    columnX += groupWidth + M.COL_GAP;
  }
  // 标注要躲的是**看不清**：节点卡片会把它盖住，别的标注会跟它糊在一起。
  // 分组框 MUST NOT 算障碍物——堆内的边整条线都在自己那个框里，把框当障碍就无处可放，
  // 结果是每条标注都退让失败、退回原点，反而比不退让更糟。分组框在最底层，
  // 标注压在它上面照样完整可辨（CSS 的 z-index + 标注自带描边光晕）。
  const obstacles = [...nodes.values()];
  // 接点 MUST 先按全图算完再逐条画：一条边的落点取决于同一条边框上还挂着几条线，
  // 边画边算是算不出来的。
  const plans = [];
  for (const edge of sourceEdges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const sourceGroup = [...groupById.values()].find((group) => group.col === from.col);
    const targetGroup = [...groupById.values()].find((group) => group.col === to.col);
    const { shape, fromSide, toSide } = edgeShape(from, to, sourceGroup, targetGroup);
    const key = `${edge.from}->${edge.to}`;
    plans.push({
      edge,
      shape,
      tail: { nodeId: edge.from, side: fromSide, box: from,
        sortKey: anchorSortKey(fromSide, to), tieBreak: `${key}#tail` },
      head: { nodeId: edge.to, side: toSide, box: to,
        sortKey: anchorSortKey(toSide, from), tieBreak: `${key}#head` },
    });
  }
  assignAnchors(plans);
  const edges = [];
  for (const { edge, shape, tail, head } of plans) {
    const geometry = pathGeometry(shape, tail.point, head.point);
    // 线上写的是「这条线传的是哪几份信息」；什么情况下走这条线移进了浮层。
    const label = edgeLabel(edge, infoById, lang);
    const labelParts = edgeLabelParts(edge, infoById, lang);
    const size = measureLabel(label);
    const placed = placeLabel(geometry, size, obstacles, warnings, edge);
    obstacles.push(labelBox(placed.point, size));
    edges.push({
      from: edge.from,
      to: edge.to,
      d: geometry.d,
      label,
      labelParts,
      labelX: round(placed.point.x),
      labelY: round(placed.point.y),
      labelW: size.w,
      labelH: size.h,
      category: edge.category,
      confidence: edge.confidence,
      color: CATEGORY_COLORS[edge.category] || CATEGORY_COLORS.normal,
      dashed: edge.confidence !== 'certain',
      strokeDasharray: edge.confidence === 'certain' ? null : '5 4',
      marker: CATEGORY_MARKERS[edge.category] || CATEGORY_MARKERS.normal,
      overlapUnresolved: placed.unresolved,
    });
  }
  const extents = [...nodes.values(), ...groupById.values()];
  for (const edge of edges) {
    extents.push({
      x: edge.labelX - edge.labelW / 2,
      y: edge.labelY - edge.labelH / 2,
      w: edge.labelW,
      h: edge.labelH,
    });
    const numbers = edge.d.match(/-?[\d.]+/g).map(Number);
    for (let i = 0; i < numbers.length; i += 2) {
      extents.push({ x: numbers[i], y: numbers[i + 1], w: 0, h: 0 });
    }
  }
  const minX = Math.min(...extents.map((box) => box.x));
  const minY = Math.min(...extents.map((box) => box.y));
  const shiftX = Math.max(0, M.STAGE_PAD - minX);
  const shiftY = Math.max(0, M.STAGE_PAD - minY);
  if (shiftX || shiftY) {
    for (const box of [...nodes.values(), ...groupById.values()]) {
      box.x += shiftX;
      box.y += shiftY;
    }
    for (const edge of edges) {
      edge.labelX += shiftX;
      edge.labelY += shiftY;
      edge.d = edge.d.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, x, y) =>
        `${round(Number(x) + shiftX)},${round(Number(y) + shiftY)}`);
    }
  }
  const maxX = Math.max(M.STAGE_PAD, ...[...groupById.values()].map((box) => box.x + box.w));
  const maxY = Math.max(M.STAGE_PAD, ...[...groupById.values()].map((box) => box.y + box.h));
  return {
    stage: { w: maxX + M.STAGE_PAD, h: maxY + M.STAGE_PAD },
    nodes,
    groups: groupById,
    edges,
    warnings,
  };
}

/** 计算折叠卡片与堆间连线的确定性布局。 */
export function layoutFolded(data, { lang = 'zh' } = {}) {
  const infoById = new Map((data.information || []).map((item) => [item.id, item]));
  const summary = foldSummary(data);
  const cardWidth = 232;
  const cardHeight = 132;
  const gaps = summary.cards.slice(1).map(() => M.COL_GAP);
  const cardIndex = new Map(summary.cards.map((card, index) => [card.id, index]));
  const edgeLabels = summary.interGroupEdges.map((edge) => {
    // 跟全貌图同一套说法：至多 3 份，超出收成「等 N 份」。
    const label = edgeLabel(edge, infoById, lang);
    return { edge, label, size: measureLabel(label) };
  });
  for (const item of edgeLabels) {
    const from = cardIndex.get(item.edge.from);
    const to = cardIndex.get(item.edge.to);
    if (from === undefined || to === undefined) continue;
    const low = Math.min(from, to);
    const high = Math.max(from, to);
    for (let index = low; index < high; index += 1)
      gaps[index] = Math.max(gaps[index], item.size.w + 24);
  }
  const cards = new Map();
  let x = M.STAGE_PAD;
  for (const card of summary.cards) {
    cards.set(card.id, {
      ...card,
      x,
      y: M.STAGE_PAD,
      w: cardWidth,
      h: cardHeight,
      name: card.name,
      nodeCount: card.nodeIds.length,
      innerEdgeCount: card.innerEdgeKeys.length,
      order: cards.size,
    });
    const index = cards.size - 1;
    x += cardWidth + (gaps[index] || 0);
  }
  const warnings = [];
  const placedLabels = [];
  const gapUsage = new Map();
  const edges = edgeLabels.map(({ edge, label, size }) => {
    const from = cards.get(edge.from);
    const to = cards.get(edge.to);
    const start = { x: from.x + from.w, y: from.y + from.h / 2 };
    const end = { x: to.x, y: to.y + to.h / 2 };
    const fromIndex = cardIndex.get(edge.from);
    const toIndex = cardIndex.get(edge.to);
    const gapIndex = Math.min(fromIndex, toIndex);
    const gapLeft = cards.get(summary.cards[gapIndex].id).x + cardWidth;
    const gapRight = cards.get(summary.cards[gapIndex + 1].id).x;
    const labelX = (gapLeft + gapRight) / 2;
    const usage = gapUsage.get(gapIndex) || 0;
    gapUsage.set(gapIndex, usage + 1);
    const baseY = start.y - 12 - usage * 18;
    const obstacles = [...cards.values(), ...placedLabels];
    const fits = (point) => !obstacles.some((obstacle) => intersects(labelBox(point, size), obstacle));
    let point = { x: labelX, y: baseY };
    let unresolved = false;
    if (!fits(point)) {
      let found = false;
      for (let step = 1; step <= 6; step += 1) {
        for (const delta of [-18 * step, 18 * step]) {
          const candidate = { x: labelX, y: baseY + delta };
          if (fits(candidate)) {
            point = candidate;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        unresolved = true;
        warnings.push(`layout: folded label overlap at ${edge.from}->${edge.to}`);
      }
    }
    placedLabels.push(labelBox(point, size));
    return {
      from: edge.from,
      to: edge.to,
      d: `M${round(start.x)},${round(start.y)} L${round(end.x)},${round(end.y)}`,
      label,
      labelX: round(point.x),
      labelY: round(point.y),
      labelW: size.w,
      labelH: size.h,
      category: edge.category,
      confidence: edge.confidence,
      overlapUnresolved: unresolved,
    };
  });
  const maxX = Math.max(M.STAGE_PAD, ...[...cards.values()].map((card) => card.x + card.w));
  const labelExtents = edges.map((edge) => ({
    x: edge.labelX - edge.labelW / 2,
    y: edge.labelY - edge.labelH / 2,
    w: edge.labelW,
    h: edge.labelH,
  }));
  const extents = [...cards.values(), ...labelExtents];
  const minY = Math.min(...extents.map((box) => box.y));
  const shiftY = Math.max(0, M.STAGE_PAD - minY);
  if (shiftY) {
    for (const card of cards.values()) card.y += shiftY;
    for (const edge of edges) {
      edge.labelY += shiftY;
      edge.d = edge.d.replace(/(-?[\d.]+),(-?[\d.]+)/g, (_, xValue, yValue) =>
        `${round(Number(xValue))},${round(Number(yValue) + shiftY)}`);
    }
  }
  const maxY = Math.max(M.STAGE_PAD, ...[...cards.values()].map((card) => card.y + card.h),
    ...edges.map((edge) => edge.labelY + edge.labelH / 2));
  return {
    stage: { w: maxX + M.STAGE_PAD, h: maxY + M.STAGE_PAD },
    cards,
    edges,
    warnings,
  };
}
