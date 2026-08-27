function groupList(data) {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const declared = Array.isArray(data.groups) ? data.groups : [];
  if (declared.length === 0) return [{ id: '__all__', name: '全部', nodes }];
  const groups = declared.map((group) => ({
    id: group.id,
    name: group.name,
    nodes: nodes.filter((node) => node.group === group.id),
  }));
  const ungrouped = nodes.filter((node) => !node.group);
  if (ungrouped.length > 0) groups.push({ id: '__ungrouped__', name: '没标堆的', nodes: ungrouped });
  return groups;
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
    };
  });
  return { cards, interGroupEdges };
}
