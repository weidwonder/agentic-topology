import { readFileSync } from 'node:fs';
// 起名 nodePath 而不是 path：文件里几乎每个校验函数都拿 `path` 当「JSON 路径字符串」的局部变量名，
// 两者同名会互相遮蔽，读的人得分心去辨认这一处的 path 到底是哪一个。
import nodePath from 'node:path';
import { fixesFor } from './diagnostics.mjs';

const ENUMS = {
  topology: new Set(['peer_loop', 'manager_worker', 'decentralized_handoff', 'fixed_workflow']),
  context_sharing: new Set(['full', 'isolated', 'mixed']),
  exit_kind: new Set(['normal', 'abnormal', 'cancelled']),
  node_kind: new Set(['agent', 'program', 'decision']),
  confidence: new Set(['certain', 'inferred', 'unread', 'design']),
  // 「它本身是什么形态」六档，比「靠什么交过去」多一档 interface：
  // 一个对外接口本身是一份信息，但没人能把接口当成载体交出去。两个闭集 MUST 分开。
  info_form: new Set(['file', 'bundle', 'prompt', 'interface', 'event', 'other']),
  carrier: new Set(['file', 'bundle', 'prompt', 'event', 'other']),
};

const TOP_KEYS = new Set([
  'schema_version', 'source_project', 'generated_at', 'analysis_complete', 'graph', 'nodes', 'edges', 'groups',
  'information',
]);
// 命名 MUST 以 KEYS 结尾：review-gate.test.mjs 的闭集↔文档漂移守卫按这个后缀扫闭集，
// 换成小驼峰就会被静默漏掉，文档少写一个键也没人发现。
const INFORMATION_KEYS = new Set([
  'id', 'name', 'what', 'blocks', 'form', 'form_note', 'produced_at', 'origin', 'destination',
  'same_as', 'source', 'confidence',
]);
const PAYLOAD_REF_KEYS = new Set(['info', 'carrier', 'carrier_note', 'delivered_at']);
const GRAPH_KEYS = new Set(['topology', 'context_sharing', 'entry', 'exits']);
const STOP_KEYS = new Set(['conditions', 'limits']);
const GROUP_KEYS = new Set(['id', 'name', 'order']);
const ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const EXIT_KEYS = new Set(['name', 'kind', 'condition', 'source']);
const SOURCE_KEYS = new Set(['refs', 'confirmed_at', 'doc_only', 'conflict_note']);

/** 只留字符串 id——有些 Set 在异常输入下会混进 undefined，evidence 里不该把这种噪音当已知 id 报出去。 */
function knownIds(idSet) {
  return [...idSet].filter((id) => typeof id === 'string');
}

/**
 * 提示词文件的总行数，仅用于给 E_PROMPT_RANGE 的 evidence 提供参照。
 * 读不到（没给 baseDir、文件不存在、还没落地）就返回 null——evidence 只放实测到的值，不编。
 */
function promptTotalLines(prompt, baseDir) {
  if (!baseDir || !prompt || typeof prompt.file !== 'string') return null;
  try {
    const text = readFileSync(nodePath.resolve(baseDir, prompt.file), 'utf8');
    return text.split(/\r?\n/).length;
  } catch {
    return null;
  }
}

/**
 * 信息块自身的校验。跨对象的四类问题（悬空引用、孤儿、重复引用、same_as 悬空）
 * 要等 edges 走完才判得了，放在 informationCrossCheck。
 */
