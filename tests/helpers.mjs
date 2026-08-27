import { readFileSync, existsSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (filter(p)) walk(p, filter, acc); }
    else if (filter(p)) acc.push(p);
  }
  return acc;
}

/** 两个矩形是否相交（边界相接不算相交）。 */
export function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
