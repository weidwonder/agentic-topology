#!/usr/bin/env node
/**
 * 重拍 README 里那三张图，中英各一套。
 *
 * 为什么不在 agentic-topology/scripts/ 下：那个目录有「全仓只有 write-output.mjs 碰写操作」
 * 的断言（tests/acceptance.test.mjs），截图工具要写 png，放进去会把那条不变量弄红。
 * 它也不是技能的一部分——使用者装的是技能，不是这个工具。
 *
 * 详情弹层与折叠视图靠点击才出得来，无头浏览器点不了，所以这里直接改 HTML：
 * 把该显示的 hidden 摘掉、把详情片段搬进弹层，再截图。改的是拍照用的副本，
 * 不动出图产物本身。
 *
 * 跑法：node tools/shoot.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILL = path.join(ROOT, 'agentic-topology');
const WORK = path.join(ROOT, '.shoot');
const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 中英各拍一份**各自语言的描述**：英文 README 配一张方块名全是中文的图，
// 等于没英文化。两套图的编排不同是有意的，各自在自己那门语言里自洽。
const SHOTS = [
  { lang: 'zh', out: path.join(ROOT, 'assets/images'), fixture: path.join(SKILL, 'tests/fixtures/aiudit-internal-control.topology.yaml'), node: 'N4' },
  { lang: 'en', out: path.join(ROOT, 'assets/images/en'), fixture: path.join(SKILL, 'assets/templates/example-en.topology.yaml'), node: 'REVIEWER' },
];

function shoot(html, png, height) {
  const r = spawnSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--screenshot=${png}`, `--window-size=1440,${height}`, '--force-device-scale-factor=2',
    `file://${html}`], { encoding: 'utf8' });
  if (!existsSync(png)) throw new Error(`截图失败：${png}\n${r.stderr}`);
}

/**
 * 页面真实高度：估是估不准的——发起说明、信息清单、收尾块都随内容伸缩，
 * 估宽了底下一大片白，估窄了截断。让浏览器自己量：往拍照副本里塞一段脚本
 * 把 scrollHeight 写进 <title>，再 --dump-dom 把它读回来。
 */
function measure(htmlPath, html) {
  const probe = htmlPath.replace(/\.html$/, '-probe.html');
  writeFileSync(probe, html.replace('</body>',
    '<script>document.title = "H=" + document.documentElement.scrollHeight;</script></body>'));
  const r = spawnSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--dump-dom',
    '--virtual-time-budget=2000', '--window-size=1440,900', `file://${probe}`], { encoding: 'utf8' });
  const hit = /<title>H=(\d+)<\/title>/.exec(r.stdout || '');
  if (!hit) throw new Error(`量不出页面高度：${probe}`);
  return Math.min(9000, Number(hit[1]) + 24);
}

for (const { lang, out, fixture, node } of SHOTS) {
  mkdirSync(WORK, { recursive: true });
  mkdirSync(out, { recursive: true });
  const page = path.join(WORK, `${lang}.topology.html`);
  const r = spawnSync('node', [path.join(SKILL, 'scripts/render.mjs'), fixture, '-o', page,
    '--force', '--lang', lang], { encoding: 'utf8', cwd: SKILL });
  if (r.status !== 0) throw new Error(`出图失败：${r.stdout}${r.stderr}`);
  const html = readFileSync(page, 'utf8');
  const tall = measure(page, html);

  // ① 全貌
  shoot(page, path.join(out, 'overview.png'), tall);

  // ② 详情弹层：把某个方块的详情片段搬进弹层，并把弹层显示出来
  const start = html.indexOf(`<section id="detail-${node}"`);
  if (start < 0) throw new Error(`找不到 ${node} 的详情片段`);
  const detail = html.slice(start, html.indexOf('<section id="detail-', start + 1));
  const withModal = html
    .replace('<div class="topo-modal" id="topo-modal" hidden>', '<div class="topo-modal" id="topo-modal">')
    .replace('<div class="topo-modal-body" id="topo-modal-body"></div>',
      `<div class="topo-modal-body" id="topo-modal-body">${detail}</div>`);
  const modalPage = path.join(WORK, `${lang}-detail.html`);
  writeFileSync(modalPage, withModal);
  shoot(modalPage, path.join(out, 'detail.png'), measure(modalPage, withModal));

  // ③ 折叠视图
  const foldedPage = path.join(WORK, `${lang}-folded.html`);
  const foldedHtml = html
    .replace('<section id="view-overview" class="view">', '<section id="view-overview" class="view" hidden>')
    .replace('<section id="view-folded" class="view" hidden>', '<section id="view-folded" class="view">');
  writeFileSync(foldedPage, foldedHtml);
  shoot(foldedPage, path.join(out, 'folded.png'), measure(foldedPage, foldedHtml));

  console.log(`${lang}: overview / detail / folded → ${path.relative(ROOT, out)}`);
}
