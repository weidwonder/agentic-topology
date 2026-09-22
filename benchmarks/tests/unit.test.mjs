// 直接测内部函数，绕开子进程，跑得快、断言更细。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCaseShape, validateRunShape, bindKey, runCoverageGate, runScopeGate, collectStrings, normalizeLabel,
} from '../benchmark.mjs';

test('normalizeLabel：去首尾空白、合并中间空白、转小写', () => {
  assert.equal(normalizeLabel('  Agent   A  '), 'agent a');
});

test('collectStrings：深度收集所有字符串叶子', () => {
  const strings = collectStrings({ a: '1', b: [{ c: '2' }, '3'], d: { e: { f: '4' } }, g: null, h: 5 });
  assert.deepEqual(strings.sort(), ['1', '2', '3', '4']);
});

function validCaseBase(overrides = {}) {
  return {
    schema_version: 1,
    id: 'x',
    status: 'ready',
    blind_test_eligible: true,
    blind_test_note: '测试夹具',
    required_scope_refs: [],
    required_agent_nodes: [{ key: 'A', labels: ['甲'] }, { key: 'B', labels: ['乙'] }],
    endpoint_aliases: {},
    required_edges: [{ from: 'A', to: 'B' }],
    merge_accounting_required: [],
    ...overrides,
  };
}

test('validateCaseShape：一份完整合法的 case 没有任何错误', () => {
  const errors = validateCaseShape(validCaseBase(), 'x.case.json');
  assert.deepEqual(errors, []);
});

test('validateCaseShape：status: ready 但缺 blind_test_eligible → 报错', () => {
  const c = validCaseBase();
  delete c.blind_test_eligible;
  const errors = validateCaseShape(c, 'x.case.json');
  assert.ok(errors.some((e) => e.includes('blind_test_eligible')));
});

test('validateCaseShape：两个 key 声明了同一个标签 → 报歧义', () => {
  const errors = validateCaseShape(validCaseBase({
    required_agent_nodes: [
      { key: 'A', labels: ['同名'] },
      { key: 'B', labels: ['同名'] },
    ],
  }), 'x.case.json');
  assert.ok(errors.some((e) => e.includes('歧义')));
});

test('validateCaseShape：边引用了自己（自环）→ 报错', () => {
  const errors = validateCaseShape(validCaseBase({
    required_edges: [{ from: 'A', to: 'A' }],
  }), 'x.case.json');
  assert.ok(errors.some((e) => e.includes('自环')));
});

test('validateCaseShape：pending 状态只要求 note，不检查其余字段', () => {
  const errors = validateCaseShape({ schema_version: 1, id: 'x', status: 'pending', note: '还没定' }, 'x.case.json');
  assert.deepEqual(errors, []);
});

test('validateRunShape：合法的 run 没有错误', () => {
  const errors = validateRunShape({
    schema_version: 1,
    case_id: 'x',
    agent: 'a',
    model: 'm',
    attempt: 1,
    generated_at: '2026-09-21',
    protocol: {
      benchmarks_dir_excluded: true,
      harness_outside_worktree: true,
      packaged_skill_root: true,
      repo_commit: 'abc',
      skill_sha256: 'def',
    },
    node_bindings: [],
    ledger_review: [],
    coverage_review: { status: 'passed', reviewer: 'r', defects: [] },
  });
  assert.deepEqual(errors, []);
});

test('validateRunShape：attempt 不是正整数时报错', () => {
  const errors = validateRunShape({
    schema_version: 1, case_id: 'x', agent: 'a', model: 'm', attempt: 0, generated_at: 't',
    protocol: { benchmarks_dir_excluded: true, harness_outside_worktree: true, packaged_skill_root: true, repo_commit: 'a', skill_sha256: 'b' },
    node_bindings: [], ledger_review: [], coverage_review: { status: 'skipped' },
  });
  assert.ok(errors.some((e) => e.includes('attempt')));
});