function informationCheck(item, index, nodeIds, issue) {
  const path = `information[${index}]`;
  if (!isObject(item)) {
    issue('E_TYPE', path, '信息必须是对象', { actual: typeof item });
    return;
  }
  unknown(item, INFORMATION_KEYS, path, issue);
  for (const key of ['id', 'name', 'what', 'form', 'produced_at', 'origin', 'destination']) {
    if (!isString(item[key])) issue('E_REQUIRED', `${path}.${key}`, `${key} 必填`);
  }
  if (isString(item.id) && !ID_PATTERN.test(item.id)) {
    issue('E_TYPE', `${path}.id`, 'id 格式不合法', { actual: item.id, pattern: ID_PATTERN.source });
  }
  if (!Array.isArray(item.blocks) || item.blocks.length === 0) {
    issue('E_REQUIRED', `${path}.blocks`, 'blocks 必须非空——读不出来就写一条「缺失（没查出来）」',
      { actual: item.blocks });
  } else {
    item.blocks.forEach((block, i) => {
      if (!isString(block)) {
        issue('E_TYPE', `${path}.blocks[${i}]`, '每一块必须是一行文字', { actual: typeof block });
      }
    });
  }
  if (!ENUMS.info_form.has(item.form)) {
    issue('E_ENUM', `${path}.form`, 'form 错误', { actual: item.form, allowed: [...ENUMS.info_form] });
  }
  if (item.form === 'other' && !isString(item.form_note)) {
    issue('E_CONDITIONAL_REQUIRED', `${path}.form_note`, 'form_note 必填',
      { trigger: { field: 'form', value: 'other' } });
  }
  for (const key of ['origin', 'destination']) {
    if (isString(item[key]) && !nodeIds.has(item[key])) {
      issue('E_DANGLING_EDGE', `${path}.${key}`, `${key} 指向不存在的方块`,
        { field: key, actual: item[key], knownIds: knownIds(nodeIds) });
    }
  }
  if (!ENUMS.confidence.has(item.confidence)) {
    issue('E_ENUM', `${path}.confidence`, 'confidence 错误',
      { actual: item.confidence, allowed: [...ENUMS.confidence] });
  }
  sourceCheck(item.source, `${path}.source`, issue);
  docOnlyCheck(item, path, issue);
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isString(value) { return typeof value === 'string' && value.length > 0; }
function unknown(object, allowed, path, issue) {
  if (!isObject(object)) return;
  for (const key of Object.keys(object)) if (!allowed.has(key)) {
    issue('E_UNKNOWN_FIELD', `${path}.${key}`, `不支持的字段 ${key}`, { actual: key, allowed: [...allowed] });
  }
}

/** doc_only 的条目 MUST NOT 标 certain——节点、边、exits 三类同一条规则。 */
function docOnlyCheck(item, path, issue) {
  if (item?.source?.doc_only === true && item.confidence === 'certain') {
    issue('E_ENUM', `${path}.confidence`, '只有文档来源，不能标查实了',
      { actual: 'certain', docOnly: true, allowed: ['inferred', 'unread', 'design'] });
  }
}

function sourceCheck(value, path, issue) {
  if (!isObject(value)) { issue('E_REQUIRED', path, 'source 必填', { actual: typeof value }); return; }
  unknown(value, SOURCE_KEYS, path, issue);
  if (!Array.isArray(value.refs) || value.refs.length === 0) {
    issue('E_REQUIRED', `${path}.refs`, 'refs 必填', { actual: value.refs });
  } else value.refs.forEach((ref, i) => {
    if (typeof ref !== 'string' || !/^.+:\d+(-\d+)?$/.test(ref)) {
      issue('E_TYPE', `${path}.refs[${i}]`, '来源必须带行号', { actual: ref });
    }
  });
  if (!isString(value.confirmed_at)) issue('E_REQUIRED', `${path}.confirmed_at`, 'confirmed_at 必填');
}

function nodeCheck(node, index, groupIds, nodeIds, issue, baseDir) {
  const path = `nodes[${index}]`;
  if (!isObject(node)) { issue('E_TYPE', path, '节点必须是对象', { actual: typeof node }); return; }
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
  if (isString(node.id) && !ID_PATTERN.test(node.id)) {
    issue('E_TYPE', `${path}.id`, 'id 只能用字母、数字、下划线、点、连字符，长度 1-64',
      { actual: node.id, pattern: ID_PATTERN.source });
  }
  if (!ENUMS.node_kind.has(node.kind)) {
    issue('E_ENUM', `${path}.kind`, 'kind 不在闭集内', { actual: node.kind, allowed: [...ENUMS.node_kind] });
  }
  if (!ENUMS.confidence.has(node.confidence)) {
    issue('E_ENUM', `${path}.confidence`, 'confidence 不在闭集内',
      { actual: node.confidence, allowed: [...ENUMS.confidence] });
  }
  if (!isObject(node.concurrency)) issue('E_REQUIRED', `${path}.concurrency`, 'concurrency 必填');
  else {
    if (!Number.isInteger(node.concurrency.default) || node.concurrency.default < 1) {
      issue('E_TYPE', `${path}.concurrency.default`, 'default 必须是正整数', { actual: node.concurrency.default });
    }
    if ('max' in node.concurrency
      && (!Number.isInteger(node.concurrency.max) || node.concurrency.max < node.concurrency.default)) {
      issue('E_TYPE', `${path}.concurrency.max`, 'max 必须大于等于 default',
        { actual: node.concurrency.max, mustBeAtLeast: node.concurrency.default });
    }
  }
  sourceCheck(node.source, `${path}.source`, issue);
  // group 写成 null（或 `group:` 留空）等同于不填——布局与折叠视图本来就这么当，
  // 只有校验器原先不同意，还报「指向不存在的分组」，把人往错方向带。
  if (node.group != null && !groupIds.has(node.group)) {
    issue('E_DANGLING_GROUP', `${path}.group`, `group 指向不存在的分组 ${node.group}`,
      { actual: node.group, knownIds: knownIds(groupIds) });
  }
  if (!agent && !isString(node.purpose)) issue('E_REQUIRED', `${path}.purpose`, 'purpose 必填');
  if (agent) {
    for (const key of ['system_prompt', 'tools', 'mcp', 'skills', 'stop', 'spawns_subagents']) {
      if (!(key in node)) issue('E_REQUIRED', `${path}.${key}`, `${key} 必填`);
    }
    const prompt = node.system_prompt;
    if (!isObject(prompt)
      || (('inline' in (prompt || {})) === ('file' in (prompt || {})))) {
      issue('E_PROMPT_FORM', `${path}.system_prompt`, 'system_prompt 形态错误',
        { actual: isObject(prompt) ? Object.keys(prompt) : prompt });
    }
    else if ('file' in prompt && (!Number.isInteger(prompt.from) || prompt.from < 1
      || !Number.isInteger(prompt.to) || prompt.to < prompt.from)) {
      const totalLines = promptTotalLines(prompt, baseDir);
      issue('E_PROMPT_RANGE', `${path}.system_prompt.to`, '行区间错误',
        { from: prompt.from, to: prompt.to, ...(totalLines != null ? { totalLines } : {}) });
    }
    for (const key of ['tools', 'mcp', 'skills']) {
      if (key in node && (!Array.isArray(node[key]) || node[key].some((v) => typeof v !== 'string'))) {
        issue('E_TYPE', `${path}.${key}`, '必须是字符串数组', { actual: node[key] });
      }
    }
    unknown(node.stop, STOP_KEYS, `${path}.stop`, issue);
    if (!isObject(node.stop) || !Array.isArray(node.stop.conditions) || node.stop.conditions.length === 0) {
      issue('E_REQUIRED', `${path}.stop.conditions`, 'conditions 必填，至少一条：什么情况停');
    }
    if (!isObject(node.stop) || !isObject(node.stop.limits)) {
      issue('E_REQUIRED', `${path}.stop.limits`, 'limits 必填');
    } else {
      for (const key of ['steps', 'time', 'cost', 'consecutive_failures']) {
        if (!(key in node.stop.limits)) issue('E_REQUIRED', `${path}.stop.limits.${key}`, `${key} 必填`);
      }
    }
    if (node.spawns_subagents === true && (!Array.isArray(node.subagents) || node.subagents.length === 0)) {
      issue('E_CONDITIONAL_REQUIRED', `${path}.subagents`, '必须列出子代理',
        { trigger: { field: 'spawns_subagents', value: true } });
    }
    if (Array.isArray(node.subagents)) {
      node.subagents.forEach((sub, i) => {
        if (!nodeIds.has(sub.node)) {
          issue('E_DANGLING_SUBAGENT', `${path}.subagents[${i}].node`, '子代理不存在',
            { actual: sub.node, knownIds: knownIds(nodeIds) });
        }
      });
    }
  }
  if (node.field_confidence && isObject(node.field_confidence)) {
    for (const [key, val] of Object.entries(node.field_confidence)) {
      const target = key.split('.').reduce((current, part) => current?.[part], node);
      if (target === undefined) {
        issue('E_UNKNOWN_FIELD', `${path}.field_confidence.${key}`, '字段可信度指向不存在的字段',
          { actual: key });
      } else if (!['inferred', 'unread', 'design'].includes(val)) {
        issue('E_ENUM', `${path}.field_confidence.${key}`, '字段可信度错误',
          { actual: val, allowed: ['inferred', 'unread', 'design'] });
      }
    }
  }
}

/** 校验拓扑描述并返回错误、警告与基础统计。`baseDir` 可选，仅用于给个别 evidence 提供文件层面的参照。 */
export function validate(data, lines = new Map(), { baseDir } = {}) {
  const errors = [];
  const warnings = [];
  const issue = (code, path, message, evidence = {}) => {
    const parent = path.replace(/(\.\w+|\[\d+\])$/, '');
    errors.push({
      code, path, message, line: lines.get(path) ?? lines.get(parent) ?? 1,
      evidence, supportedFixes: fixesFor(code),
    });
  };
  const warn = (code, path, message, evidence = {}) => {
    const parent = path.replace(/(\.\w+|\[\d+\])$/, '');
    warnings.push({
      code, path, message, line: lines.get(path) ?? lines.get(parent) ?? 1,
      evidence, supportedFixes: fixesFor(code),
    });
  };
  if (!isObject(data)) {
    return {
      ok: false,
      errors: [{
        code: 'E_TYPE', path: '', message: '顶层必须是对象', line: null,
        evidence: { actual: typeof data }, supportedFixes: fixesFor('E_TYPE'),
      }],
      warnings,
      stats: {},
    };
  }
  for (const key of [
    'schema_version', 'source_project', 'generated_at', 'analysis_complete', 'graph', 'nodes', 'edges',
    'information',
  ]) {
    if (!(key in data)) {
      issue('E_REQUIRED', key, key === 'information'
        ? '缺少必填项 information——请先补上信息清单，并让每条线写清它传的是哪几份'
        : `缺少必填项 ${key}`);
    }
  }
  for (const key of Object.keys(data)) {
    if (!TOP_KEYS.has(key)) issue('E_UNKNOWN_FIELD', key, `不支持的字段 ${key}`, { actual: key, allowed: [...TOP_KEYS] });
  }
  if ('schema_version' in data && data.schema_version !== 1) {
    issue('E_SCHEMA_VERSION', 'schema_version', 'schema_version 必须是 1', { actual: data.schema_version });
  }
  if ('generated_at' in data && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.generated_at))) {
    issue('E_TYPE', 'generated_at', 'generated_at 必须是 YYYY-MM-DD', { actual: data.generated_at });
  }
  const graph = data.graph;
  if (!isObject(graph)) issue('E_REQUIRED', 'graph', 'graph 必填');
  else {
    unknown(graph, GRAPH_KEYS, 'graph', issue);
    if (!ENUMS.topology.has(graph.topology)) {
      issue('E_ENUM', 'graph.topology', 'topology 错误', { actual: graph.topology, allowed: [...ENUMS.topology] });
    }
    if (!ENUMS.context_sharing.has(graph.context_sharing)) {
      issue('E_ENUM', 'graph.context_sharing', 'context_sharing 错误',
        { actual: graph.context_sharing, allowed: [...ENUMS.context_sharing] });
    }
    if (!isString(graph.entry)) issue('E_REQUIRED', 'graph.entry', 'entry 必填');
    if (!Array.isArray(graph.exits) || graph.exits.length === 0) {
      issue('E_REQUIRED', 'graph.exits', 'exits 必须非空', { actual: graph.exits });
    }
    else graph.exits.forEach((exit, i) => {
      const p = `graph.exits[${i}]`; unknown(exit, EXIT_KEYS, p, issue);
      for (const key of ['name', 'condition']) {
        if (!isString(exit[key])) issue('E_REQUIRED', `${p}.${key}`, `${key} 必填`);
      }
      if (!ENUMS.exit_kind.has(exit.kind)) {
        issue('E_ENUM', `${p}.kind`, 'kind 错误', { actual: exit.kind, allowed: [...ENUMS.exit_kind] });
      }
      sourceCheck(exit.source, `${p}.source`, issue);
      docOnlyCheck(exit, p, issue);
    });
  }
  const groupIds = new Set();
  if (Array.isArray(data.groups)) {
    data.groups.forEach((group, i) => {
      const path = `groups[${i}]`;
      if (!isObject(group)) { issue('E_TYPE', path, '分组必须是对象', { actual: typeof group }); return; }
      unknown(group, GROUP_KEYS, path, issue);
      for (const key of ['id', 'name']) {
        if (!isString(group[key])) issue('E_REQUIRED', `${path}.${key}`, `${key} 必填`);
      }
      if (isString(group.id) && !ID_PATTERN.test(group.id)) {
        issue('E_TYPE', `${path}.id`, 'id 只能用字母、数字、下划线、点、连字符，长度 1-64',
          { actual: group.id, pattern: ID_PATTERN.source });
      }
      if ('order' in group && !Number.isInteger(group.order)) {
        issue('E_TYPE', `${path}.order`, 'order 必须是整数', { actual: group.order });
      }
      if (groupIds.has(group.id)) issue('E_DUP_ID', `${path}.id`, '分组 id 重复', { actual: group.id });
      groupIds.add(group.id);
    });
  }
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const nodeIds = new Set();
  nodes.forEach((node, i) => {
    if (nodeIds.has(node?.id)) issue('E_DUP_ID', `nodes[${i}].id`, '节点 id 重复', { actual: node?.id });
    nodeIds.add(node?.id);
  });
  nodes.forEach((node, i) => {
    nodeCheck(node, i, groupIds, nodeIds, issue, baseDir);
    docOnlyCheck(node, `nodes[${i}]`, issue);
  });
  const subagentReturns = new Set();
  nodes.forEach((node) => {
    if (!Array.isArray(node?.subagents)) return;
    node.subagents.forEach((subagent) => {
      subagentReturns.add(`${subagent.node}\u0000${node.id}`);
    });
  });
  const information = Array.isArray(data.information) ? data.information
    : ('information' in data && data.information !== undefined ? null : []);
  if (information === null) {
    issue('E_TYPE', 'information', 'information 必须是数组', { actual: typeof data.information });
  }
  const infoList = information || [];
  const infoIds = new Set();
  const infoNames = new Map();
  infoList.forEach((item, index) => {
    const path = `information[${index}]`;
    if (isObject(item) && isString(item.id)) {
      if (infoIds.has(item.id)) issue('E_DUP_ID', `${path}.id`, '信息 id 重复', { actual: item.id });
      infoIds.add(item.id);
    }
    if (isObject(item) && isString(item.name)) {
      // 原样比较，MUST NOT 折叠大小写或空白：描述是人手写的，
      // 静默归一化会把「我明明写了两份」变成「只有一份」。
      if (infoNames.has(item.name)) {
        issue('E_DUP_INFO_NAME', `${path}.name`,
          `信息名「${item.name}」与 information[${infoNames.get(item.name)}] 撞了；图上要靠名字认人，MUST 各起各的名`,
          { actual: item.name, conflictsWith: `information[${infoNames.get(item.name)}]` });
      } else {
        infoNames.set(item.name, index);
      }
    }
    informationCheck(item, index, nodeIds, issue);
  });
  infoList.forEach((item, index) => {
    if (!isObject(item) || !('same_as' in item)) return;
    const path = `information[${index}].same_as`;
    if (!isString(item.same_as)) {
      issue('E_TYPE', path, 'same_as 必须是另一份信息的编号', { actual: item.same_as });
    } else if (item.same_as === item.id) {
      issue('E_SELF_SAME_AS', path, '一份信息不能怀疑自己跟自己是同一份', { actual: item.same_as });
    } else if (!infoIds.has(item.same_as)) {
      issue('E_DANGLING_INFO', path, `「可能与哪份是同一份」指向不存在的信息「${item.same_as}」`,
        { actual: item.same_as, knownIds: [...infoIds] });
    }
  });
  const referenced = new Set();
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const edgeKeys = new Set([
    'from', 'to', 'category', 'trigger', 'payloads',
    'concurrency_control', 'screening', 'confidence', 'source', 'field_confidence',
    'bidirectional', 'reverse', 'both_ways',
  ]);
  const seenPairs = new Map();
  edges.forEach((edge, index) => {
    const edgePath = `edges[${index}]`;
    if (!isObject(edge)) {
      issue('E_TYPE', edgePath, '边必须是对象', { actual: typeof edge });
      return;
    }
    unknown(edge, edgeKeys, edgePath, issue);
    const requiredEdgeKeys = [
      'from', 'to', 'category', 'trigger', 'payloads', 'concurrency_control', 'confidence', 'source',
    ];
    for (const key of requiredEdgeKeys) {
      if (!(key in edge)) issue('E_REQUIRED', `${edgePath}.${key}`, `${key} 必填`);
    }
    if (!['normal', 'pass_or_skip', 'reject_or_halt'].includes(edge.category)) {
      issue('E_ENUM', `${edgePath}.category`, 'category 错误',
        { actual: edge.category, allowed: ['normal', 'pass_or_skip', 'reject_or_halt'] });
    }
    if (!ENUMS.confidence.has(edge.confidence)) {
      issue('E_ENUM', `${edgePath}.confidence`, 'confidence 错误',
        { actual: edge.confidence, allowed: [...ENUMS.confidence] });
    }
    sourceCheck(edge.source, `${edgePath}.source`, issue);
    docOnlyCheck(edge, edgePath, issue);
    if (!Array.isArray(edge.payloads) || edge.payloads.length === 0) {
      issue('E_REQUIRED', `${edgePath}.payloads`, 'payloads 必须非空', { actual: edge.payloads });
    } else {
      const seenRefs = new Set();
      edge.payloads.forEach((payload, payloadIndex) => {
        const payloadPath = `${edgePath}.payloads[${payloadIndex}]`;
        unknown(payload, PAYLOAD_REF_KEYS, payloadPath, issue);
        for (const key of ['info', 'carrier', 'delivered_at']) {
          if (!isString(payload?.[key])) issue('E_REQUIRED', `${payloadPath}.${key}`, `${key} 必填`);
        }
        if (!ENUMS.carrier.has(payload?.carrier)) {
          issue('E_ENUM', `${payloadPath}.carrier`, 'carrier 错误',
            { actual: payload?.carrier, allowed: [...ENUMS.carrier] });
        }
        if (payload?.carrier === 'other' && !isString(payload?.carrier_note)) {
          issue('E_CONDITIONAL_REQUIRED', `${payloadPath}.carrier_note`, 'carrier_note 必填',
            { trigger: { field: 'carrier', value: 'other' } });
        }
        if (isString(payload?.info)) {
          if (!infoIds.has(payload.info)) {
            issue('E_DANGLING_INFO', `${payloadPath}.info`,
              `这条线引用了不存在的信息「${payload.info}」`, { actual: payload.info, knownIds: [...infoIds] });
          } else if (seenRefs.has(payload.info)) {
            issue('E_DUPLICATE_INFO_REF', payloadPath,
              `这条线重复引用了同一份信息「${payload.info}」；一条线上一份只写一次`, { actual: payload.info });
          } else {
            seenRefs.add(payload.info);
            referenced.add(payload.info);
          }
        }
      });
    }
    // evidence 给整条边的 from/to，不只给出错的那一头——「N3 连到 N9，N9 不存在」
    // 比单独一个 actual 更好定位，改的时候不用回头翻这条边另一端写的是谁。
    if (!nodeIds.has(edge.from)) {
      issue('E_DANGLING_EDGE', `${edgePath}.from`, '边指向不存在的节点',
        { from: edge.from, to: edge.to, knownIds: knownIds(nodeIds) });
    }
    if (!nodeIds.has(edge.to)) {
      issue('E_DANGLING_EDGE', `${edgePath}.to`, '边指向不存在的节点',
        { from: edge.from, to: edge.to, knownIds: knownIds(nodeIds) });
    }
    if (edge.from === edge.to) issue('E_SELF_LOOP', edgePath, '边不能连接同一个节点', { actual: edge.to });
    for (const key of ['bidirectional', 'reverse', 'both_ways']) {
      if (key in edge) issue('E_BIDIRECTIONAL', `${edgePath}.${key}`, '请拆成两条单向边', { actual: key });
    }
    const pair = `${edge.from}\u0000${edge.to}`;
    if (seenPairs.has(pair)) {
      const other = seenPairs.get(pair);
      const evidence = { from: edge.from, to: edge.to };
      issue('E_DUPLICATE_EDGE', edgePath,
        `${edgePath} 与 edges[${other}] 同向重复；应合并为一条，用多份信息表达差异`, evidence);
      issue('E_DUPLICATE_EDGE', `edges[${other}]`,
        `edges[${other}] 与 ${edgePath} 同向重复；应合并为一条，用多份信息表达差异`, evidence);
    } else {
      seenPairs.set(pair, index);
    }
    const missingScreening = !isString(edge.screening) || edge.screening.length === 0;
    if (subagentReturns.has(pair) && missingScreening) {
      issue('E_CONDITIONAL_REQUIRED', `${edgePath}.screening`,
        '子代理回传必须填写收下之前的筛查条件', { trigger: { reason: 'subagent_return' } });
    } else if (!('screening' in edge)) {
      warn('W_NO_SCREENING', `${edgePath}.screening`, '未填写筛查条件');
    }
    if (edge.field_confidence && isObject(edge.field_confidence)) {
      for (const [key, value] of Object.entries(edge.field_confidence)) {
        const target = key.split('.').reduce((current, part) => current?.[part], edge);
        const fieldPath = `${edgePath}.field_confidence.${key}`;
        if (target === undefined) {
          issue('E_UNKNOWN_FIELD', fieldPath, '字段可信度指向不存在的字段', { actual: key });
        } else if (!['inferred', 'unread', 'design'].includes(value)) {
          issue('E_ENUM', fieldPath, '字段可信度错误', { actual: value, allowed: ['inferred', 'unread', 'design'] });
        }
      }
    }
  });
  infoList.forEach((item, index) => {
    if (!isObject(item) || !isString(item.id)) return;
    if (!referenced.has(item.id)) {
      issue('E_ORPHAN_INFO', `information[${index}]`,
        `「${item.name || item.id}」没有任何一条线传它；图上看不见的信息 MUST NOT 留在清单里`,
        { actual: item.id });
    }
  });
  nodes.forEach((node, index) => {
    if (node && !('group' in node)) warn('W_NO_GROUP', `nodes[${index}].group`, '未填写分组');
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
