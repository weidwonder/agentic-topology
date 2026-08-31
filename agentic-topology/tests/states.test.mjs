import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, renderOk, sect, bodyText, dataOf } from './helpers.mjs';

test('空态：没有方块时给空态而非空白页', () => {
  const html = renderOk(FX('empty.topology.yaml'), 'empty.html');
  const ov = sect(html, 'view-overview');
  assert.match(ov, /还没有可画的东西/);
  assert.match(ov, /打开写好的描述/);
  assert.ok(bodyText(html).trim().length > 200, '空态页面不能是空白');
});

test('分析未完成要标注，且不影响已读出部分照常上图', () => {
  const html = renderOk(FX('incomplete.topology.yaml'), 'inc.html');
  assert.match(html, /还没分析完，这张图不全/);
  assert.equal(dataOf(html).nodes.length, 4, '未完成不等于不出图');
  assert.match(sect(html, 'view-overview'), /data-node-id="N1"/);
});

test('分析完成时不出现未完成告示', () => {
  assert.doesNotMatch(renderOk(FX('base.topology.yaml'), 'done.html'), /还没分析完/);
});

test('顶栏常驻三个数字，且由程序数出', () => {
  const html = renderOk(FX('three-confidence.topology.yaml'), 'bar.html');
  const d = dataOf(html);
  const ov = sect(html, 'view-overview');
  assert.match(ov, new RegExp(`${d.nodes.length}\\s*个方块`));
  assert.match(ov, new RegExp(`${d.edges.length}\\s*条连线`));
  assert.match(ov, new RegExp(`${d.checklist.length}\\s*处`));
  assert.match(ov, /查证时间\s*2026-08-26/);
});
