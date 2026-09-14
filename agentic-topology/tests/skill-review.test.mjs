/**
 * skill 评审门查出来的问题，逐条钉住。
 * 其中安装器护栏那几条是安全项——它们挡的是「一条命令删掉使用者的工作目录」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { install } from '../bin/install.mjs';

const ROOT = process.cwd();
const run = (...args) => spawnSync(process.execPath, args, { encoding: 'utf8' });
const sandbox = (name) => {
  const dir = path.join('tests/tmp', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
};

// ---- 安装器护栏（评审 P0：--dir . 会静默清空使用者的工作目录）--------------
test('install MUST 拒绝会删掉调用者工作目录的目标', async () => {
  const cwd = sandbox('guard-cwd');
  writeFileSync(path.join(cwd, 'my-work.txt'), '使用者的重要文件');
  for (const dir of ['.', '..', '/']) {
    await assert.rejects(
      () => install({ root: ROOT, agent: 'claude', dir, cwd }),
      (error) => /不能装到/.test(error.message),
      `--dir ${dir} 没被拦住`);
  }
  assert.ok(existsSync(path.join(cwd, 'my-work.txt')), '使用者的文件被删了');
});

test('install MUST 拒绝覆盖一个不是自己装出来的已有目录', async () => {
  const cwd = sandbox('guard-foreign');
  const victim = path.join(cwd, 'someones-data');
  mkdirSync(victim, { recursive: true });
  writeFileSync(path.join(victim, 'critical.txt'), '别人的重要数据');
  await assert.rejects(
    () => install({ root: ROOT, agent: 'claude', dir: 'someones-data', cwd }),
    (error) => /已经存在.*不是本技能装出来的/s.test(error.message));
  assert.equal(readFileSync(path.join(victim, 'critical.txt'), 'utf8'), '别人的重要数据',
    '拒绝之后仍然把文件删了');
});

test('install MUST 拒绝装到本技能源码目录的上层', async () => {
  const cwd = sandbox('guard-root');
  await assert.rejects(
    () => install({ root: ROOT, agent: 'claude', dir: path.resolve(ROOT, '..'), cwd }),
    (error) => /不能装到/.test(error.message));
});

test('正常安装与重装照常放行', async () => {
  const cwd = sandbox('guard-happy');
  const first = await install({ root: ROOT, agent: 'claude', cwd });
  assert.equal(first.replaced, false);
  assert.ok(first.files > 10);
  const again = await install({ root: ROOT, agent: 'claude', cwd });
  assert.equal(again.replaced, true, '重装应当识别出目标是自己上次装的');
});

// ---- 确定性：范围要说准（评审 P0：过期提示让「逐字节相同」不成立）----------
test('描述与被分析项目都没变时，两次渲染逐字节相同', () => {
  const cwd = sandbox('det-stable');
  const proj = path.join(cwd, 'proj', 'src');
  mkdirSync(proj, { recursive: true });
  const source = path.join(proj, 'workflow.ts');
  writeFileSync(source, 'export const x = 1');
  utimesSync(source, new Date('2026-01-01'), new Date('2026-01-01'));

  const desc = path.join(cwd, 'd.topology.yaml');
  writeFileSync(desc, readFileSync('assets/templates/example.topology.yaml', 'utf8')
    .replace(/^source_project:.*$/m, `source_project: "${path.resolve(cwd, 'proj')}"`)
    .replace(/^generated_at:.*$/m, 'generated_at: "2026-06-01"'));

  const out = (n) => path.join(cwd, `${n}.topology.html`);
  for (const n of ['a', 'b']) {
    const r = run('scripts/render.mjs', desc, '-o', out(n), '--force');
    assert.equal(r.status, 0, `${n} 渲染失败：${r.stderr}`);
  }
  assert.equal(readFileSync(out('a'), 'utf8'), readFileSync(out('b'), 'utf8'));
});

test('被分析项目的源码变新了，过期提示 MUST 出现——这一条本来就该随外部变', () => {
  const cwd = sandbox('det-stale');
  const proj = path.join(cwd, 'proj', 'src');
  mkdirSync(proj, { recursive: true });
  const source = path.join(proj, 'workflow.ts');
  writeFileSync(source, 'export const x = 1');
  utimesSync(source, new Date('2026-01-01'), new Date('2026-01-01'));

  const desc = path.join(cwd, 'd.topology.yaml');
  const base = readFileSync('assets/templates/example.topology.yaml', 'utf8')
    .replace(/^source_project:.*$/m, `source_project: "${path.resolve(cwd, 'proj')}"`)
    .replace(/^generated_at:.*$/m, 'generated_at: "2026-06-01"')
    .replace(/- "[^"]*:\d+(-\d+)?"/g, '- "src/workflow.ts:1"');
  writeFileSync(desc, base);

  const before = path.join(cwd, 'before.topology.html');
  assert.equal(run('scripts/render.mjs', desc, '-o', before, '--force').status, 0);
  assert.equal(readFileSync(before, 'utf8').includes('可能已经过期'), false,
    '源码比描述旧，不该报过期');

  utimesSync(source, new Date(), new Date());
  const after = path.join(cwd, 'after.topology.html');
  assert.equal(run('scripts/render.mjs', desc, '-o', after, '--force').status, 0);
  assert.match(readFileSync(after, 'utf8'), /可能已经过期/,
    '源码改新了却没给过期提示（FR-053 / AC-037）');
});

// ---- CLI 输入错误的诊断质量（评审 P1）--------------------------------------
test('两个 CLI 不给参数时 MUST 给同样的人话诊断与退出码，不甩原生栈', () => {
  for (const script of ['scripts/render.mjs', 'scripts/validate.mjs']) {
    const r = run(script);
    assert.equal(r.status, 3, `${script} 没给路径时退出码应为 3，实际 ${r.status}`);
    assert.match(r.stderr, /没有给描述文件路径/, `${script} 的报错不是人话`);
    assert.equal(/TypeError|at Module\._compile|node:internal/.test(r.stderr), false,
      `${script} 甩了 Node 原生栈：\n${r.stderr}`);
  }
});

// ---- 文档里的命令照字面能跑（评审 P0）--------------------------------------
test('SKILL.md 与 references 里的命令占位符 MUST 是能跑通的形态', () => {
  const docs = ['SKILL.md', 'references/编排描述格式.md', 'references/抽取纪律.md'];
  for (const doc of docs) {
    const text = readFileSync(doc, 'utf8');
    assert.equal(text.includes('-o <输出.html>'), false,
      `${doc} 仍在用 -o <输出.html>——照字面跑会被拒（必须 .topology.html 结尾）`);
    for (const [, line] of text.matchAll(/^(node scripts\/\S+.*)$/gm)) {
      assert.fail(`${doc} 有裸路径命令「${line}」，缺 <本技能根目录>/ 前缀，换个目录就跑不通`);
    }
  }
  // 反向自检：证明上面的断言真抓得住
  assert.equal(/^(node scripts\/\S+.*)$/m.test('node scripts/validate.mjs x.yaml'), true);
});

test('输出后缀与落点两条硬约束，SKILL.md MUST 写明', () => {
  const text = readFileSync('SKILL.md', 'utf8');
  assert.match(text, /\.topology\.html.*结尾/, '没写明 -o 必须以 .topology.html 结尾');
  assert.match(text, /落在被分析项目之外|不能把图写进被分析的项目/, '没写明输出要在目标项目之外');
  assert.match(text, /落点 MUST 在被分析项目之外/, '没写明描述文件本身也不能落在目标项目里');
  assert.match(text, /第 4 步/, '流程没有「出图并交付」这一步');
  assert.match(text, /Node ≥ 18/, '没写运行环境要求');
});

// ---- 抽取侧的归并判据与它的回归样本 ------------------------------------------
// 这一段只断言"判据和样本都在、且没被悄悄削掉"。判得准不准是语义问题，
// 没有确定性可断言的部分，那部分由 tests/fixtures/extraction-regression/ 人工跑。

test('抽取纪律写清了三条证据判据，以及拿不准时的兜底', () => {
  const doc = readFileSync('references/抽取纪律.md', 'utf8');
  assert.match(doc, /## 6ter\./, '缺归并判据这一节');
  assert.match(doc, /未经改写/, '缺证据①');
  assert.match(doc, /同一段代码/, '缺证据②');
  assert.match(doc, /只做透传/, '缺证据③');
  assert.match(doc, /MUST NOT 只因为名字或文字相同就归并/, '缺"不许按名字归并"');
  assert.match(doc, /same_as/, '缺拿不准时的兜底');
  assert.match(doc, /全部被归并处/, '缺"归并了要把 refs 列全"');
});

test('分批与续跑都交代了信息清单怎么合并、怎么去重', () => {
  const doc = readFileSync('references/抽取纪律.md', 'utf8');
  assert.match(doc, /只读 `id` \/ `name` \/ `what` 三项/, '分批回读没限定只读三项');
  assert.match(doc, /已存在的 `id` MUST NOT 重复追加/, '分批没写去重');
  assert.match(doc, /信息清单 MUST 按 `id` 去重/, '续跑没写去重');
});

test('禁止清单把两条新的 MUST NOT 收进去了', () => {
  const doc = readFileSync('references/抽取纪律.md', 'utf8');
  const forbidden = doc.slice(doc.indexOf('## 3. 允许与禁止'), doc.indexOf('## 4.'));
  assert.match(forbidden, /只凭名字或文字相同/);
  assert.match(forbidden, /为了让链路看起来顺/);
});

// 规则只写在一处、没人指过去，等于没立——模型不会为了写一句职责去通读整份纪律。
test('描述性文字的写法立了规则，且三处入口都指得到', () => {
  const 纪律 = readFileSync('references/抽取纪律.md', 'utf8');
  const 节 = 纪律.slice(纪律.indexOf('## 3bis.'), 纪律.indexOf('## 4.'));
  assert.ok(节.length > 0, '抽取纪律里没有 §3bis');
  assert.match(节, /没看过这个项目代码的人/, '没写清读者是谁');
  assert.match(节, /一句话只说一件事/, '缺"一句一件事"');
  assert.match(节, /先说干什么再说怎么干/, '缺"先说干什么"');
  assert.match(节, /MUST NOT 只甩名词/, '缺"真实名词前面要有人话"');
  assert.match(节, /处理、管理、相关逻辑/, '缺"说了等于没说的词"清单');
  assert.match(节, /别这么写 \| 这么写/, '缺正反对照表——只讲道理不给例子，模型照样写黑话');
  assert.match(节, /MUST NOT 拿它牺牲准确/, '缺"说人话不等于含糊"的反向约束');

  assert.match(readFileSync('SKILL.md', 'utf8'), /§3bis/, 'SKILL.md 第 3 步没指向 §3bis');
  const 格式 = readFileSync('references/编排描述格式.md', 'utf8');
  assert.match(格式, /§3bis/, '格式契约没指向 §3bis');
  for (const 字段 of ['responsibility', 'purpose'])
    assert.ok(格式.includes(`\`${字段}\``), `格式契约里找不到 ${字段} 这一行`);

  assert.match(纪律.slice(纪律.indexOf('## 8.')), /§3bis/, '收尾自查清单没把这条收进去');
});

test('抽取回归样本齐备：目标项目、人工标注的期望清单、跑过一次的记录', () => {
  const base = 'tests/fixtures/extraction-regression';
  for (const file of ['expected.md', 'last-run.md', 'project/src/intake.ts',
    'project/src/router.ts', 'project/src/worker.ts', 'project/src/notify.ts'])
    assert.ok(existsSync(`${base}/${file}`), `回归样本缺 ${file}`);
  const expected = readFileSync(`${base}/expected.md`, 'utf8');
  // 判定口径 MUST 写死在样本里，不能等跑的时候现想
  assert.match(expected, /该归并的/, '缺"该归并"的那张表');
  assert.match(expected, /不该归并的/, '缺"不该归并"的那张表');
  assert.match(expected, /判定口径/, '没写死判定口径');
  assert.match(expected, /退化/, '没说什么情况算退化');
  assert.match(readFileSync(`${base}/last-run.md`, 'utf8'), /\d{4}-\d{2}-\d{2}/, '没有跑过的日期');
});

test('常驻提示词没有因为这次改动变胖', () => {
  // SKILL.md 是每次唤起都常驻的那一份，红线 10000 字符；
  // 抽取纪律是按需加载层，宽松些但也不该无限长。
  assert.ok(readFileSync('SKILL.md', 'utf8').length < 10000, 'SKILL.md 超过常驻红线');
  assert.ok(readFileSync('references/抽取纪律.md', 'utf8').length < 12000,
    '抽取纪律过长，按需加载层也会挤占注意力');
});
