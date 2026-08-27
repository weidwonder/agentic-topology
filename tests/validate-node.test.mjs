import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, load } from './helpers.mjs';
import { validate } from '../scripts/lib/validate.mjs';

const run = (name) => {
  const { data, lines } = load(FX(`rules/${name}.topology.yaml`));
  return validate(data, lines);
};

test('基准 fixture 本身必须通过', () => {
  const { data, lines } = load(FX('base.topology.yaml'));
  const r = validate(data, lines);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
  assert.deepEqual(r.stats, { nodes: 4, edges: 4, agents: 1, programs: 2, decisions: 1 });
  assert.equal('checklist_items' in r.stats, false, 'stats 不得含 checklist_items');
});

const CASES = [
  ['R-01', 'E_SCHEMA_VERSION', 'schema_version'],
  ['R-02', 'E_REQUIRED', 'generated_at'],
  ['R-02b', 'E_TYPE', 'generated_at'],
  ['R-03', 'E_UNKNOWN_FIELD', 'nodes[0].foo'],
  ['R-04', 'E_ENUM', 'nodes[0].kind'],
  ['R-05', 'E_REQUIRED', 'graph.exits[0].condition'],
  ['R-06', 'E_REQUIRED', 'nodes[0].outputs'],
  ['R-06b', 'E_TYPE', 'nodes[3].concurrency.max'],
  ['R-07', 'E_REQUIRED', 'nodes[2].mcp'],
  ['R-08', 'E_REQUIRED', 'nodes[0].purpose'],
  ['R-08b', 'E_UNKNOWN_FIELD', 'nodes[0].tools'],
  ['R-09', 'E_CONDITIONAL_REQUIRED', 'nodes[2].subagents'],
  ['R-09b', 'E_DANGLING_SUBAGENT', 'nodes[2].subagents[0].node'],
  ['R-10', 'E_REQUIRED', 'nodes[2].stop.limits.cost'],
  ['R-11', 'E_PROMPT_FORM', 'nodes[2].system_prompt'],
  ['R-11b', 'E_PROMPT_RANGE', 'nodes[2].system_prompt.to'],
  ['R-12', 'E_TYPE', 'nodes[0].source.refs[0]'],
  ['R-12b', 'E_ENUM', 'nodes[0].confidence'],
  ['R-13', 'E_DUP_ID', 'nodes[1].id'],
  ['R-14', 'E_DANGLING_GROUP', 'nodes[0].group'],
  ['R-14b', 'E_DUP_ID', 'groups[1].id'],
];

for (const [name, code, path] of CASES) {
  test(`${name} → ${code} @ ${path}`, () => {
    const r = run(name);
    assert.equal(r.ok, false, `${name} 应当不通过`);
    const hit = r.errors.find((e) => e.code === code && e.path === path);
    assert.ok(hit, `期望 ${code} @ ${path}，实际：${JSON.stringify(r.errors, null, 2)}`);
    assert.equal(typeof hit.line, 'number', '必须给出行号');
    assert.ok(hit.message.length > 0);
  });
}

test('R-12b 的消息要说清「只有文档来源不能标查实了」', () => {
  const hit = run('R-12b').errors.find((e) => e.code === 'E_ENUM');
  assert.match(hit.message, /文档/);
});
