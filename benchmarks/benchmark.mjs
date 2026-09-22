#!/usr/bin/env node
// 基准套件的唯一入口：check / verify / report / record-failure 四个子命令。
// 零依赖，只用 Node 内置模块（要求 Node ≥ 18）。
//
// 设计上的硬约束（详见 ../README.md）：
// - 覆盖闸对"标签算不算同一个东西"只认 case 里显式列出的等价说法列表（labels），
//   或 run.json 里带姓名与理由的人工绑定；本脚本不做任何子串/关键词式的模糊匹配去猜。
//   猜不出来就是没绑上，如实报「没绑上」，不臆断。
// - 粒度留账的内容是否"说清楚了"是人的判断，不是这段程序的判断——程序只检查
//   run.json 里有没有一条带姓名、带结论的 ledger_review/coverage_review 记录存在，
//   记录写得对不对由留名的人负责，程序不读心。
// - skipped 永远不能升级成 pass；协议判到假就是假，程序不"善意补全"。

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTopology } from '../agentic-topology/scripts/lib/parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- 小工具 ----------

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

function readJsonFile(filePath, label) {
  if (!existsSync(filePath)) throw new InputError(`${label} 不存在：${filePath}`);
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new InputError(`${label} 读取失败（${filePath}）：${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new InputError(`${label} 不是合法 JSON（${filePath}）：${error.message}`);
  }
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function normalizeLabel(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 深度收集一个已解析对象里出现过的全部字符串叶子值。用于机械核对「某个路径有没有被引用过」。 */
function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) collectStrings(value[key], out);
  }
  return out;
}

// ---------- case 文件的结构自检（check 与 verify 共用） ----------

/** 校验一份 case 文件本身的结构是否自洽。返回错误信息数组，空数组即通过。 */
function validateCaseShape(caseData, casePath) {
  const errors = [];
  const err = (msg) => errors.push(`[${casePath}] ${msg}`);

  if (caseData.schema_version !== 1) err(`schema_version 必须是 1`);
  if (!isNonEmptyString(caseData.id)) err(`缺 id`);
  if (!['ready', 'pending'].includes(caseData.status)) err(`status 必须是 ready 或 pending`);

  if (caseData.status === 'pending') {
    if (!isNonEmptyString(caseData.note)) err(`status: pending 时 note 必须说明还差什么`);
    return errors; // pending 的 case 不要求填其余字段
  }

  if (typeof caseData.blind_test_eligible !== 'boolean') {
    err(`blind_test_eligible 必须是布尔值——这个 case 有没有被本技能自己的强制加载文档举过例子，MUST 显式判过一次，不能不填`);
  }
  if (!isNonEmptyString(caseData.blind_test_note)) {
    err(`blind_test_note 必须说明 blind_test_eligible 判断的依据（查了哪些文档、什么时候查的）`);
  }

  const requiredAgentNodes = caseData.required_agent_nodes;
  if (!Array.isArray(requiredAgentNodes) || requiredAgentNodes.length === 0) {
    err(`required_agent_nodes 必须是非空数组（status: ready 时至少要有 1 个必须的 agent 节点）`);
  }
  const endpointAliases = caseData.endpoint_aliases;
  if (endpointAliases !== undefined && (typeof endpointAliases !== 'object' || Array.isArray(endpointAliases))) {
    err(`endpoint_aliases 必须是对象`);
  }

  const agentKeys = new Set();
  const labelOwner = new Map(); // 归一化后的 label -> 属于哪个 key，用来发现同一个 case 内的歧义
  if (Array.isArray(requiredAgentNodes)) {
    for (const [i, entry] of requiredAgentNodes.entries()) {
      const where = `required_agent_nodes[${i}]`;
      if (!entry || typeof entry !== 'object') { err(`${where} 不是对象`); continue; }
      if (!isNonEmptyString(entry.key)) { err(`${where}.key 缺失`); continue; }
      if (agentKeys.has(entry.key)) err(`${where}.key「${entry.key}」重复`);
      agentKeys.add(entry.key);
      if (!Array.isArray(entry.labels) || entry.labels.length === 0) {
        err(`${where}（key=${entry.key}）.labels 必须是非空数组——每个必需节点至少给一个可接受的说法`);
      } else {
        for (const label of entry.labels) {
          if (!isNonEmptyString(label)) { err(`${where}（key=${entry.key}）.labels 里有空项`); continue; }
          const norm = normalizeLabel(label);
          if (labelOwner.has(norm) && labelOwner.get(norm) !== entry.key) {
            err(`标签「${label}」同时被 ${labelOwner.get(norm)} 与 ${entry.key} 声明，case 自己就有歧义`);
          }
          labelOwner.set(norm, entry.key);
        }
      }
    }
  }

  const endpointKeys = new Set();
  if (endpointAliases && typeof endpointAliases === 'object') {
    for (const key of Object.keys(endpointAliases)) {
      if (agentKeys.has(key)) err(`endpoint_aliases 的键「${key}」与 required_agent_nodes 的 key 撞了`);
      endpointKeys.add(key);
      const entry = endpointAliases[key];
      if (!entry || !Array.isArray(entry.labels) || entry.labels.length === 0) {
        err(`endpoint_aliases.${key}.labels 必须是非空数组`);
      } else {
        for (const label of entry.labels) {
          const norm = normalizeLabel(label);
          if (labelOwner.has(norm) && labelOwner.get(norm) !== key) {
            err(`标签「${label}」同时被 ${labelOwner.get(norm)} 与 ${key} 声明，case 自己就有歧义`);
          }
          labelOwner.set(norm, key);
        }
      }
    }
  }

  const allKeys = new Set([...agentKeys, ...endpointKeys]);
  const requiredEdges = caseData.required_edges;
  if (!Array.isArray(requiredEdges) || requiredEdges.length === 0) {
    err(`required_edges 必须是非空数组`);
  } else {
    for (const [i, edge] of requiredEdges.entries()) {
      const where = `required_edges[${i}]`;
      if (!edge || typeof edge !== 'object') { err(`${where} 不是对象`); continue; }
      if (!isNonEmptyString(edge.from) || !isNonEmptyString(edge.to)) { err(`${where} 缺 from/to`); continue; }
      if (edge.from === edge.to) err(`${where} from 与 to 相同（自环），这套契约不允许`);
      if (!allKeys.has(edge.from)) err(`${where}.from「${edge.from}」不在 required_agent_nodes 或 endpoint_aliases 里——边的两端必须都是声明过的必需节点`);
      if (!allKeys.has(edge.to)) err(`${where}.to「${edge.to}」不在 required_agent_nodes 或 endpoint_aliases 里——边的两端必须都是声明过的必需节点`);
    }
  }

  const scopeRefs = caseData.required_scope_refs;
  if (!Array.isArray(scopeRefs)) {
    err(`required_scope_refs 必须是数组（可以是空数组，但字段必须存在）`);
  } else {
    for (const [i, ref] of scopeRefs.entries()) {
      if (!ref || !isNonEmptyString(ref.path_contains)) err(`required_scope_refs[${i}].path_contains 缺失`);
    }
  }

  const mergeAcct = caseData.merge_accounting_required;
  if (!Array.isArray(mergeAcct)) {
    err(`merge_accounting_required 必须是数组（可以是空数组）`);
  } else if (Array.isArray(requiredEdges)) {
    const edgeKeySet = new Set(requiredEdges.filter((e) => e && e.from && e.to).map((e) => `${e.from}->${e.to}`));
    for (const [i, cluster] of mergeAcct.entries()) {
      const where = `merge_accounting_required[${i}]`;
      if (!cluster || !isNonEmptyString(cluster.cluster_key)) { err(`${where}.cluster_key 缺失`); continue; }
      if (!Array.isArray(cluster.applies_to_edges) || cluster.applies_to_edges.length === 0) {
        err(`${where}.applies_to_edges 必须是非空数组`);
        continue;
      }
      for (const pair of cluster.applies_to_edges) {
        const k = `${pair && pair.from}->${pair && pair.to}`;
        if (!edgeKeySet.has(k)) err(`${where}.applies_to_edges 引用了不存在于 required_edges 的边 ${JSON.stringify(pair)}`);
      }
    }
  }

  return errors;
}

// ---------- check ----------

function loadManifest(manifestPath) {
  const manifest = readJsonFile(manifestPath, 'manifest');
  const dir = path.dirname(manifestPath);
  return { manifest, dir };
}

function cmdCheck(flags) {
  const manifestPath = path.resolve(flags.manifest || path.join(HERE, 'manifest.json'));
  const errors = [];
  let manifest;
  try {
    ({ manifest } = loadManifest(manifestPath));
  } catch (error) {
    if (error instanceof InputError) { console.error(error.message); process.exitCode = 2; return; }
    throw error;
  }

  if (manifest.schema_version !== 1) errors.push('manifest.schema_version 必须是 1');
  if (!isNonEmptyString(manifest.id)) errors.push('manifest.id 缺失');
  if (typeof manifest.evidence_eligible !== 'boolean') errors.push('manifest.evidence_eligible 必须是布尔值');
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    errors.push('manifest.cases 必须是非空数组');
  } else {
    const seenIds = new Set();
    for (const [i, entry] of manifest.cases.entries()) {
      const where = `manifest.cases[${i}]`;
      if (!entry || !isNonEmptyString(entry.case)) { errors.push(`${where}.case 缺失`); continue; }
      if (!isNonEmptyString(entry.prompt)) errors.push(`${where}.prompt 缺失`);
      if (!['ready', 'pending'].includes(entry.status)) errors.push(`${where}.status 必须是 ready 或 pending`);

      const caseAbsPath = path.resolve(path.dirname(manifestPath), entry.case);
      if (!existsSync(caseAbsPath)) { errors.push(`${where} 指向的 case 文件不存在：${entry.case}`); continue; }
      const promptAbsPath = path.resolve(path.dirname(manifestPath), entry.prompt);
      if (!existsSync(promptAbsPath)) errors.push(`${where} 指向的 prompt 文件不存在：${entry.prompt}`);

      let caseData;
      try {
        caseData = readJsonFile(caseAbsPath, 'case');
      } catch (error) {
        errors.push(error.message);
        continue;
      }
      if (caseData.id && seenIds.has(caseData.id)) errors.push(`case id「${caseData.id}」在 manifest 里重复出现`);
      if (caseData.id) seenIds.add(caseData.id);
      if (caseData.status && entry.status && caseData.status !== entry.status) {
        errors.push(`${where} 声明 status=${entry.status}，但 case 文件自己写的是 ${caseData.status}——两处必须一致`);
      }
      errors.push(...validateCaseShape(caseData, entry.case));
    }
  }

  if (errors.length === 0) {
    console.log(`check 通过：manifest 与 ${manifest.cases.length} 份 case 自洽。`);
    process.exitCode = 0;
  } else {
    console.error(`check 未通过，共 ${errors.length} 处：`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 2;
  }
}

// ---------- verify ----------

function loadCandidate(candidatePath) {
  if (!existsSync(candidatePath)) throw new InputError(`候选描述不存在：${candidatePath}`);
  const text = readFileSync(candidatePath, 'utf8');
  let parsed;
  try {
    parsed = parseTopology(text, candidatePath);
  } catch (error) {
    throw new InputError(`候选描述解析失败（${candidatePath}）：${error.message}`);
  }
  const data = parsed.data;
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new InputError(`候选描述缺 nodes[] 或 edges[]，不是一份可核的拓扑描述：${candidatePath}`);
  }
  return data;
}

function validateRunShape(run) {
  const errors = [];
  if (run.schema_version !== 1) errors.push('run.schema_version 必须是 1');
  if (!isNonEmptyString(run.case_id)) errors.push('run.case_id 缺失');
  if (!isNonEmptyString(run.agent)) errors.push('run.agent 缺失');
  if (!isNonEmptyString(run.model)) errors.push('run.model 缺失');
  if (!(Number.isInteger(run.attempt) && run.attempt >= 1)) errors.push('run.attempt 必须是 >=1 的整数');
  if (!isNonEmptyString(run.generated_at)) errors.push('run.generated_at 缺失');
  const p = run.protocol;
  if (!p || typeof p !== 'object') {
    errors.push('run.protocol 缺失——公平运行协议的四项声明必须存在（见 README〈公平运行协议〉）');
  } else {
    for (const key of ['benchmarks_dir_excluded', 'harness_outside_worktree', 'packaged_skill_root']) {
      if (typeof p[key] !== 'boolean') errors.push(`run.protocol.${key} 必须是布尔值`);
    }
    if (!isNonEmptyString(p.repo_commit)) errors.push('run.protocol.repo_commit 缺失');
    if (!isNonEmptyString(p.skill_sha256)) errors.push('run.protocol.skill_sha256 缺失');
  }
  if (!Array.isArray(run.node_bindings)) errors.push('run.node_bindings 必须是数组（没有人工绑定就写 []）');
  if (!Array.isArray(run.ledger_review)) errors.push('run.ledger_review 必须是数组（没有需要留账的边就写 []）');
  const cr = run.coverage_review;
  if (!cr || typeof cr !== 'object') {
    errors.push('run.coverage_review 缺失——覆盖闸的人工签署字段必须存在，哪怕填 skipped 也要显式写');
  } else {
    if (!['passed', 'failed', 'skipped'].includes(cr.status)) errors.push('run.coverage_review.status 必须是 passed/failed/skipped 之一');
    if (cr.status !== 'skipped' && !isNonEmptyString(cr.reviewer)) errors.push('run.coverage_review.reviewer 在 status 不是 skipped 时必须填');
    if (cr.defects !== undefined && !Array.isArray(cr.defects)) errors.push('run.coverage_review.defects 必须是数组');
  }
  return errors;
}

function bindKey(key, labels, candidateNodes, { requireKind, nodeBindings }) {
  const wantedLabels = new Set(labels.map(normalizeLabel));
  const wantedKey = normalizeLabel(key);
  const matches = candidateNodes.filter((n) => {
    if (requireKind && n.kind !== requireKind) return false;
    const nameMatch = isNonEmptyString(n.name) && wantedLabels.has(normalizeLabel(n.name));
    const idMatch = isNonEmptyString(n.id) && normalizeLabel(n.id) === wantedKey;
    return nameMatch || idMatch;
  });

  if (matches.length === 1) {
    return { status: 'bound', candidateNodeId: matches[0].id, via: 'label' };
  }

  // 自动匹配得不到唯一结果（0 个或 >1 个歧义）时，只认 run.json 里带姓名与理由的人工绑定，
  // 不由程序自己去猜哪个更像。
  const manual = nodeBindings.find((b) => b && b.required_key === key);
  if (manual) {
    if (!isNonEmptyString(manual.candidate_node_id) || !isNonEmptyString(manual.reviewer) || !isNonEmptyString(manual.rationale)) {
      return { status: 'invalid_binding', reason: `node_bindings 里 required_key=${key} 的记录缺 candidate_node_id/reviewer/rationale` };
    }
    const target = candidateNodes.find((n) => n.id === manual.candidate_node_id);
    if (!target) return { status: 'invalid_binding', reason: `node_bindings 把 ${key} 绑到了候选里不存在的节点 ${manual.candidate_node_id}` };
    if (requireKind && target.kind !== requireKind) {
      return { status: 'invalid_binding', reason: `node_bindings 把必须是 ${requireKind} 的 ${key} 绑到了 kind=${target.kind} 的节点 ${manual.candidate_node_id}` };
    }
    return { status: 'bound', candidateNodeId: manual.candidate_node_id, via: 'reviewer', reviewer: manual.reviewer, rationale: manual.rationale };
  }

  if (matches.length === 0) return { status: 'unbound' };
  return { status: 'ambiguous', candidates: matches.map((m) => m.id) };
}

function runCoverageGate(caseData, candidate, run) {
  const candidateNodes = candidate.nodes.filter((n) => n && isNonEmptyString(n.id));
  const candidateEdgeSet = new Set((candidate.edges || []).filter((e) => e && e.from && e.to).map((e) => `${e.from}->${e.to}`));
  const nodeById = new Map(candidateNodes.map((n) => [n.id, n]));

  const agentBindings = new Map();
  const nodeFailures = [];
  for (const entry of caseData.required_agent_nodes) {
    const result = bindKey(entry.key, entry.labels, candidateNodes, { requireKind: 'agent', nodeBindings: run.node_bindings });
    agentBindings.set(entry.key, result);
    if (result.status !== 'bound') {
      nodeFailures.push({ key: entry.key, reason: result.status, detail: result.reason || result.candidates || null });
    }
  }

  const endpointBindings = new Map();
  const endpointAliases = caseData.endpoint_aliases || {};
  for (const key of Object.keys(endpointAliases)) {
    const result = bindKey(key, endpointAliases[key].labels, candidateNodes, { requireKind: null, nodeBindings: run.node_bindings });
    endpointBindings.set(key, result);
  }

  function resolveEndpoint(key) {
    if (agentBindings.has(key)) return agentBindings.get(key);
    if (endpointBindings.has(key)) return endpointBindings.get(key);
    return { status: 'unbound' };
  }

  const edgeResults = [];
  for (const edge of caseData.required_edges) {
    const fromR = resolveEndpoint(edge.from);
    const toR = resolveEndpoint(edge.to);
    const ledgerEntry = run.ledger_review.find(
      (r) => r && r.edge && r.edge.from === edge.from && r.edge.to === edge.to,
    );

    if (fromR.status === 'bound' && toR.status === 'bound' && fromR.candidateNodeId !== toR.candidateNodeId) {
      if (candidateEdgeSet.has(`${fromR.candidateNodeId}->${toR.candidateNodeId}`)) {
        edgeResults.push({ edge, status: 'pass', via: 'explicit_edge' });
        continue;
      }
      if (ledgerEntry && ledgerEntry.verdict === 'accounted' && isNonEmptyString(ledgerEntry.reviewer)) {
        edgeResults.push({ edge, status: 'pass', via: 'reviewer_resolved', reviewer: ledgerEntry.reviewer });
        continue;
      }
      edgeResults.push({ edge, status: 'fail', reason: 'missing_edge' });
      continue;
    }

    if (fromR.status === 'bound' && toR.status === 'bound' && fromR.candidateNodeId === toR.candidateNodeId) {
      const mergedNode = nodeById.get(fromR.candidateNodeId);
      const hasResponsibilityText = mergedNode && isNonEmptyString(mergedNode.responsibility || mergedNode.purpose);
      if (ledgerEntry && ledgerEntry.verdict === 'accounted' && ledgerEntry.candidate_node_id === fromR.candidateNodeId
          && isNonEmptyString(ledgerEntry.reviewer) && hasResponsibilityText) {
        edgeResults.push({ edge, status: 'pass', via: 'accounted_merge', reviewer: ledgerEntry.reviewer });
        continue;
      }
      edgeResults.push({ edge, status: 'fail', reason: 'unledgered_merge', candidateNodeId: fromR.candidateNodeId });
      continue;
    }

    // 至少一端没能自动绑定或绑定失效：只认 ledger_review 里带姓名、带结论的人工裁决。
    if (ledgerEntry && ledgerEntry.verdict === 'accounted' && isNonEmptyString(ledgerEntry.reviewer)) {
      edgeResults.push({ edge, status: 'pass', via: 'reviewer_resolved', reviewer: ledgerEntry.reviewer });
      continue;
    }
    edgeResults.push({
      edge,
      status: 'fail',
      reason: ledgerEntry ? 'reviewer_flagged_not_accounted' : 'unresolved_edge',
      fromBinding: fromR,
      toBinding: toR,
    });
  }

  const structuralPass = nodeFailures.length === 0 && edgeResults.every((r) => r.status === 'pass');
  const reviewerSignedOff = run.coverage_review.status === 'passed' && isNonEmptyString(run.coverage_review.reviewer);

  let status;
  const reasons = [];
  if (!structuralPass) {
    status = 'fail';
    if (nodeFailures.length) reasons.push(`${nodeFailures.length} 个必需 agent 节点没能绑定`);
    const failedEdges = edgeResults.filter((r) => r.status !== 'pass');
    if (failedEdges.length) reasons.push(`${failedEdges.length} 条必需边没能通过（含未留账的合并）`);
  } else if (!reviewerSignedOff) {
    status = 'fail';
    reasons.push(
      run.coverage_review.status === 'skipped'
        ? 'coverage_review 被标记为 skipped——结构检查全过不代表覆盖闸通过，skipped 不能升级成 pass'
        : `coverage_review.status=${run.coverage_review.status}，未签署为 passed`,
    );
  } else {
    status = 'pass';
  }

  return {
    status,
    reasons,
    agent_nodes: {
      required: caseData.required_agent_nodes.length,
      bound: caseData.required_agent_nodes.length - nodeFailures.length,
      failures: nodeFailures,
    },
    edges: {
      required: caseData.required_edges.length,
      passed: edgeResults.filter((r) => r.status === 'pass').length,
      by_kind: {
        explicit_edge: edgeResults.filter((r) => r.via === 'explicit_edge').length,
        accounted_merge: edgeResults.filter((r) => r.via === 'accounted_merge').length,
        reviewer_resolved: edgeResults.filter((r) => r.via === 'reviewer_resolved').length,
      },
      failures: edgeResults.filter((r) => r.status !== 'pass'),
    },
    structural_pass: structuralPass,
    reviewer_signed_off: reviewerSignedOff,
  };
}

function runScopeGate(caseData, candidate) {
  const refs = caseData.required_scope_refs || [];
  if (refs.length === 0) return { status: 'not_run', reasons: ['case 没有声明 required_scope_refs'] };
  const haystack = collectStrings(candidate);
  const missing = refs.filter((r) => !haystack.some((s) => s.includes(r.path_contains)));
  if (missing.length === 0) return { status: 'pass', missing: [] };
  return {
    status: 'fail',
    missing: missing.map((m) => ({ path_contains: m.path_contains, why: m.why })),
    reasons: [`${missing.length} 处必须覆盖的范围没有出现在候选描述的任何 source.refs 里`],
  };
}

function runValidateGate(candidatePath, skillRoot) {
  if (!/\.ya?ml$/i.test(candidatePath)) {
    return { status: 'not_run', reason: '机械校验闸要求候选是 .topology.yaml 源文件；当前候选不是 .yaml/.yml，跳过' };
  }
  const validatorPath = path.join(skillRoot, 'scripts', 'validate.mjs');
  if (!existsSync(validatorPath)) {
    return { status: 'not_run', reason: `找不到 ${validatorPath}——--skill-root 没有指向一份真实的技能交付物` };
  }
  const result = spawnSync(process.execPath, [validatorPath, candidatePath, '--format', 'json'], { encoding: 'utf8' });
  if (result.error) {
    return { status: 'not_run', reason: `调用 validate.mjs 失败：${result.error.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    return { status: 'fail', reason: 'validate.mjs 的输出不是预期的 JSON', raw_stdout: result.stdout, raw_stderr: result.stderr };
  }
  return {
    status: result.status === 0 && parsed.ok ? 'pass' : 'fail',
    exit_code: result.status,
    detail: parsed,
  };
}

function emitReceipt(receipt) {
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function cmdVerify(flags) {
  try {
    if (!flags.case || !flags.candidate || !flags.run) {
      throw new InputError('verify 需要 --case --candidate --run 三个参数');
    }
    const casePath = path.resolve(flags.case);
    const candidatePath = path.resolve(flags.candidate);
    const runPath = path.resolve(flags.run);
    const skillRoot = path.resolve(flags['skill-root'] || path.join(HERE, '..', 'agentic-topology'));

    const caseData = readJsonFile(casePath, 'case');
    const caseErrors = validateCaseShape(caseData, flags.case);
    if (caseErrors.length) throw new InputError(`case 文件本身不自洽，先跑 check 修好：\n${caseErrors.map((e) => `  - ${e}`).join('\n')}`);
    if (caseData.status === 'pending') {
      throw new InputError(`case「${caseData.id}」还是 pending 状态，没有必需节点/边可核，不能作为证据`);
    }
    if (caseData.blind_test_eligible === false && !flags['allow-compromised-case']) {
      throw new InputError(
        `case「${caseData.id}」已被判定 blind_test_eligible=false（${caseData.blind_test_note}）\n`
        + `这份 case 不能用来出准出证据。只有明确知道自己在做什么（比如自测 benchmark.mjs 本身的判定逻辑）时，\n`
        + `才加 --allow-compromised-case 强行跑；这种收据的 evidence_eligible 会被强制标 false。`,
      );
    }

    const run = readJsonFile(runPath, 'run 元数据');
    const runErrors = validateRunShape(run);
    if (runErrors.length) throw new InputError(`run 元数据不合规：\n${runErrors.map((e) => `  - ${e}`).join('\n')}`);
    if (run.case_id !== caseData.id) {
      throw new InputError(`run.case_id（${run.case_id}）与 case.id（${caseData.id}）对不上，八成是投错了文件`);
    }

    const candidate = loadCandidate(candidatePath);

    // 协议闸：只要结构齐全，就把它当一次「已理解、可评分」的运行来出收据；
    // 协议字段本身是假的时候，不当成输入错误（那样会让违反协议的运行悄悄从证据链里消失），
    // 而是照样出收据、把协议闸判 fail，让它被 report 的失败簇看见。
    const protocolFailures = [];
    if (run.protocol.benchmarks_dir_excluded !== true) protocolFailures.push('benchmarks_dir_excluded 不是 true：跑分时基准目录本身进入了被测 Agent 可见的工作树，防泄题协议已被破坏');
    if (run.protocol.harness_outside_worktree !== true) protocolFailures.push('harness_outside_worktree 不是 true：harness/cases/prompts/参考 fixture 没有被放在模型可见工作树之外');
    if (run.protocol.packaged_skill_root !== true) protocolFailures.push('packaged_skill_root 不是 true：候选没有从打包后的技能根目录生成，不构成公平对比');

    const scope = runScopeGate(caseData, candidate);
    const coverage = runCoverageGate(caseData, candidate, run);
    const validateGate = runValidateGate(candidatePath, skillRoot);

    const gates = {
      protocol: { status: protocolFailures.length ? 'fail' : 'pass', reasons: protocolFailures },
      scope,
      coverage,
      validate: validateGate,
    };

    const firstPassUsable = gates.protocol.status === 'pass'
      && gates.scope.status === 'pass'
      && gates.coverage.status === 'pass'
      && gates.validate.status === 'pass';

    const receipt = {
      schema_version: 1,
      tool: 'agentic-topology-benchmark',
      case_id: caseData.id,
      agent: run.agent,
      model: run.model,
      attempt: run.attempt,
      generated_at: run.generated_at,
      verified_at: new Date().toISOString(),
      evidence_eligible: run.attempt === 1 && caseData.blind_test_eligible !== false,
      gates,
      first_pass_usable: firstPassUsable,
    };
    emitReceipt(receipt);
    process.exitCode = firstPassUsable ? 0 : 1;
  } catch (error) {
    if (error instanceof InputError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

// ---------- record-failure ----------

const FAILURE_REASONS = ['timeout', 'no_candidate', 'provider_error'];

function cmdRecordFailure(flags) {
  try {
    if (!flags.case || !flags.run || !flags.failure) {
      throw new InputError('record-failure 需要 --case --run --failure 三个参数');
    }
    if (!FAILURE_REASONS.includes(flags.failure)) {
      throw new InputError(`--failure 只接受 ${FAILURE_REASONS.join(' / ')}，不允许自造理由`);
    }
    const casePath = path.resolve(flags.case);
    const runPath = path.resolve(flags.run);
    const caseData = readJsonFile(casePath, 'case');
    const caseErrors = validateCaseShape(caseData, flags.case);
    if (caseErrors.length) throw new InputError(`case 文件本身不自洽：\n${caseErrors.map((e) => `  - ${e}`).join('\n')}`);
    if (caseData.blind_test_eligible === false && !flags['allow-compromised-case']) {
      throw new InputError(
        `case「${caseData.id}」已被判定 blind_test_eligible=false（${caseData.blind_test_note}）\n`
        + `不加 --allow-compromised-case 不能对这份 case 出任何收据，哪怕是失败收据。`,
      );
    }

    const run = readJsonFile(runPath, 'run 元数据');
    // 失败收据不要求 coverage_review/node_bindings/ledger_review 齐全——本来就没有候选可评。
    // 但协议字段仍然必须齐全：跑没跑起来是一回事，是不是在合规协议下跑的是另一回事。
    if (!isNonEmptyString(run.case_id) || !isNonEmptyString(run.agent) || !isNonEmptyString(run.model)
        || !(Number.isInteger(run.attempt) && run.attempt >= 1) || !isNonEmptyString(run.generated_at)) {
      throw new InputError('run 元数据缺 case_id/agent/model/attempt/generated_at 中的必填项');
    }
    if (run.case_id !== caseData.id) throw new InputError(`run.case_id 与 case.id 对不上`);
    const p = run.protocol;
    if (!p || typeof p !== 'object') throw new InputError('run.protocol 缺失');

    const receipt = {
      schema_version: 1,
      tool: 'agentic-topology-benchmark',
      case_id: caseData.id,
      agent: run.agent,
      model: run.model,
      attempt: run.attempt,
      generated_at: run.generated_at,
      verified_at: new Date().toISOString(),
      evidence_eligible: run.attempt === 1 && caseData.blind_test_eligible !== false,
      operational_failure: flags.failure,
      gates: {
        protocol: { status: 'not_run', reasons: [] },
        scope: { status: 'not_run', reasons: ['无候选，未产出'] },
        coverage: { status: 'not_run', reasons: ['无候选，未产出'] },
        validate: { status: 'not_run', reason: '无候选，未产出' },
      },
      first_pass_usable: false,
    };
    emitReceipt(receipt);
    process.exitCode = 1;
  } catch (error) {
    if (error instanceof InputError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

// ---------- report ----------

function cmdReport(flags) {
  try {
    if (!flags.results || !flags.manifest) throw new InputError('report 需要 --results --manifest 两个参数');
    const resultsPath = path.resolve(flags.results);
    const manifestPath = path.resolve(flags.manifest);
    if (!existsSync(resultsPath)) throw new InputError(`results 文件不存在：${resultsPath}`);

    const { manifest, dir } = loadManifest(manifestPath);
    const readyCaseIds = [];
    const blindTestIneligibleCaseIds = [];
    for (const entry of manifest.cases || []) {
      if (entry.status !== 'ready') continue;
      const caseAbsPath = path.resolve(dir, entry.case);
      if (!existsSync(caseAbsPath)) continue;
      const caseData = readJsonFile(caseAbsPath, 'case');
      if (!isNonEmptyString(caseData.id)) continue;
      if (caseData.blind_test_eligible === false) {
        blindTestIneligibleCaseIds.push(caseData.id);
        continue; // 泄题的 case 不进入证据矩阵——本来就不该有 evidence_eligible 的收据落在它头上
      }
      readyCaseIds.push(caseData.id);
    }

    const lines = readFileSync(resultsPath, 'utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
    const receipts = [];
    const badLines = [];
    for (const [i, line] of lines.entries()) {
      try {
        receipts.push(JSON.parse(line));
      } catch (error) {
        badLines.push({ line: i + 1, error: error.message });
      }
    }

    const attempt1 = receipts.filter((r) => r.attempt === 1 && r.evidence_eligible === true);
    const configKey = (r) => `${r.agent}::${r.model}`;
    const configs = [...new Set(attempt1.map(configKey))];

    const matrix = [];
    let evidenceEligible = configs.length > 0 && readyCaseIds.length > 0;
    for (const config of configs) {
      for (const caseId of readyCaseIds) {
        const matching = attempt1.filter((r) => configKey(r) === config && r.case_id === caseId);
        const cell = { config, case_id: caseId, attempt1_receipts: matching.length };
        if (matching.length !== 1) evidenceEligible = false;
        matrix.push(cell);
      }
    }
    // 有 case 从未在任何配置下出现过收据，同样不算证据齐全。
    for (const caseId of readyCaseIds) {
      if (!attempt1.some((r) => r.case_id === caseId)) evidenceEligible = false;
    }

    function clusterOf(r) {
      if (r.operational_failure) return `operational:${r.operational_failure}`;
      if (!r.gates) return 'malformed_receipt';
      if (r.gates.protocol && r.gates.protocol.status === 'fail') return 'protocol';
      if (r.gates.scope && r.gates.scope.status === 'fail') return 'scope';
      if (r.gates.coverage && r.gates.coverage.status === 'fail') return 'coverage';
      if (r.gates.validate && r.gates.validate.status === 'fail') return 'validate';
      if (r.first_pass_usable) return 'pass';
      return 'unknown';
    }
    const clusters = {};
    for (const r of receipts) {
      const c = clusterOf(r);
      clusters[c] = (clusters[c] || 0) + 1;
    }

    const summary = {
      schema_version: 1,
      manifest_id: manifest.id,
      ready_case_ids: readyCaseIds,
      blind_test_ineligible_case_ids: blindTestIneligibleCaseIds,
      pending_case_ids: (manifest.cases || []).filter((c) => c.status === 'pending').map((c) => c.case),
      total_receipts: receipts.length,
      malformed_lines: badLines,
      attempt1_receipts: attempt1.length,
      configurations: configs,
      matrix,
      evidence_eligible: evidenceEligible,
      failure_clusters: clusters,
      first_pass_usable_count: receipts.filter((r) => r.first_pass_usable).length,
      note: 'evidenceEligible 仅表示矩阵齐全（每个配置 × 每个 ready case 恰好一条 attempt-1 收据），不代表结果都通过；这是固定诊断样本，不是排行榜。',
    };
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 0;
  } catch (error) {
    if (error instanceof InputError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

// ---------- 入口 ----------

function main() {
  const [, , command, ...rest] = process.argv;
  const { flags } = parseArgs(rest);
  switch (command) {
    case 'check': return cmdCheck(flags);
    case 'verify': return cmdVerify(flags);
    case 'report': return cmdReport(flags);
    case 'record-failure': return cmdRecordFailure(flags);
    default:
      console.error(
        '用法：\n'
        + '  node benchmark.mjs check [--manifest <manifest.json>]\n'
        + '  node benchmark.mjs verify --case <case.json> --candidate <候选.topology.yaml> --run <run.json> [--skill-root <目录>]\n'
        + '  node benchmark.mjs report --results <results.jsonl> --manifest <manifest.json>\n'
        + '  node benchmark.mjs record-failure --case <case.json> --run <run.json> --failure timeout|no_candidate|provider_error\n',
      );
      process.exitCode = command ? 2 : 1;
  }
}

// 只有直接被当命令跑时才执行；被测试当模块 import 时不触发 CLI（也就不会污染测试自己的 exitCode）。
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) main();

export { validateCaseShape, validateRunShape, bindKey, runCoverageGate, runScopeGate, collectStrings, normalizeLabel };