test('bindKey：候选节点名字精确命中某个声明的等价说法 → 自动绑定', () => {
  const nodes = [{ id: 'n1', name: '规划 Agent', kind: 'agent' }];
  const result = bindKey('planner', ['规划 Agent', 'Planner'], nodes, { requireKind: 'agent', nodeBindings: [] });
  assert.equal(result.status, 'bound');
  assert.equal(result.candidateNodeId, 'n1');
  assert.equal(result.via, 'label');
});

test('bindKey：一个候选节点都没命中、也没有人工绑定 → unbound', () => {
  const nodes = [{ id: 'n1', name: '别的什么', kind: 'agent' }];
  const result = bindKey('planner', ['规划 Agent'], nodes, { requireKind: 'agent', nodeBindings: [] });
  assert.equal(result.status, 'unbound');
});

test('bindKey：两个候选节点都命中同一个标签（歧义）、没有人工绑定裁决 → ambiguous，不擅自选一个', () => {
  const nodes = [
    { id: 'n1', name: '规划 Agent', kind: 'agent' },
    { id: 'n2', name: '规划 Agent', kind: 'agent' },
  ];
  const result = bindKey('planner', ['规划 Agent'], nodes, { requireKind: 'agent', nodeBindings: [] });
  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.candidates.sort(), ['n1', 'n2']);
});

test('bindKey：自动匹配不到，但 run.json 里有带姓名与理由的人工绑定 → bound（via reviewer）', () => {
  const nodes = [{ id: 'n1', name: '完全不一样的名字', kind: 'agent' }];
  const nodeBindings = [{ required_key: 'planner', candidate_node_id: 'n1', reviewer: '张三', rationale: '措辞不同但确实是同一个' }];
  const result = bindKey('planner', ['规划 Agent'], nodes, { requireKind: 'agent', nodeBindings });
  assert.equal(result.status, 'bound');
  assert.equal(result.via, 'reviewer');
});

test('bindKey：人工绑定把必须是 agent 的 key 绑到了 program 节点 → invalid_binding', () => {
  const nodes = [{ id: 'n1', name: '不是 agent', kind: 'program' }];
  const nodeBindings = [{ required_key: 'planner', candidate_node_id: 'n1', reviewer: '张三', rationale: '硬绑' }];
  const result = bindKey('planner', ['规划 Agent'], nodes, { requireKind: 'agent', nodeBindings });
  assert.equal(result.status, 'invalid_binding');
});

function baseCase() {
  return {
    required_agent_nodes: [{ key: 'A', labels: ['甲'] }, { key: 'B', labels: ['乙'] }],
    endpoint_aliases: {},
    required_edges: [{ from: 'A', to: 'B' }],
  };
}

function passingRun() {
  return { node_bindings: [], ledger_review: [], coverage_review: { status: 'passed', reviewer: '张三' } };
}

test('runCoverageGate：候选里显式有那条边 → pass（explicit_edge）', () => {
  const candidate = {
    nodes: [{ id: 'a1', name: '甲', kind: 'agent' }, { id: 'b1', name: '乙', kind: 'agent' }],
    edges: [{ from: 'a1', to: 'b1' }],
  };
  const result = runCoverageGate(baseCase(), candidate, passingRun());
  assert.equal(result.status, 'pass');
  assert.equal(result.edges.by_kind.explicit_edge, 1);
});

test('runCoverageGate：必需 agent 节点没绑上 → fail，不管边怎么样', () => {
  const candidate = { nodes: [{ id: 'a1', name: '甲', kind: 'agent' }], edges: [] };
  const result = runCoverageGate(baseCase(), candidate, passingRun());
  assert.equal(result.status, 'fail');
  assert.equal(result.agent_nodes.failures.length, 1);
  assert.equal(result.agent_nodes.failures[0].key, 'B');
});

test('runScopeGate：required_scope_refs 为空数组时 not_run', () => {
  const result = runScopeGate({ required_scope_refs: [] }, {});
  assert.equal(result.status, 'not_run');
});

test('runScopeGate：候选里任意字符串包含了要求的路径子串即算覆盖', () => {
  const result = runScopeGate(
    { required_scope_refs: [{ path_contains: 'src/foo.ts', why: 'x' }] },
    { nodes: [{ source: { refs: ['src/foo.ts:1-2'] } }] },
  );
  assert.equal(result.status, 'pass');
});
