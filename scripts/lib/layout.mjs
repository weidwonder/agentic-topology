import { measureLabel } from './measure.mjs';

const M = {
  NODE_W: 184,
  NODE_MIN_H: 76,
  ROW_GAP: 52,
  COL_GAP: 118,
  GROUP_PAD_X: 24,
  GROUP_PAD_TOP: 26,
  STAGE_PAD: 32,
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

function nodeHeight(node) {
  const responsibility = String(node.responsibility || '');
  const extraLines = Math.max(0, Math.ceil(responsibility.length / 26) - 2);
  const marked = Number(node.concurrency?.default) > 1 || node.spawns_subagents === true;
  return M.NODE_MIN_H + 14 * extraLines + (marked ? 22 : 0);
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
  const declared = Array.isArray(data.groups) ? data.groups : [];
  if (declared.length === 0 || !nodes.some((node) => node.group)) {
    return [{ id: '__all__', name: '全部', order: undefined, nodes }];
  }
  const definitions = declared.map((group) => ({
    id: group.id,
    name: group.name,
    order: group.order,
    nodes: nodes.filter((node) => node.group === group.id),
  }));
  const ungrouped = nodes.filter((node) => !node.group);
  if (ungrouped.length > 0) {
    definitions.push({ id: '__ungrouped__', name: '没标堆的', order: undefined, nodes: ungrouped });
  }
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

function pathGeometry(from, to, sourceGroup, targetGroup) {
  const sameColumn = sourceGroup.col === targetGroup.col;
  if (sameColumn && to.row === from.row + 1) {
    const start = { x: from.x + from.w / 2, y: from.y + from.h };
    const end = { x: to.x + to.w / 2, y: to.y };
    return { start, end, d: `M${pointKey(start)} L${pointKey(end)}`, point: (t) => ({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    }) };
  }
  if (sameColumn && to.row > from.row + 1) {
    const start = { x: from.x + from.w / 2, y: from.y + from.h };
    const end = { x: to.x + to.w / 2, y: to.y };
    const c1 = { x: start.x + 40, y: start.y + 30 };
    const c2 = { x: end.x + 40, y: end.y - 30 };
    return { start, end, c1, c2, d: `M${pointKey(start)} C${pointKey(c1)} ${pointKey(c2)} ${pointKey(end)}`,
      point: (t) => cubicPoint(start, c1, c2, end, t) };
  }
  if (sameColumn) {
    const start = { x: from.x, y: from.y + from.h / 2 };
    const end = { x: to.x, y: to.y + to.h / 2 };
    const c1 = { x: start.x - 56, y: start.y + 16 };
    const c2 = { x: end.x - 56, y: end.y - 16 };
    return { start, end, c1, c2, d: `M${pointKey(start)} C${pointKey(c1)} ${pointKey(c2)} ${pointKey(end)}`,
      point: (t) => cubicPoint(start, c1, c2, end, t) };
  }
  if (targetGroup.col > sourceGroup.col) {
    const start = { x: from.x + from.w, y: from.y + from.h / 2 };
    const end = { x: to.x, y: to.y + to.h / 2 };
    const offset = M.COL_GAP * 0.45;
    const c1 = { x: start.x + offset, y: start.y };
    const c2 = { x: end.x - offset, y: end.y };
    return { start, end, c1, c2, d: `M${pointKey(start)} C${pointKey(c1)} ${pointKey(c2)} ${pointKey(end)}`,
      point: (t) => cubicPoint(start, c1, c2, end, t) };
  }
  const start = { x: from.x + from.w / 2, y: from.y };
  const end = { x: to.x + to.w / 2, y: to.y };
  const c1 = { x: start.x, y: start.y - M.ROW_GAP };
  const c2 = { x: end.x, y: end.y - M.ROW_GAP };
  return { start, end, c1, c2, d: `M${pointKey(start)} C${pointKey(c1)} ${pointKey(c2)} ${pointKey(end)}`,
    point: (t) => cubicPoint(start, c1, c2, end, t) };
}

function labelBox(point, size) {
  return { x: point.x - size.w / 2, y: point.y - size.h / 2, w: size.w, h: size.h };
}

function placeLabel(geometry, size, obstacles, warnings, edge) {
  const base = geometry.point(0.5);
  const dx = geometry.end.x - geometry.start.x;
  const dy = geometry.end.y - geometry.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const attempts = [0];
  for (let step = 1; step <= 6; step += 1) attempts.push(step * 10, -step * 10);
  const fits = (point) => !obstacles.some((obstacle) => intersects(labelBox(point, size), obstacle));
  for (const distance of attempts) {
    const point = { x: base.x + normal.x * distance, y: base.y + normal.y * distance };
    if (fits(point)) return { point, unresolved: false };
  }
  const secondary = geometry.point(0.3);
  for (const distance of attempts) {
    const point = { x: secondary.x + normal.x * distance, y: secondary.y + normal.y * distance };
    if (fits(point)) return { point, unresolved: false };
  }
  warnings.push(`layout: label overlap at edge ${edge.from}->${edge.to}`);
  return { point: base, unresolved: true };
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
  const obstacles = [...nodes.values(), ...groupById.values()];
  const edges = [];
  for (const edge of sourceEdges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;
    const sourceGroup = [...groupById.values()].find((group) => group.col === from.col);
    const targetGroup = [...groupById.values()].find((group) => group.col === to.col);
    const geometry = pathGeometry(from, to, sourceGroup, targetGroup);
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

/** 计算折叠布局占位结果。 */
export function layoutFolded() {
  return { stage: { w: 0, h: 0 }, cards: new Map(), edges: [], warnings: [] };
}
