import { baseGroups } from './groups.mjs';

function groupList(data) {
  return baseGroups(data, Array.isArray(data.nodes) ? data.nodes : []);
}

function chainNodes(nodes, edges) {
  const ids = new Set(nodes.map((node) => node.id));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    outgoing.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }
  const pending = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const ordered = [];
  while (pending.length > 0) {
    const id = pending.shift();
    ordered.push(id);
    for (const next of outgoing.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) pending.push(next);
    }
  }
  for (const node of nodes) if (!ordered.includes(node.id)) ordered.push(node.id);
  const names = new Map(nodes.map((node) => [node.id, node.name || node.id]));
  return ordered.map((id) => names.get(id)).join(' → ');
}

function majorityCategory(edges) {
  const counts = new Map();
  for (const edge of edges) counts.set(edge.category, (counts.get(edge.category) || 0) + 1);
  let best = 'normal';
  let bestCount = -1;
  for (const [category, count] of counts) {
    if (count > bestCount || (count === bestCount && category === 'normal')) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

function conservativeConfidence(edges) {
  if (edges.some((edge) => edge.confidence === 'unread')) return 'unread';
  if (edges.some((edge) => edge.confidence === 'inferred')) return 'inferred';
  return 'certain';
}

/** 按可信度、执行者类型和分组取交集，返回仍可见的节点与连线键。 */
export function applyFilter(data, { confidence = null, kind = null, group = null } = {}) {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const visibleNodes = nodes.filter((node) => {
    const confidenceMatch = !confidence || confidence.includes(node.confidence);
    const kindMatch = !kind || kind.includes(node.kind);
    const groupMatch = !group || group.includes(node.group);
    return confidenceMatch && kindMatch && groupMatch;
  });
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  return {
    visibleNodeIds: visibleNodes.map((node) => node.id),
    visibleEdgeKeys: edges
      .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
      .map((edge) => `${edge.from}->${edge.to}`),
  };
}

/** 从拓扑数据推导折叠卡片与堆间合并连线，不计算任何坐标。 */
export function foldSummary(data) {
  const groups = groupList(data);
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const nodeGroup = new Map();
  for (const group of groups) for (const node of group.nodes) nodeGroup.set(node.id, group.id);
  const cards = groups.map((group) => {
    const groupEdges = edges.filter((edge) => nodeGroup.get(edge.from) === group.id &&
      nodeGroup.get(edge.to) === group.id);
    return {
      id: group.id,
      name: group.name,
      nodeIds: group.nodes.map((node) => node.id),
      innerEdgeKeys: groupEdges.map((edge) => `${edge.from}->${edge.to}`),
      agents: group.nodes.filter((node) => node.kind === 'agent').length,
      programs: group.nodes.filter((node) => node.kind === 'program').length,
      decisions: group.nodes.filter((node) => node.kind === 'decision').length,
      chain: chainNodes(group.nodes, groupEdges),
    };
  });
  const merged = new Map();
  for (const edge of edges) {
    const from = nodeGroup.get(edge.from);
    const to = nodeGroup.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    if (!merged.has(key)) merged.set(key, []);
    merged.get(key).push(edge);
  }
  const interGroupEdges = [...merged].map(([key, source]) => {
    const [from, to] = key.split('->');
    return {
      from,
      to,
      sourceEdgeKeys: source.map((edge) => `${edge.from}->${edge.to}`),
      payloadCount: source.reduce((sum, edge) => sum + (edge.payloads || []).length, 0),
      category: majorityCategory(source),
      confidence: conservativeConfidence(source),
    };
  });
  return { cards, interGroupEdges };
}
