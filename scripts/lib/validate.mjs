const ENUMS = {
  topology: new Set(['peer_loop', 'manager_worker', 'decentralized_handoff', 'fixed_workflow']),
  context_sharing: new Set(['full', 'isolated', 'mixed']),
  exit_kind: new Set(['normal', 'abnormal', 'cancelled']),
  node_kind: new Set(['agent', 'program', 'decision']),
  confidence: new Set(['certain', 'inferred', 'unread']),
};

const COMMON_NODE = new Set([
  'id', 'name', 'kind', 'responsibility', 'inputs', 'outputs', 'concurrency', 'confidence', 'source',
  'group', 'field_confidence', 'purpose', 'system_prompt', 'tools', 'mcp', 'skills', 'stop',
  'spawns_subagents', 'subagents',
]);
const GRAPH_KEYS = new Set(['topology', 'context_sharing', 'entry', 'exits']);
const EXIT_KEYS = new Set(['name', 'kind', 'condition', 'source']);
const SOURCE_KEYS = new Set(['refs', 'confirmed_at', 'doc_only', 'conflict_note']);

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isString(value) { return typeof value === 'string' && value.length > 0; }
function unknown(object, allowed, path, issue) {
  if (!isObject(object)) return;
  for (const key of Object.keys(object)) if (!allowed.has(key)) {
    issue('E_UNKNOWN_FIELD', `${path}.${key}`, `不支持的字段 ${key}`);
  }
}

function sourceCheck(value, path, issue) {
  if (!isObject(value)) { issue('E_REQUIRED', path, 'source 必填'); return; }
  unknown(value, SOURCE_KEYS, path, issue);
  if (!Array.isArray(value.refs) || value.refs.length === 0) issue('E_REQUIRED', `${path}.refs`, 'refs 必填');
  else value.refs.forEach((ref, i) => {
    if (typeof ref !== 'string' || !/^.+:\d+(-\d+)?$/.test(ref)) {
      issue('E_TYPE', `${path}.refs[${i}]`, '来源必须带行号');
    }
  });
  if (!isString(value.confirmed_at)) issue('E_REQUIRED', `${path}.confirmed_at`, 'confirmed_at 必填');
}

function nodeCheck(node, index, groupIds, nodeIds, issue) {
  const path = `nodes[${index}]`;
  if (!isObject(node)) { issue('E_TYPE', path, '节点必须是对象'); return; }
  const agent = node.kind === 'agent';
  const allowed = new Set([
    'id', 'name', 'kind', 'responsibility', 'inputs', 'outputs', 'concurrency', 'confidence', 'source',
    'group', 'field_confidence',
  ]);
  if (agent) {
    ['system_prompt', 'tools', 'mcp', 'skills', 'stop', 'spawns_subagents', 'subagents']
      .forEach((k) => allowed.add(k));
  }
  else allowed.add('purpose');
  unknown(node, allowed, path, issue);
  for (const key of ['id', 'name', 'responsibility', 'inputs', 'outputs']) {
    if (!isString(node[key])) issue('E_REQUIRED', `${path}.${key}`, `${key} 必填`);
  }
  if (!ENUMS.node_kind.has(node.kind)) issue('E_ENUM', `${path}.kind`, 'kind 不在闭集内');
  if (!ENUMS.confidence.has(node.confidence)) issue('E_ENUM', `${path}.confidence`, 'confidence 不在闭集内');
  if (!isObject(node.concurrency)) issue('E_REQUIRED', `${path}.concurrency`, 'concurrency 必填');
  else {
    if (!Number.isInteger(node.concurrency.default) || node.concurrency.default < 1) {
      issue('E_TYPE', `${path}.concurrency.default`, 'default 必须是正整数');
    }
    if ('max' in node.concurrency
      && (!Number.isInteger(node.concurrency.max) || node.concurrency.max < node.concurrency.default)) {
      issue('E_TYPE', `${path}.concurrency.max`, 'max 必须大于等于 default');
    }
  }
  sourceCheck(node.source, `${path}.source`, issue);
  if ('group' in node && !groupIds.has(node.group)) {
    issue('E_DANGLING_GROUP', `${path}.group`, 'group 指向不存在的分组');
  }
  if (!agent && !isString(node.purpose)) issue('E_REQUIRED', `${path}.purpose`, 'purpose 必填');
  if (agent) {
    for (const key of ['system_prompt', 'tools', 'mcp', 'skills', 'stop', 'spawns_subagents']) {
      if (!(key in node)) issue('E_REQUIRED', `${path}.${key}`, `${key} 必填`);
    }
    const prompt = node.system_prompt;
    if (!isObject(prompt)
      || (('inline' in (prompt || {})) === ('file' in (prompt || {})))) {
      issue('E_PROMPT_FORM', `${path}.system_prompt`, 'system_prompt 形态错误');
    }
    else if ('file' in prompt && (!Number.isInteger(prompt.from) || prompt.from < 1
      || !Number.isInteger(prompt.to) || prompt.to < prompt.from)) {
      issue('E_PROMPT_RANGE', `${path}.system_prompt.to`, '行区间错误');
    }
    for (const key of ['tools', 'mcp', 'skills']) {
      if (key in node && (!Array.isArray(node[key]) || node[key].some((v) => typeof v !== 'string'))) {
        issue('E_TYPE', `${path}.${key}`, '必须是字符串数组');
      }
    }
    if (!isObject(node.stop) || !isObject(node.stop.limits)) {
      issue('E_REQUIRED', `${path}.stop.limits`, 'limits 必填');
    } else {
      for (const key of ['steps', 'time', 'cost', 'consecutive_failures']) {
        if (!(key in node.stop.limits)) issue('E_REQUIRED', `${path}.stop.limits.${key}`, `${key} 必填`);
      }
    }
    if (node.spawns_subagents === true && (!Array.isArray(node.subagents) || node.subagents.length === 0)) {
      issue('E_CONDITIONAL_REQUIRED', `${path}.subagents`, '必须列出子代理');
    }
    if (Array.isArray(node.subagents)) {
      node.subagents.forEach((sub, i) => {
        if (!nodeIds.has(sub.node)) issue('E_DANGLING_SUBAGENT', `${path}.subagents[${i}].node`, '子代理不存在');
      });
    }
  }
  if (node.field_confidence && isObject(node.field_confidence)) {
    for (const [key, val] of Object.entries(node.field_confidence)) {
      const target = key.split('.').reduce((current, part) => current?.[part], node);
      if (target === undefined) {
        issue('E_UNKNOWN_FIELD', `${path}.field_confidence.${key}`, '字段可信度指向不存在的字段');
      } else if (!['inferred', 'unread'].includes(val)) {
        issue('E_ENUM', `${path}.field_confidence.${key}`, '字段可信度错误');
      }
    }
  }
}

