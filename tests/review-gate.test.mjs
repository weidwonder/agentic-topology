/**
 * 代码评审门查出来的缺口，逐条钉住。
 * 每一条都对应一个当时真的能复现的漏洞——MUST NOT 因为"看着显然"就删掉。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { validate } from '../scripts/lib/validate.mjs';
import { layout } from '../scripts/lib/layout.mjs';
import { foldSummary } from '../scripts/lib/interactions.mjs';
import { data, FX, renderOk } from './helpers.mjs';

const SAMPLE = 'assets/templates/example.topology.yaml';
const run = (...args) => spawnSync('node', args, { encoding: 'utf8' });

// ---- 退出码契约（D 轴 P0）----------------------------------------------------
// 文档三处都写「3 = 语法错或文件读不了」，代码却把读不了归进 1（程序自身异常）。
test('退出码：四种情形逐一对上文档声明的契约', () => {
  mkdirSync('tests/tmp', { recursive: true });
  const cases = [
    [SAMPLE, 0, '正常通过'],
    [FX('rules/R-01.topology.yaml'), 2, '校验不通过'],
    [FX('syntax/anchor.topology.yaml'), 3, '语法错'],
    ['tests/tmp/绝不存在的文件.topology.yaml', 3, '文件读不了'],
    ['tests/fixtures', 3, '传进来的是目录'],
  ];
  for (const [input, expected, what] of cases) {
    const r = run('scripts/validate.mjs', input);
    assert.equal(r.status, expected, `${what}：期望 ${expected}，实际 ${r.status}\n${r.stdout}${r.stderr}`);
  }
});

test('读不了文件时 stderr 说人话，不是把 ENOENT 原样甩出来', () => {
  const r = run('scripts/validate.mjs', 'tests/tmp/绝不存在的文件.topology.yaml');
  assert.match(r.stderr, /读不了这个文件/);
});

// ---- 字段契约：文档承诺过、代码原先没做的四条（D 轴 P1）------------------------
const withSample = (mutate) => {
  const doc = data(SAMPLE);
  mutate(doc);
  return validate(doc);
};
const codesOf = (result) => result.errors.map((e) => e.code);

test('顶层拼错的字段名 MUST 被拦，不能静默忽略', () => {
  const result = withSample((doc) => { doc.typo_field_xyz = '拼错的字段名'; });
  assert.equal(result.ok, false);
  assert.ok(codesOf(result).includes('E_UNKNOWN_FIELD'), '顶层未知字段没被拦住');
  // 反向自查：不加这个字段就该通过，否则上面那条断言可能是别的原因造成的
  assert.equal(validate(data(SAMPLE)).ok, true);
});

test('stop.conditions 文档写「必填」，校验器就 MUST 真的要它', () => {
  const result = withSample((doc) => {
    for (const node of doc.nodes) if (node.stop) delete node.stop.conditions;
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path.endsWith('.stop.conditions')), '缺 conditions 没被拦住');
});

test('stop 下面的未知字段也 MUST 被拦', () => {
  const result = withSample((doc) => {
    for (const node of doc.nodes) if (node.stop) node.stop.limitss = {};
  });
  assert.ok(result.errors.some((e) => e.code === 'E_UNKNOWN_FIELD' && e.path.includes('.stop.')));
});

test('id MUST 符合 ^[A-Za-z0-9_.-]{1,64}$', () => {
  for (const bad of ['节点 N1 中文!', 'has space', 'a'.repeat(65), 'semi;colon']) {
    const result = withSample((doc) => { doc.nodes[0].id = bad; });
    assert.ok(result.errors.some((e) => e.path === 'nodes[0].id' && e.code === 'E_TYPE'),
      `非法 id「${bad}」没被拦住`);
  }
  for (const good of ['N1', 'a.b-c_d', 'A'.repeat(64)]) {
    const result = withSample((doc) => {
      const old = doc.nodes[0].id;
      doc.nodes[0].id = good;
      for (const edge of doc.edges) {
        if (edge.from === old) edge.from = good;
        if (edge.to === old) edge.to = good;
      }
      if (doc.graph.entry === old) doc.graph.entry = good;
    });
    assert.equal(result.errors.some((e) => e.path === 'nodes[0].id'), false, `合法 id「${good}」被误拦`);
  }
});

test('doc_only + certain 的拦截 MUST 对节点、边、exits 三类都生效', () => {
  const targets = [
    ['nodes', (doc) => doc.nodes[0]],
    ['edges', (doc) => doc.edges[0]],
    ['graph.exits', (doc) => doc.graph.exits[0]],
  ];
  for (const [what, pick] of targets) {
    const result = withSample((doc) => {
      const item = pick(doc);
      item.source.doc_only = true;
      item.confidence = 'certain';
    });
    assert.ok(result.errors.some((e) => e.message.includes('不能标查实了')),
      `${what} 上的 doc_only+certain 没被拦住`);
  }
});

// ---- 分组推导两处实现走岔（C 轴 P0）------------------------------------------
test('声明了分组但没有任何节点认领它：主视图与折叠视图 MUST 给出一致的画法', () => {
  const doc = data(FX('base.topology.yaml'));
  doc.groups = [{ id: 'g1', name: '第一堆' }, { id: 'g2', name: '第二堆' }];
  for (const node of doc.nodes) delete node.group;
  const mainIds = [...layout(doc).groups.keys()].sort();
  const foldIds = foldSummary(doc).cards.map((card) => card.id).sort();
  assert.deepEqual(mainIds, foldIds,
    `同一份描述，主视图画成 ${JSON.stringify(mainIds)}、折叠视图画成 ${JSON.stringify(foldIds)}`);
  assert.deepEqual(mainIds, ['__all__'], '没有节点认领分组时就没有分组，两个视图都该并成一堆');
});

// ---- 渲染期的三类告警都要出得来（C 轴 P1）-------------------------------------
test('提示词读不到时，诊断 MUST 出现在 stderr，不能只烂在返回值里', () => {
  mkdirSync('tests/tmp', { recursive: true });
  const broken = 'tests/tmp/broken-prompt.topology.yaml';
  const text = readFileSync(SAMPLE, 'utf8').replace('prompts/planner.v2.md', 'prompts/根本没有这个文件.md');
  writeFileSync(broken, text);
  const r = run('scripts/render.mjs', broken, '-o', 'tests/tmp/broken-prompt.topology.html', '--force');
  assert.equal(r.status, 0, '提示词读不到不该让出图失败');
  assert.match(r.stderr, /prompt: unable to read/, 'stderr 里没有提示词读取失败的诊断');
});

// ---- 折叠视图的「全部展开」按钮（C 轴 P1）-------------------------------------
test('「全部展开」按钮 MUST 真的接了事件，不能只渲染个 DOM', () => {
  const html = renderOk(FX('three-groups.topology.yaml'), 'expand-wired.html');
  assert.match(html, /data-expand/, '按钮没渲染出来');
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.match(script, /\[data-expand\]/, '页面脚本里没有处理 data-expand 的代码——按钮点了没反应');
});

// ---- 样例本身要能用（D 轴 P2）------------------------------------------------
test('样例的提示词文件区间真的能打开，不走「读不到」降级', () => {
  const r = run('scripts/render.mjs', SAMPLE, '-o', 'tests/tmp/sample.topology.html', '--force');
  assert.equal(r.status, 0);
  assert.equal(/prompt: unable to read/.test(r.stderr), false,
    `样例自带的提示词路径打不开：\n${r.stderr}`);
  const html = readFileSync('tests/tmp/sample.topology.html', 'utf8');
  assert.equal(html.includes('读不到这段提示词'), false, '样例的提示词下钻走了降级路径');
});
