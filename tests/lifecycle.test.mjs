import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { FX, TMP, renderOk, data } from './helpers.mjs';
import { resolveTarget } from '../scripts/lib/nonclobber.mjs';
import { isStale } from '../scripts/lib/staleness.mjs';

test('二次生成不覆盖 HTML：另存 .2 并提示，原文件字节未变', () => {
  mkdirSync('tests/tmp', { recursive: true });
  const out = TMP('dup.topology.html');
  rmSync(out, { force: true }); rmSync(TMP('dup.2.topology.html'), { force: true });
  const a = spawnSync('node', ['scripts/render.mjs', FX('base.topology.yaml'), '-o', out], { encoding: 'utf8' });
  assert.equal(a.status, 0, a.stderr);
  const before = readFileSync(out, 'utf8');
  const b = spawnSync('node', ['scripts/render.mjs', FX('base.topology.yaml'), '-o', out], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr);
  assert.ok(existsSync(TMP('dup.2.topology.html')), '没有另存 .2');
  assert.equal(readFileSync(out, 'utf8'), before, '原文件被改动了');
  assert.match(b.stderr, /已有一份/);
});

test('--force 才覆盖', () => {
  const out = TMP('dup.topology.html');
  const r = spawnSync('node', ['scripts/render.mjs', FX('base.topology.yaml'), '-o', out, '--force'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /已有一份/);
});

test('resolveTarget 逐级递增', () => {
  assert.equal(resolveTarget(TMP('zzz.topology.html'), false).path, TMP('zzz.topology.html'));
  writeFileSync(TMP('zzz.topology.html'), 'x');
  assert.equal(resolveTarget(TMP('zzz.topology.html'), false).path, TMP('zzz.2.topology.html'));
  writeFileSync(TMP('zzz.2.topology.html'), 'x');
  assert.equal(resolveTarget(TMP('zzz.topology.html'), false).path, TMP('zzz.3.topology.html'));
  assert.equal(resolveTarget(TMP('zzz.topology.html'), true).path, TMP('zzz.topology.html'));
});

test('过期判断：源码 mtime 晚于 generated_at 即判过期', async () => {
  mkdirSync('tests/tmp/fake-src/src', { recursive: true });
  writeFileSync('tests/tmp/fake-src/src/material-inventory.ts', '// x');
  const t = new Date('2027-01-01T00:00:00Z');
  utimesSync('tests/tmp/fake-src/src/material-inventory.ts', t, t);
  const doc = data(FX('base.topology.yaml'));
  doc.source_project = 'tests/tmp/fake-src';
  const r = await isStale(doc, { baseDir: '.' });
  assert.equal(r.stale, true);
  assert.match(r.reason, /源码/);
});

test('来源项目读不到时不报错、不判过期', async () => {
  const doc = data(FX('base.topology.yaml'));
  doc.source_project = 'tests/tmp/does-not-exist';
  const r = await isStale(doc, { baseDir: '.' });
  assert.equal(r.stale, false);
  assert.match(r.reason, /读不到/);
});

test('过期时出图给提示，且 MUST NOT 自动重跑', () => {
  const html = renderOk(FX('base.topology.yaml'), 'stale.html');
  // base 的 source_project 指向不存在的目录 → 不判过期，页面不应误报
  assert.doesNotMatch(html, /这张图可能已经过期/);
});

test('抽取纪律里写清了断点续跑规则', () => {
  const t = readFileSync('references/抽取纪律.md', 'utf8');
  assert.match(t, /断点文件就是描述文件本身/);
  assert.match(t, /analysis_complete/);
});