/** 校验拓扑描述并返回错误、警告与基础统计。 */
export function validate(data, lines = new Map()) {
  const errors = [];
  const warnings = [];
  const issue = (code, path, message) => {
    const parent = path.replace(/(\.\w+|\[\d+\])$/, '');
    errors.push({ code, path, message, line: lines.get(path) ?? lines.get(parent) ?? 1 });
  };
  if (!isObject(data)) {
    return {
      ok: false,
      errors: [{ code: 'E_TYPE', path: '', message: '顶层必须是对象', line: null }],
      warnings,
      stats: {},
    };
  }
  for (const key of [
    'schema_version', 'source_project', 'generated_at', 'analysis_complete', 'graph', 'nodes', 'edges',
  ]) {
    if (!(key in data)) issue('E_REQUIRED', key, `缺少必填项 ${key}`);
  }
  if ('schema_version' in data && data.schema_version !== 1) {
    issue('E_SCHEMA_VERSION', 'schema_version', 'schema_version 必须是 1');
  }
  if ('generated_at' in data && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.generated_at))) {
    issue('E_TYPE', 'generated_at', 'generated_at 必须是 YYYY-MM-DD');
  }
  const graph = data.graph;
  if (!isObject(graph)) issue('E_REQUIRED', 'graph', 'graph 必填');
  else {
    unknown(graph, GRAPH_KEYS, 'graph', issue);
    if (!ENUMS.topology.has(graph.topology)) issue('E_ENUM', 'graph.topology', 'topology 错误');
    if (!ENUMS.context_sharing.has(graph.context_sharing)) {
      issue('E_ENUM', 'graph.context_sharing', 'context_sharing 错误');
    }
    if (!isString(graph.entry)) issue('E_REQUIRED', 'graph.entry', 'entry 必填');
    if (!Array.isArray(graph.exits) || graph.exits.length === 0) {
      issue('E_REQUIRED', 'graph.exits', 'exits 必须非空');
    }
    else graph.exits.forEach((exit, i) => {
      const p = `graph.exits[${i}]`; unknown(exit, EXIT_KEYS, p, issue);
      for (const key of ['name', 'condition']) {
        if (!isString(exit[key])) issue('E_REQUIRED', `${p}.${key}`, `${key} 必填`);
      }
      if (!ENUMS.exit_kind.has(exit.kind)) issue('E_ENUM', `${p}.kind`, 'kind 错误');
      sourceCheck(exit.source, `${p}.source`, issue);
    });
  }
  const groupIds = new Set();
  if (Array.isArray(data.groups)) {
    data.groups.forEach((group, i) => {
      if (groupIds.has(group.id)) issue('E_DUP_ID', `groups[${i}].id`, '分组 id 重复');
      groupIds.add(group.id);
    });
  }
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const nodeIds = new Set();
  nodes.forEach((node, i) => {
    if (nodeIds.has(node?.id)) issue('E_DUP_ID', `nodes[${i}].id`, '节点 id 重复');
    nodeIds.add(node?.id);
  });
  nodes.forEach((node, i) => {
    nodeCheck(node, i, groupIds, nodeIds, issue);
    if (node?.source?.doc_only === true && node.confidence === 'certain') {
      issue('E_ENUM', `nodes[${i}].confidence`, '只有文档来源，不能标查实了');
    }
  });
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const edgeKeys = new Set([
    'from', 'to', 'category', 'trigger', 'carrier', 'carrier_note', 'payloads',
    'concurrency_control', 'screening', 'confidence', 'source', 'field_confidence',
    'bidirectional', 'reverse', 'both_ways',
  ]);
  const payloadKeys = new Set(['content', 'produced_at', 'delivered_at']);
  const seenPairs = new Map();
  edges.forEach((edge, index) => {
    const edgePath = `edges[${index}]`;
    if (!isObject(edge)) {
      issue('E_TYPE', edgePath, '边必须是对象');
      return;
    }
    unknown(edge, edgeKeys, edgePath, issue);
    const requiredEdgeKeys = [
      'from', 'to', 'category', 'trigger', 'carrier', 'payloads', 'concurrency_control', 'confidence', 'source',
    ];
    for (const key of requiredEdgeKeys) {
      if (!(key in edge)) issue('E_REQUIRED', `${edgePath}.${key}`, `${key} 必填`);
    }
    if (!['normal', 'pass_or_skip', 'reject_or_halt'].includes(edge.category)) {
      issue('E_ENUM', `${edgePath}.category`, 'category 错误');
    }
    if (!['file', 'bundle', 'prompt', 'event', 'other'].includes(edge.carrier)) {
      issue('E_ENUM', `${edgePath}.carrier`, 'carrier 错误');
    }
    if (edge.carrier === 'other' && !isString(edge.carrier_note)) {
      issue('E_CONDITIONAL_REQUIRED', `${edgePath}.carrier_note`, 'carrier_note 必填');
    }
    if (!ENUMS.confidence.has(edge.confidence)) {
      issue('E_ENUM', `${edgePath}.confidence`, 'confidence 错误');
    }
    sourceCheck(edge.source, `${edgePath}.source`, issue);
    if (!Array.isArray(edge.payloads) || edge.payloads.length === 0) {
      issue('E_REQUIRED', `${edgePath}.payloads`, 'payloads 必须非空');
    } else {
      edge.payloads.forEach((payload, payloadIndex) => {
        const payloadPath = `${edgePath}.payloads[${payloadIndex}]`;
        unknown(payload, payloadKeys, payloadPath, issue);
        for (const key of payloadKeys) {
          if (!isString(payload?.[key])) issue('E_REQUIRED', `${payloadPath}.${key}`, `${key} 必填`);
        }
      });
    }
    if (!nodeIds.has(edge.from)) issue('E_DANGLING_EDGE', `${edgePath}.from`, '边指向不存在的节点');
    if (!nodeIds.has(edge.to)) issue('E_DANGLING_EDGE', `${edgePath}.to`, '边指向不存在的节点');
    if (edge.from === edge.to) issue('E_SELF_LOOP', edgePath, '边不能连接同一个节点');
    for (const key of ['bidirectional', 'reverse', 'both_ways']) {
      if (key in edge) issue('E_BIDIRECTIONAL', `${edgePath}.${key}`, '请拆成两条单向边');
    }
    const pair = `${edge.from}\u0000${edge.to}`;
    if (seenPairs.has(pair)) {
      const other = seenPairs.get(pair);
      issue('E_DUPLICATE_EDGE', edgePath,
        `${edgePath} 与 edges[${other}] 同向重复；应合并为一条，用多个传递物表达差异`);
      issue('E_DUPLICATE_EDGE', `edges[${other}]`,
        `edges[${other}] 与 ${edgePath} 同向重复；应合并为一条，用多个传递物表达差异`);
    } else {
      seenPairs.set(pair, index);
    }
    if (!('screening' in edge)) warnings.push({ path: `${edgePath}.screening`, message: '未填写筛查条件' });
    if (edge.field_confidence && isObject(edge.field_confidence)) {
      for (const [key, value] of Object.entries(edge.field_confidence)) {
        const target = key.split('.').reduce((current, part) => current?.[part], edge);
        const fieldPath = `${edgePath}.field_confidence.${key}`;
        if (target === undefined) issue('E_UNKNOWN_FIELD', fieldPath, '字段可信度指向不存在的字段');
        else if (!['inferred', 'unread'].includes(value)) issue('E_ENUM', fieldPath, '字段可信度错误');
      }
    }
  });
  nodes.forEach((node, index) => {
    if (node && !('group' in node)) warnings.push({ path: `nodes[${index}].group`, message: '未填写分组' });
  });
  const stats = {
    nodes: nodes.length,
    edges: edges.length,
    agents: nodes.filter((n) => n.kind === 'agent').length,
    programs: nodes.filter((n) => n.kind === 'program').length,
    decisions: nodes.filter((n) => n.kind === 'decision').length,
  };
  return { ok: errors.length === 0, errors, warnings, stats };
}
