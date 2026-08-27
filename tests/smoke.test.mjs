import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, renderOk, bodyText } from './helpers.mjs';

test('基准描述能出图，四个节点的名字与职责都在', () => {
  const html = renderOk(FX('base.topology.yaml'), 'smoke.html');
  assert.match(html, /<!doctype html>/i);
  for (const s of ['整理材料清单', '看能不能复用上次的计划', '规划师', '调度分发'])
    assert.ok(bodyText(html).includes(s), `图上找不到「${s}」`);
  assert.ok(bodyText(html).includes('列出全部材料'), '节点职责没上图');
});

test('零外链', () => {
  const html = renderOk(FX('base.topology.yaml'), 'smoke.html');
  for (const bad of [/https?:\/\//, /fetch\s*\(/, /XMLHttpRequest/, /WebSocket/,
                     /<link[^>]+rel=["']stylesheet/, /<script[^>]+src=/])
    assert.doesNotMatch(html, bad, `命中外链模式 ${bad}`);
});
