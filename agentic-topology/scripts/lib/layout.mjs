import { baseGroups } from './groups.mjs';
import { measureLabel, wrapLineCount } from './measure.mjs';
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
  // 来回两条边（A→B 与 B→A）各自朝自己的法线让开这么多。两条边方向相反，法线也相反，
  // 同号偏移正好把它们分到路径两侧，看得出是两条独立的线，而不是一条。
  PAIR_OFFSET: 10,
};

// 拖动之后连线由 app.js 在浏览器里重算，那份几何规则 MUST 用同一个错开量，
// 否则同一对来回边在出图时和拖过之后错开的距离不一样，看着像换了张图。
export const EDGE_PAIR_OFFSET = M.PAIR_OFFSET;

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

/**
 * 把整条走线沿弦的法线平移 separation，再封成带 d 与 point(t) 的走线。
 * 平移只取 anchorAxis 那一个方向：起终点是贴在卡片边框上的，另一个方向一挪就会
 * 离开边框——要么缩进卡片下面看不见，要么跟卡片之间空出一道缝，像断了一截。
 * 沿边框滑动则怎么挪都还在边上。这样投影后，弦越接近平行于边框（也就是来回两条线
 * 越容易叠在一起）让开得越足，弦本来就横穿边框时反而不用让——那种情形两条线本来就分得很开。
 */
function buildGeometry({ start, end, c1, c2, anchorAxis }, separation) {
  let a = start;
  let b = end;
  let p1 = c1;
  let p2 = c2;
  if (separation) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const normal = { x: (-dy / length) * separation, y: (dx / length) * separation };
    const shift = anchorAxis === 'x' ? { x: normal.x, y: 0 } : { x: 0, y: normal.y };
    const move = (point) => (point ? { x: point.x + shift.x, y: point.y + shift.y } : point);
    a = move(start);
    b = move(end);
    p1 = move(c1);
    p2 = move(c2);
  }
  if (!p1) {
    return { start: a, end: b, d: `M${pointKey(a)} L${pointKey(b)}`, point: (t) => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    }) };
  }
  return { start: a, end: b, c1: p1, c2: p2,
    d: `M${pointKey(a)} C${pointKey(p1)} ${pointKey(p2)} ${pointKey(b)}`,
    point: (t) => cubicPoint(a, p1, p2, b, t) };
}

function pathGeometry(from, to, sourceGroup, targetGroup, separation = 0) {
  const sameColumn = sourceGroup.col === targetGroup.col;
  if (sameColumn && to.row === from.row + 1) {
    return buildGeometry({
      start: { x: from.x + from.w / 2, y: from.y + from.h },
      end: { x: to.x + to.w / 2, y: to.y },
      anchorAxis: 'x',
    }, separation);
  }
  if (sameColumn && to.row > from.row + 1) {
    const start = { x: from.x + from.w / 2, y: from.y + from.h };
    const end = { x: to.x + to.w / 2, y: to.y };
    return buildGeometry({
      start,
      end,
      c1: { x: start.x + 40, y: start.y + 30 },
      c2: { x: end.x + 40, y: end.y - 30 },
      anchorAxis: 'x',
    }, separation);
  }
  if (sameColumn) {
    const start = { x: from.x, y: from.y + from.h / 2 };
    const end = { x: to.x, y: to.y + to.h / 2 };
    return buildGeometry({
      start,
      end,
      c1: { x: start.x - 56, y: start.y + 16 },
      c2: { x: end.x - 56, y: end.y - 16 },
      anchorAxis: 'y',
    }, separation);
  }
  if (targetGroup.col > sourceGroup.col) {
    const start = { x: from.x + from.w, y: from.y + from.h / 2 };
    const end = { x: to.x, y: to.y + to.h / 2 };
    const offset = M.COL_GAP * 0.45;
    return buildGeometry({
      start,
      end,
      c1: { x: start.x + offset, y: start.y },
      c2: { x: end.x - offset, y: end.y },
      anchorAxis: 'y',
    }, separation);
  }
  const start = { x: from.x + from.w / 2, y: from.y };
  const end = { x: to.x + to.w / 2, y: to.y };
  return buildGeometry({
    start,
    end,
    c1: { x: start.x, y: start.y - M.ROW_GAP },
    c2: { x: end.x, y: end.y - M.ROW_GAP },
    anchorAxis: 'x',
  }, separation);
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
export function layout(data) {
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
  const edgeKeys = new Set(sourceEdges.map((item) => `${item.from}->${item.to}`));
  const edges = [];
  for (const edge of sourceEdges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const sourceGroup = [...groupById.values()].find((group) => group.col === from.col);
    const targetGroup = [...groupById.values()].find((group) => group.col === to.col);
    const paired = edge.from !== edge.to && edgeKeys.has(`${edge.to}->${edge.from}`);
    const geometry = pathGeometry(from, to, sourceGroup, targetGroup, paired ? M.PAIR_OFFSET : 0);
    const fullLabel = String(edge.trigger || '');
    const label = fullLabel.length > 14 ? `${fullLabel.slice(0, 14)}…` : fullLabel;
    const size = measureLabel(label);
    const placed = placeLabel(geometry, size, obstacles, warnings, edge);
    obstacles.push(labelBox(placed.point, size));
    edges.push({
      from: edge.from,
      to: edge.to,
      d: geometry.d,
      label,
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
export function layoutFolded(data) {
  const summary = foldSummary(data);
  const cardWidth = 232;
  const cardHeight = 132;
  const gaps = summary.cards.slice(1).map(() => M.COL_GAP);
  const cardIndex = new Map(summary.cards.map((card, index) => [card.id, index]));
  const edgeLabels = summary.interGroupEdges.map((edge) => {
    const label = `带 ${edge.payloadCount} 样东西`;
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
