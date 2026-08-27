/** 校验拓扑描述并返回错误、警告与基础统计。 */
export function validate(data, lines = new Map()) {
  const errors = [];
  const warnings = [];
  const issue = (code, path, message) => errors.push({
    code,
    path,
    message,
    line: lines.get(path) ?? null,
  });
  const required = [
    'schema_version', 'source_project', 'generated_at', 'analysis_complete', 'graph', 'nodes', 'edges',
  ];
  for (const key of required) {
    if (!(key in data)) issue('E_REQUIRED', key, `缺少必填项 ${key}`);
  }
  if ('schema_version' in data && data.schema_version !== 1) {
    issue('E_SCHEMA_VERSION', 'schema_version', 'schema_version 必须是 1');
  }
  if ('generated_at' in data && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.generated_at))) {
    issue('E_TYPE', 'generated_at', 'generated_at 必须是 YYYY-MM-DD');
  }
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const ids = new Set();
  for (const [index, node] of nodes.entries()) {
    const path = `nodes[${index}]`;
    if (ids.has(node.id)) issue('E_DUP_ID', `${path}.id`, '节点 id 重复');
    ids.add(node.id);
  }
  for (const [index, edge] of edges.entries()) {
    if (!ids.has(edge.from)) issue('E_DANGLING_EDGE', `edges[${index}].from`, '边指向不存在的节点');
    if (!ids.has(edge.to)) issue('E_DANGLING_EDGE', `edges[${index}].to`, '边指向不存在的节点');
  }
  const stats = {
    nodes: nodes.length,
    edges: edges.length,
    agents: nodes.filter((node) => node.kind === 'agent').length,
    programs: nodes.filter((node) => node.kind === 'program').length,
    decisions: nodes.filter((node) => node.kind === 'decision').length,
  };
  return { ok: errors.length === 0, errors, warnings, stats };
}
