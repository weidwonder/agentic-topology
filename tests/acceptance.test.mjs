import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { FX, TMP, load, renderOk, dataOf, sect, bodyText, walk } from './helpers.mjs';
import { validate } from '../scripts/lib/validate.mjs';

const FXP = FX('aiudit-internal-control.topology.yaml');

test('试跑清单 fixture 校验通过：10 节点 14 边 2 个 AI', () => {
  const { data, lines } = load(FXP);
  const r = validate(data, lines);
  assert.equal(r.ok, true, JSON.stringify(r.errors, null, 2));
  assert.deepEqual(r.stats, { nodes: 10, edges: 14, agents: 2, programs: 8, decisions: 0 });
});

test('同向合并的那条边带 2 个传递物', () => {
  const { data } = load(FXP);
  const e = data.edges.find((x) => x.from === 'N6' && x.to === 'N8');
  assert.ok(e, '缺 N6→N8');
  assert.equal(e.payloads.length, 2, '补交提醒与取消信号必须合成一条边、两个传递物');
  assert.equal(data.edges.filter((x) => x.from === 'N6' && x.to === 'N8').length, 1);
});

test('出图成功且内容正确', () => {
  const html = renderOk(FXP, 'acc.html');
  const d = dataOf(html);
  assert.equal(d.nodes.length, 10);
  assert.equal(d.edges.length, 14);
  assert.match(html, /<!doctype html>/i);
  const ov = sect(html, 'view-overview');
  for (const id of ['N1','N2','N3','N4','N5','N6','N7','N8','N9','N10'])
    assert.match(ov, new RegExp(`data-node-id="${id}"`), `图上缺 ${id}`);
});

test('出图耗时 < 5 秒', () => {
  const t0 = Date.now();
  const r = spawnSync('node', ['scripts/render.mjs', FXP, '-o', TMP('acc.html'), '--force']);
  assert.equal(r.status, 0);
  const ms = Date.now() - t0;
  assert.ok(ms < 5000, `耗时 ${ms}ms`);
});

test('两次运行产出逐字节相同', () => {
  for (const n of ['a1', 'a2']) {
    const r = spawnSync('node', ['scripts/render.mjs', FXP, '-o', TMP(`${n}.html`), '--force']);
    assert.equal(r.status, 0);
  }
  assert.equal(readFileSync(TMP('a1.html'), 'utf8'), readFileSync(TMP('a2.html'), 'utf8'));
});

test('零依赖', () => {
  assert.deepEqual(JSON.parse(readFileSync('package.json', 'utf8')).dependencies, {});
});

// 写文件的四类动作。断言挂在「调用形态」与「从 node:fs 导入」两处，
// 而不是裸子串——裸子串会把 renamedFrom 这种正常字段名也误伤（spec §7.2 Invariant 1）。
const WRITE_CALLS = [/\bwriteFile(Sync)?\s*\(/, /\bappendFile(Sync)?\s*\(/,
  /\bcreateWriteStream\s*\(/, /\brename(Sync)?\s*\(/, /\bmkdir(Sync)?\s*\(/];
const WRITE_NAMES = ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync',
  'createWriteStream', 'rename', 'renameSync', 'mkdir', 'mkdirSync'];

test('唯一写点（AC-036）', () => {
  const files = walk('scripts', (p) => !p.endsWith('write-output.mjs'));
  for (const f of files.filter((p) => p.endsWith('.mjs'))) {
    const t = readFileSync(f, 'utf8');
    for (const bad of WRITE_CALLS)
      assert.ok(!bad.test(t), `${f} 出现了写文件调用 ${bad}`);
    for (const line of t.split('\n')) {
      if (!/from\s+'node:fs(\/promises)?'/.test(line)) continue;
      const bound = (line.match(/\{([^}]*)\}/) || [, ''])[1].split(',').map((n) => n.trim());
      for (const name of bound)
        assert.ok(!WRITE_NAMES.includes(name), `${f} 从 node:fs 导入了写文件函数 ${name}`);
    }
  }
});

test('唯一写点断言本身抓得住（反向自检）', () => {
  const sneaky = "import { rename } from 'node:fs/promises';\nawait rename(a, b);\n";
  assert.ok(WRITE_CALLS.some((re) => re.test(sneaky)), '调用形态没抓住');
  const line = sneaky.split('\n')[0];
  const bound = (line.match(/\{([^}]*)\}/) || [, ''])[1].split(',').map((n) => n.trim());
  assert.ok(bound.some((n) => WRITE_NAMES.includes(n)), '导入形态没抓住');
});

test('交付物不引用任何其他 skill（AC-035）', () => {
  const files = walk('.', (p) =>
    !/^\.\/(docs|engineering-context|node_modules|tests\/tmp)/.test(p) &&
    !/^tests\/tmp\//.test(p) &&
    !p.includes('/.git/') && !p.includes('/.claude/') && !p.includes('/.agents/') &&
    !p.includes('/.worktrees/') && p !== './CLAUDE.md' && p !== './AGENTS.md' &&
    p !== './tests/acceptance.test.mjs' && p !== 'tests/acceptance.test.mjs');
  for (const f of files) {
    if (!/\.(md|mjs|js|css|html|json|yaml)$/.test(f)) continue;
    const t = readFileSync(f, 'utf8');
    for (const s of ['agentic-principle', 'ai-prd', 'darwin-skill', 'skill-reviewer'])
      assert.ok(!t.includes(s), `${f} 引用了其他 skill：${s}`);
  }
});

test('界面白话表覆盖 spec §10.1 全部 key', () => {
  const t = readFileSync('references/界面用语表.md', 'utf8');
  for (const k of ['nodes','edges','kind','concurrency','payloads','concurrency_control','screening',
                   'group','confidence','certain','inferred','unread','not_set','stop','topology',
                   'context_sharing','subagents','entry','exits','carrier','bundle','category',
                   'mcp','skills','tools'])
    assert.ok(t.includes(k), `界面用语表缺 key：${k}`);
});

test('样例描述本身校验通过', () => {
  const r = spawnSync('node', ['scripts/validate.mjs', 'assets/templates/example.topology.yaml']);
  assert.equal(r.status, 0);
});

test('界面白话与标识符不翻译（在真实数据上）', () => {
  const html = renderOk(FXP, 'acc.html');
  const body = bodyText(html);
  for (const w of ['节点', '传递物', '并发数', '可信度', '载体', '结构体'])
    assert.ok(!body.includes(w), `界面正文出现了契约词「${w}」`);
  for (const id of ['read', 'grep', 'todo_write', 'agent_fs'])
    assert.ok(html.includes(id), `标识符 ${id} 被翻译或丢失了`);
});
