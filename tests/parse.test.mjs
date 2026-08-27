import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTopology, TopologyError } from '../scripts/lib/parse.mjs';
import { FX } from './helpers.mjs';

const read = (p) => readFileSync(p, 'utf8');

test('允许的语法全部能正确解析', () => {
  const { data, lines } = parseTopology(read(FX('parse-full.topology.yaml')), 'parse-full.yaml');
  assert.equal(data.schema_version, 1);
  assert.equal(data.analysis_complete, true);
  assert.equal(data.nodes[0].name, '带 # 号的名字');
  assert.equal(data.nodes[0].inputs, '含转义："引号"\t制表\n换行');
  assert.equal(data.nodes[0].outputs, '材料清册与两个指纹');   // 行尾注释被剥掉
  assert.equal(data.nodes[2].system_prompt.inline, '第一行\n第二行\n');   // | 保留结尾换行
  assert.equal(data.nodes[4].system_prompt.inline, '只有一行');           // |- 去掉结尾换行
  assert.equal(data.nodes[4].concurrency.max, null);
  assert.deepEqual(data.nodes[4].tools, []);                              // 空序列字面量
  assert.deepEqual(data.edges, []);
  assert.equal(typeof lines.get('nodes[0].outputs'), 'number');
  assert.ok(lines.get('nodes[0].outputs') > 1);
});

const BAD = [
  ['anchor', /锚点/], ['alias', /引用|别名/], ['flow-map', /流式映射/],
  ['flow-seq', /流式序列/], ['multidoc', /多文档/], ['folded', /折叠块标量/],
  ['tag', /标签/], ['tab-indent', /Tab/],
];
for (const [name, msgRe] of BAD) {
  test(`拒绝不支持的语法：${name}`, () => {
    const err = assert.throws(
      () => parseTopology(read(FX(`syntax/${name}.topology.yaml`)), `${name}.yaml`),
      TopologyError);
    assert.equal(err.code, 'E_SYNTAX');
    assert.equal(typeof err.line, 'number');
    assert.ok(err.line > 1, `行号必须指到犯错那行，实际 ${err.line}`);
    assert.match(err.message, /不支持/);
    assert.match(err.message, msgRe, `消息要说清是哪种语法：${err.message}`);
  });
}

test('空序列字面量 [] 是允许的', () => {
  const { data } = parseTopology('a:\n  - 1\nb: []\n', 'x.yaml');
  assert.deepEqual(data.b, []);
});

test('JSON 输入走原生解析', () => {
  const { data } = parseTopology(read(FX('parse-min.topology.json')), 'parse-min.topology.json');
  assert.equal(data.schema_version, 1);
});

test('BOM 开头报错', () => {
  const err = assert.throws(() => parseTopology('\uFEFFa: 1\n', 'x.yaml'), TopologyError);
  assert.equal(err.code, 'E_SYNTAX');
  assert.match(err.message, /BOM/);
});
