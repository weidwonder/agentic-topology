/**
 * 钉住「屏幕坐标与模型坐标同一套口径」这条不变量（docs/TODO.md「线上标注的横向对齐
 * 口径」2026-09-14 条目起因）。
 *
 * `layout.mjs` 的 `labelBox()` 把 `(edge.labelX, edge.labelY)` 当成这行字的**中心点**算退让；
 * 但 SVG `<text>` 的默认锚点是 `text-anchor:start`（x 记左端）+ `dominant-baseline:auto`
 * （y 记字母基线，不是竖直中心）。两边各自的模型都自洽、`tests/edges.test.mjs` 那些
 * 「模型内零压叠」的断言也全绿——可是真拿浏览器一量，字的实际中心跟模型算的中心点对不上，
 * 屏幕上整体偏右（约半个字宽）、偏下（约小半个字高），退让算法在模型里判定「没压」，
 * 画到屏幕上却可能真的压到旁边的方块。这正是 2026-09-14 那条 TODO 记的缺口：
 * 「证明的是模型内零压叠……不是屏幕上零压叠」。
 *
 * `agentic-topology/assets/page-shell/topo.css` 的 `.topo-elabel` 补了
 * `text-anchor: middle; dominant-baseline: central;` 两行把浏览器的锚点语义拉回跟
 * `labelBox()` 一致。这条测试不信任何一边的字符串断言，直接拿真 Chrome 量：
 *   1. 每一行标注的真实渲染中心 MUST 落在 `(labelX, labelY)` 的一两像素以内——
 *      这两行 CSS 但凡被人删掉或改回默认值，这条立刻测出几十上百像素的偏移。
 *   2. 全貌视图与折叠视图里，标注与卡片（`.topo-node` / `.topo-fold`）在浏览器里
 *      MUST 真的不压叠——这是本条不变量最终要保证的结果，不只是保证「锚点属性还在」。
 *
 * 复用 `tools/visual-check.mjs` 验证过的调用方式（headless Chrome + `--dump-dom` 读回
 * 注入脚本写进 `<title>` 的 JSON），但只挑一个视口：这里量的是绝对定位画布内部的
 * 几何关系，不随视口宽高变化，多个视口不会多验出别的东西，只会多花时间。
 *
 * 本机没有 Chrome/Chromium 时用 `t.skip()` 明确跳过而不是悄悄判通过——
 * 跳过的测试在 `node --test` 的汇总里是单独一类，不会被算进「通过」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FX, renderOk, findChrome, runInChrome } from './helpers.mjs';

/** 把某个视图切到可见：两个 <section> 同时在 DOM 里，量之前得先摘掉目标视图的 hidden。 */
function selectView(html, view) {
  if (view === 'overview') return html;
  return html
    .replace('<section id="view-overview" class="view">', '<section id="view-overview" class="view" hidden>')
    .replace('<section id="view-folded" class="view" hidden>', '<section id="view-folded" class="view">');
}

/** 探测脚本：标注的「模型中心」vs「真实渲染中心」逐个比，顺带量标注与卡片有没有压叠。 */
const PROBE = `<script>
(function () {
  function rectOf(el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  function overlap(a, b) {
    var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return (w > 0.5 && h > 0.5) ? { w: w, h: h } : null;
  }
  var view = document.querySelector('.view:not([hidden])');
  // labelX/labelY 是 SVG viewBox 里的画布局部坐标（1 viewBox 单位 = 1 CSS 像素，见
  // tools/visual-check.mjs 头部注释），getBoundingClientRect() 给的是视口绝对坐标——
  // 两者只在同一个原点下才能直接相减，所以先量出 .topo-stage 的视口偏移量再扣掉，
  // 不然量出来的「偏移」其实是页面外层留白（.topo-wrap 的 padding/border、
  // .topology-page 的外边距……），跟这条不变量要测的文字锚点问题完全是两回事。
  var stage = view.querySelector('.topo-stage');
  var origin = stage.getBoundingClientRect();
  var labels = Array.from(view.querySelectorAll('text.topo-elabel')).map(function (el) {
    var r = rectOf(el);
    return {
      modelX: Number(el.getAttribute('x')), modelY: Number(el.getAttribute('y')),
      actualX: (r.x - origin.x) + r.w / 2, actualY: (r.y - origin.y) + r.h / 2,
      text: (el.textContent || '').trim().slice(0, 30),
    };
  });
  var cards = Array.from(view.querySelectorAll('.topo-node, .topo-fold'))
    .map(rectOf).filter(function (c) { return c.w > 0 && c.h > 0; });
  var overlaps = [];
  Array.from(view.querySelectorAll('text.topo-elabel')).forEach(function (el) {
    var r = rectOf(el);
    if (r.w === 0) return;
    cards.forEach(function (c) {
      var o = overlap(r, c);
      if (o) overlaps.push({ text: (el.textContent || '').trim().slice(0, 30), w: o.w, h: o.h });
    });
  });
  document.title = 'R=' + encodeURIComponent(JSON.stringify({ labels: labels, overlaps: overlaps }));
})();
</script>`;

test('屏幕坐标与模型坐标对齐：标注真实渲染中心 = labelX/labelY，且浏览器里真的不压方块', async (t) => {
  const chrome = findChrome();
  if (!chrome) {
    t.skip('本机没有 Chrome/Chromium（可用 CHROME 环境变量指定）——这条不变量这次没有验证，不算通过');
    return;
  }

  const html = renderOk(FX('aiudit-internal-control.topology.yaml'), 'label-anchor.html');
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'label-anchor-'));
  try {
    for (const view of ['overview', 'folded']) {
      const result = runInChrome(chrome, selectView(html, view), PROBE, { workDir });
      assert.ok(result.labels.length > 0, `${view} 视图一条标注都没量到，钉不住东西`);
      // 口径核实：真实渲染中心 MUST 落在模型中心的 1.5px 以内——
      // text-anchor:start 的旧默认值会把这个差值推到「半个字宽」（几十到上百像素），
      // dominant-baseline:auto 的旧默认值会把纵向差值推到 3~6px，两者都远超这条容差。
      for (const label of result.labels) {
        const dx = Math.abs(label.actualX - label.modelX);
        const dy = Math.abs(label.actualY - label.modelY);
        assert.ok(dx <= 1.5, `${view} 视图标注「${label.text}」水平方向偏了 ${dx.toFixed(2)}px`
          + '（模型把 x 当中心，真实渲染的锚点跟模型对不上，会看着往右偏半个字宽）');
        assert.ok(dy <= 1.5, `${view} 视图标注「${label.text}」竖直方向偏了 ${dy.toFixed(2)}px`
          + '（模型把 y 当中心，真实渲染的基线跟模型对不上，会看着往下偏）');
      }
      // 结果核实：口径对齐之后，浏览器里实测也 MUST 真的零压叠——这是本条不变量要保证的结果。
      assert.deepEqual(result.overlaps, [],
        `${view} 视图在浏览器里量到 ${result.overlaps.length} 处标注压方块：`
          + `${JSON.stringify(result.overlaps)}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
