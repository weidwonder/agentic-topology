/**
 * npm 包入口与技能安装。
 *
 * 这里也守着一条边界：install 会写文件，而 render / validate 那条链上
 * 只有 scripts/lib/write-output.mjs 允许写盘（AC-036）。两者 MUST 互不引用。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { install, INSTALL_TARGETS } from '../bin/install.mjs';
import { walk } from './helpers.mjs';

const ROOT = process.cwd();
const CLI = 'bin/cli.mjs';
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('package.json 的 bin / files / engines 与实际文件对得上', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.name, 'agentic-topology');
  assert.equal(pkg.private, undefined, 'private: true 会让 npm publish / npx 都用不了');
  assert.ok(existsSync(pkg.bin['agentic-topology']), `bin 指向的文件不存在：${pkg.bin['agentic-topology']}`);
  for (const entry of pkg.files) {
    assert.ok(existsSync(entry.replace(/\/$/, '')), `files 里的 ${entry} 不存在`);
  }
  assert.equal(pkg.files.includes('tests/'), false, 'tests/ 不该发进 npm 包');
  assert.deepEqual(pkg.dependencies, {}, '零依赖');
});

test('install 只复制交付物，MUST NOT 带上 tests / docs / node_modules', async () => {
  const cwd = 'tests/tmp/install-demo';
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  const result = await install({ root: ROOT, agent: 'claude', cwd });
  assert.equal(result.target, INSTALL_TARGETS.claude);
  assert.ok(result.files > 10, `只复制了 ${result.files} 个文件，太少了`);

  const installed = walk(path.join(cwd, INSTALL_TARGETS.claude)).map((p) => p.replace(/\\/g, '/'));
  assert.ok(installed.some((p) => p.endsWith('/SKILL.md')));
  assert.ok(installed.some((p) => p.includes('/references/')));
  assert.ok(installed.some((p) => p.includes('/scripts/lib/')));
  assert.ok(installed.some((p) => p.includes('/assets/page-shell/')));
  for (const forbidden of ['/tests/', '/docs/', '/node_modules/', '/.git/']) {
    assert.equal(installed.some((p) => p.includes(forbidden)), false,
      `装进去了不该装的：${forbidden}`);
  }
});

test('装出来的那份能独立出图——不依赖本仓任何东西', async () => {
  const cwd = 'tests/tmp/install-standalone';
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  await install({ root: ROOT, agent: 'claude', cwd });
  const skill = path.join(cwd, INSTALL_TARGETS.claude);
  const r = spawnSync(process.execPath, [
    path.join(skill, 'scripts/render.mjs'),
    path.join(skill, 'assets/templates/example.topology.yaml'),
    '-o', path.join(cwd, 'out.topology.html'), '--force',
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, `装出来的那份跑不起来：\n${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(path.join(cwd, 'out.topology.html')));
});

test('重装 MUST 先清干净，不能留上一版的文件', async () => {
  const cwd = 'tests/tmp/install-reinstall';
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  await install({ root: ROOT, agent: 'claude', cwd });
  const stale = path.join(cwd, INSTALL_TARGETS.claude, 'references/上一版留下的规则.md');
  writeFileSync(stale, '一条已经被废掉的规则');
  await install({ root: ROOT, agent: 'claude', cwd });
  assert.equal(existsSync(stale), false,
    '重装没清干净——agent 会同时读到两份互相矛盾的规则');
});

test('CLI：三个子命令都在，退出码原样透传', () => {
  assert.match(cli().stdout, /npx agentic-topology install/);
  assert.match(cli('--help').stdout, /npx agentic-topology render/);
  assert.equal(cli('--help').status, 0);
  assert.equal(cli('莫名其妙的子命令').status, 1, '不认识的子命令该退 1');

  assert.equal(cli('validate', 'assets/templates/example.topology.yaml').status, 0);
  assert.equal(cli('validate', 'tests/fixtures/rules/R-01.topology.yaml').status, 2, '校验不过该退 2');
  assert.equal(cli('validate', 'tests/tmp/绝不存在.topology.yaml').status, 3, '文件读不了该退 3');
  assert.match(cli('--version').stdout, /^\d+\.\d+\.\d+$/m);
});

test('install 的写盘能力 MUST NOT 漏进 render / validate 那条链', () => {
  // scripts/ 下不许出现对 bin/ 的引用——否则出图链路就间接拿到了任意写盘能力
  for (const file of walk('scripts')) {
    const text = readFileSync(file, 'utf8');
    assert.equal(/from\s+['"][^'"]*\/bin\//.test(text), false,
      `${file} 引用了 bin/——出图链路 MUST NOT 拿到 install 的写盘能力`);
  }
  // 反向自检：证明上面那条正则真抓得住
  assert.equal(/from\s+['"][^'"]*\/bin\//.test("import { install } from '../bin/install.mjs';"), true);
});

// ---- README 的链接与互相引用 -------------------------------------------------
// 上一轮评审抓到过 README 写着过期的测试数。精确数字每加一条用例就会漂，
// 与其钉一个必然过期的数，不如把它从 README 里去掉——这里只钉住不会漂的部分。
test('两份 README 互相引用，且所有相对链接与图片都指得到', () => {
  const repoRoot = path.resolve('..');
  const readmes = { zh: 'README.md', en: 'README.en.md' };
  for (const name of Object.values(readmes)) {
    const file = path.join(repoRoot, name);
    assert.ok(existsSync(file), `缺 ${name}`);
    const text = readFileSync(file, 'utf8');
    let links = 0;
    for (const [, link] of text.matchAll(/\]\(\.\/([^)]+)\)/g)) {
      links += 1;
      assert.ok(existsSync(path.join(repoRoot, link)), `${name} 断链：./${link}`);
    }
    assert.ok(links >= 4, `${name} 只扫到 ${links} 条相对链接，正则可能失配了`);
  }
  assert.match(readFileSync(path.join(repoRoot, readmes.zh), 'utf8'), /README\.en\.md/,
    '中文版没指向英文版');
  assert.match(readFileSync(path.join(repoRoot, readmes.en), 'utf8'), /README\.md/,
    '英文版没指向中文版');
});

test('README 引用的三张图都在，且不是空文件', () => {
  const repoRoot = path.resolve('..');
  for (const name of ['overview.png', 'detail.png', 'folded.png']) {
    const file = path.join(repoRoot, 'docs/images', name);
    assert.ok(existsSync(file), `缺图片 ${name}`);
    assert.ok(readFileSync(file).length > 10000, `${name} 太小了，可能是坏图`);
  }
});
