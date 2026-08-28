import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseTopology, TopologyError } from '../scripts/lib/parse.mjs';
import { FX, TMP, catchErr } from './helpers.mjs';

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
    const err = catchErr(
      () => parseTopology(read(FX(`syntax/${name}.topology.yaml`)), `${name}.yaml`));
    assert.ok(err instanceof TopologyError, `抛的不是 TopologyError：${err}`);
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
  const err = catchErr(() => parseTopology('\uFEFFa: 1\n', 'x.yaml'));
  assert.ok(err instanceof TopologyError);
  assert.equal(err.code, 'E_SYNTAX');
  assert.match(err.message, /BOM/);
});

test('语法错的 CLI 输出 MUST 带行号（FR-021）', () => {
  mkdirSync('tests/tmp', { recursive: true });
  const bad = 'tests/tmp/tab-indent.topology.yaml';
  writeFileSync(bad, 'schema_version: 1\nsource_project: "x"\ngraph:\n\tbad: tab\n');
  for (const cli of ['scripts/validate.mjs', 'scripts/render.mjs']) {
    const args = cli.includes('render') ? [cli, bad, '-o', TMP('tab.html')] : [cli, bad];
    const r = spawnSync('node', args, { encoding: 'utf8' });
    assert.equal(r.status, 3, `${cli} 退出码应为 3`);
    assert.match(r.stderr, /:4\s/, `${cli} 的错误输出没带行号：${r.stderr}`);
    assert.match(r.stderr, /Tab/, `${cli} 的错误输出没说是什么语法：${r.stderr}`);
  }
});

test('引号标量跨行 MUST 报专门的错并指到引号那一行', () => {
  const e = catchErr(() => parseTopology('schema_version: 1\nname: "第一行\n  第二行"\n', 'x'));
  assert.equal(e.code, 'E_SYNTAX');
  assert.equal(e.line, 2, '应指到引号开始那一行，不是下一行');
  assert.match(e.message, /同一行闭合/);
  assert.match(e.message, /\|/, '应提示改用块标量');
});

test('正常的单双引号标量不受影响', () => {
  const { data } = parseTopology('a: "双引号"\nb: \'单引号\'\nc: 裸标量\n', 'x');
  assert.deepEqual(data, { a: '双引号', b: '单引号', c: '裸标量' });
});

test('引号的几个边界：空串收下，单个引号报未闭合，串中间的引号不误伤', () => {
  assert.deepEqual(parseTopology('a: ""\n', 'x').data, { a: '' });
  assert.deepEqual(parseTopology("b: ''\n", 'x').data, { b: '' });
  assert.deepEqual(parseTopology('e: 裸"中间有引号\n', 'x').data, { e: '裸"中间有引号' });
  for (const src of ['c: "\n', "d: '\n"]) {
    assert.match(catchErr(() => parseTopology(src, 'x')).message, /同一行闭合/, src);
  }
});
