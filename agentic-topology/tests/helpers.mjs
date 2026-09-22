import { readFileSync, existsSync, rmSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseTopology } from '../scripts/lib/parse.mjs';

export const FX = (name) => path.join('tests/fixtures', name);
/** 输出文件名一律归一到 .topology.html —— 唯一写点的断言要求这个后缀（spec §7.2 Invariant 1）。 */
export const TMP = (name) => path.join('tests/tmp', name.replace(/(\.topology)?\.html$/, '.topology.html'));

/** 解析一份 fixture，返回 {data, lines}。语法错会抛。 */
export function load(fixturePath) {
  return parseTopology(readFileSync(fixturePath, 'utf8'), fixturePath);
}

/** 只要 data，最常用。 */
export function data(fixturePath) {
  return load(fixturePath).data;
}

/** 跑 render.mjs 并断言成功，返回 HTML 全文。 */
export function renderOk(fixturePath, outName) {
  mkdirSync('tests/tmp', { recursive: true });
  const out = TMP(outName);
  rmSync(out, { force: true });
  const r = spawnSync('node', ['scripts/render.mjs', fixturePath, '-o', out, '--force'],
    { encoding: 'utf8' });
  assert.equal(r.status, 0, `render 失败：\n${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(out), '没有产出 HTML');
  return readFileSync(out, 'utf8');
}

/** 跑 render.mjs 并断言被拒绝出图，返回 {status, stdout, stderr}。同时断言没有产出文件。 */
export function renderFail(fixturePath, outName, expectStatus = 2) {
  mkdirSync('tests/tmp', { recursive: true });
  const out = TMP(outName);
  rmSync(out, { force: true });
  const r = spawnSync('node', ['scripts/render.mjs', fixturePath, '-o', out],
    { encoding: 'utf8' });
  assert.equal(r.status, expectStatus, `期望退出码 ${expectStatus}，实际 ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.equal(existsSync(out), false, '校验不通过却产出了 HTML');
  return r;
}

/** 跑 validate.mjs --format json，返回解析后的对象与退出码。 */
export function validateCli(fixturePath) {
  const r = spawnSync('node', ['scripts/validate.mjs', fixturePath, '--format', 'json'],
    { encoding: 'utf8' });
  return { status: r.status, out: JSON.parse(r.stdout), stderr: r.stderr };
}

/** 从渲染出的 HTML 里取回内嵌的数据块。 */
export function dataOf(html) {
  const m = html.match(/<script type="application\/json" id="topology-data">([\s\S]*?)<\/script>/);
  assert.ok(m, 'HTML 里没有 id="topology-data" 的数据块');
  return JSON.parse(m[1].replace(/<\\\/script/g, '</script'));
}

/** 按容器 id 切出 HTML 片段，用于「按视图分别断言」。找不到即失败。 */
export function sect(html, containerId) {
  const open = html.indexOf(`id="${containerId}"`);
  assert.ok(open >= 0, `HTML 里没有 id="${containerId}" 的容器`);
  const start = html.lastIndexOf('<', open);
  // 从容器开标签起，按同名标签配平找到闭合位置
  const tag = html.slice(start + 1).match(/^[a-zA-Z]+/)[0];
  let depth = 0, i = start;
  const openRe = new RegExp(`<${tag}\\b`, 'g');
  const closeRe = new RegExp(`</${tag}>`, 'g');
  while (i < html.length) {
    openRe.lastIndex = i; closeRe.lastIndex = i;
    const o = openRe.exec(html), c = closeRe.exec(html);
    if (!c) break;
    if (o && o.index < c.index) { depth++; i = o.index + 1; }
    else { depth--; i = c.index + 1; if (depth === 0) return html.slice(start, c.index + tag.length + 3); }
  }
  assert.fail(`容器 ${containerId} 没有配平的闭合标签`);
}

/** 剥掉 <style> 与内嵌 JSON 数据块之后的界面正文，用于「界面白话」断言。 */
export function bodyText(html) {
  return html
    .replace(/<script type="application\/json"[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');
}

/** 递归列出目录下的文件，filter 返回 true 才收。 */
export function walk(dir, filter = () => true, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = dir === '.' ? `./${name}` : path.join(dir, name);
    if (statSync(p).isDirectory()) { if (filter(p)) walk(p, filter, acc); }
    else if (filter(p)) acc.push(p);
  }
  return acc;
}

/** 捕获并返回 fn 抛出的错误。assert.throws 不返回错误对象，要断言 code/line 必须用它。 */
export function catchErr(fn) {
  try { fn(); } catch (e) { return e; }
  assert.fail('期望抛出 TopologyError，但没有抛');
}

/** 两个矩形是否相交（边界相接不算相交）。 */
export function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/**
 * 找 Chrome/Chromium，找不到返回 null——跟 tools/visual-check.mjs 同一套探测顺序。
 * 供需要真浏览器（量 getBoundingClientRect、模拟拖动）的测试共用，
 * 那类测试 MUST 在找不到 Chrome 时用 `t.skip()` 明确跳过，不能悄悄判通过。
 */
export function findChrome() {
  if (process.env.CHROME) return existsSync(process.env.CHROME) ? process.env.CHROME : null;
  if (process.platform === 'darwin') {
    for (const candidate of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]) if (existsSync(candidate)) return candidate;
    return null;
  }
  if (process.platform === 'win32') {
    for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      for (const rel of ['Google/Chrome/Application/chrome.exe', 'Chromium/Application/chrome.exe']) {
        const candidate = path.join(root, ...rel.split('/'));
        if (existsSync(candidate)) return candidate;
      }
    }
    return null;
  }
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    for (const dir of dirs) {
      const candidate = path.join(dir, command);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * 在真 Chrome 里打开一份 HTML、跑一段探测脚本，从注入的 `document.title` 里读回结果。
 * 跟 tools/visual-check.mjs 同一套「把测量结果编码进 title 再用 --dump-dom 读回来」的写法——
 * 不追求 DevTools pipe 那套更优雅的机制，先把浏览器里的真实结果拿到手更要紧。
 */
export function runInChrome(chrome, html, probeScript, { window: windowSize = '1440,900', workDir } = {}) {
  mkdirSync(workDir, { recursive: true });
  const probe = path.join(workDir, `probe-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  writeFileSync(probe, html.replace('</body>', `${probeScript}</body>`));
  const result = spawnSync(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--dump-dom',
    '--virtual-time-budget=4000', `--window-size=${windowSize}`, `file://${probe}`,
  ], { encoding: 'utf8', timeout: 30000 });
  const hit = /<title>R=([^<]*)<\/title>/.exec(result.stdout || '');
  assert.ok(hit, `量不出探测结果：\n${result.stderr || result.stdout}`);
  return JSON.parse(decodeURIComponent(hit[1]));
}
