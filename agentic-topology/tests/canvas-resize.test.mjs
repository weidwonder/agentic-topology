/**
 * 画布自动伸缩（app.js 的 `growCanvasToFit()`）——需求原话：
 * 元素拖出画布边界要能把画布撑大装下它，拖回来要能缩回去，缩小的下限是程序按布局
 * 算出来的原始尺寸（`.topo-stage` 的 `data-w`/`data-h`）。
 *
 * 这是纯运行时行为（拖动时浏览器里发生的事），字符串断言测不出来——`.topo-stage` 的
 * `style.width/height` 只有真的跑一遍 pointerdown/pointermove/pointerup 才会变。
 * 所以跟 `tests/label-anchor.test.mjs` 一样，复用 `tools/visual-check.mjs` 跑通的
 * 「headless Chrome + 注入脚本把结果编码进 `<title>`」调用方式，但这里额外在注入脚本里
 * **真的派发一串 PointerEvent**：app.js 的拖动是靠 `document.addEventListener('pointerdown', startDrag)`
 * 这类真实事件监听器接线的，直接调用内部函数测不出「事件接得对不对」这一层；而 app.js 是
 * 原样内联进页面的经典 `<script>`（不是 module），顶层 `function` 声明会挂到 `window` 上，
 * 所以探测脚本能直接读 `window.growCanvasToFit` 之类的函数来做「不用真拖也能验证持久化重建」
 * 的那部分断言，两种手法搭配用。
 *
 * 本机没有 Chrome/Chromium 时用 `t.skip()` 明确跳过，不假装测过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FX, renderOk, findChrome, runInChrome } from './helpers.mjs';

/**
 * 探测脚本：对画布里第一个方块做几段真实拖动（派发 PointerEvent，走 app.js 真实的
 * pointerdown/pointermove/pointerup 监听器），逐段记录 `.topo-stage` 的尺寸与 SVG
 * viewBox，最后再验证「保存下来的坐标能不能原样重建出同一个画布尺寸」。
 */
const PROBE = `<script>
(function () {
  function fire(type, target, clientX, clientY) {
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, clientX: clientX, clientY: clientY,
    }));
  }
  // 一次「拖动」：按下、移动、抬起，中途那次 pointermove 之后立刻取一次画布尺寸——
  // 用来验证「跟手」：不等 pointerup 画布就已经变了，不是拖完才补一下。
  function dragBy(node, dx, dy) {
    var r = node.getBoundingClientRect();
    fire('pointerdown', node, r.left + 10, r.top + 10);
    fire('pointermove', document, r.left + 10 + dx, r.top + 10 + dy);
    var duringDrag = { w: stage.style.width, h: stage.style.height };
    fire('pointerup', document, r.left + 10 + dx, r.top + 10 + dy);
    return duringDrag;
  }

  var stage = document.querySelector('#view-overview .topo-stage');
  var svg = document.querySelector('#view-overview .topo-edges');
  var node = document.querySelector('#view-overview .topo-node');
  var steps = {};

  steps.fresh = { w: stage.style.width, h: stage.style.height,
    dataW: stage.dataset.w, dataH: stage.dataset.h };

  // 1) 往右下方拖出很远：画布 MUST 变大去装下它，viewBox MUST 跟着同步（否则线会被拉伸变形）。
  steps.duringGrow = dragBy(node, 3000, 3000);
  steps.afterGrow = { w: stage.style.width, h: stage.style.height, viewBox: svg.getAttribute('viewBox') };

  // 2) 往左上方拖回内部很靠中间的地方：画布 MUST 跟着缩小（但不必比原始尺寸更小）。
  steps.afterShrinkBack = (function () {
    dragBy(node, -2500, -2500);
    return { w: stage.style.width, h: stage.style.height };
  })();

  // 3) 拖到左上角原点之外（负坐标）：MUST 触发「整体平移 + 画布变大」而不是把元素弄丢，
  //    平移之后 MUST 仍然一个都不重叠（每个方块离画布边缘至少留 CANVAS_MARGIN）。
  steps.afterNegativeDrag = (function () {
    dragBy(node, -4000, -4000);
    var boxes = Array.from(document.querySelectorAll('#view-overview .topo-node')).map(function (el) {
      return { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 };
    });
    return { w: stage.style.width, h: stage.style.height,
      minX: Math.min.apply(null, boxes.map(function (b) { return b.x; })),
      minY: Math.min.apply(null, boxes.map(function (b) { return b.y; })) };
  })();

  // 4) 「恢复自动摆放」MUST 把画布精确收回程序算出来的原始尺寸。
  document.querySelector('[data-reset-layout]').click();
  steps.afterReset = { w: stage.style.width, h: stage.style.height };

  // 5) 持久化：不新增字段单独存画布尺寸，是因为 growCanvasToFit() 对同一组方块/分组框坐标
  //    永远算出同一个尺寸——存回文件那一刻的画布大小，靠重新套用保存下来的坐标就能精确重建。
  //    这里不接真的文件系统（headless 环境没有 showSaveFilePicker），只验证这条「可重建」的
  //    核心机制：拖出去、记住当时的坐标与画布尺寸，重置后再原样套用那批坐标，画布尺寸 MUST 一样。
  dragBy(node, 1800, 1600);
  var grownW = stage.style.width, grownH = stage.style.height;
  var saved = window.collectPositions();
  document.querySelector('[data-reset-layout]').click();
  window.applyPositions(saved);
  steps.persistedReplay = { grownW: grownW, grownH: grownH,
    replayedW: stage.style.width, replayedH: stage.style.height };

  document.title = 'R=' + encodeURIComponent(JSON.stringify(steps));
})();
</script>`;

test('画布自动伸缩：拖出边界会长大、拖回来会缩小、下限是原始尺寸、能从保存的坐标重建', async (t) => {
  const chrome = findChrome();
  if (!chrome) {
    t.skip('本机没有 Chrome/Chromium（可用 CHROME 环境变量指定）——这条这次没有验证，不算通过');
    return;
  }

  const html = renderOk(FX('three-groups.topology.yaml'), 'canvas-resize.html');
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'canvas-resize-'));
  try {
    const steps = runInChrome(chrome, html, PROBE, { workDir });
    const originalW = Number(steps.fresh.dataW);
    const originalH = Number(steps.fresh.dataH);

    // 新鲜打开、还没拖动过：画布 MUST 就是程序算出来的原始尺寸，一像素都不该多。
    assert.equal(steps.fresh.w, `${originalW}px`, '新鲜打开时画布宽度不是程序算出来的原始尺寸');
    assert.equal(steps.fresh.h, `${originalH}px`, '新鲜打开时画布高度不是程序算出来的原始尺寸');

    // 跟手：pointerup 之前（拖动过程中）画布已经变大了，不是松手那一刻才补一下。
    const duringW = parseFloat(steps.duringGrow.w);
    const duringH = parseFloat(steps.duringGrow.h);
    assert.ok(duringW > originalW && duringH > originalH,
      `拖动过程中（还没松手）画布应该已经变大，实际 ${steps.duringGrow.w}x${steps.duringGrow.h}`);

    // 拖出去之后：画布变大，且 viewBox 与像素尺寸保持 1:1（否则线会被缩放拉变形）。
    const grownW = parseFloat(steps.afterGrow.w);
    const grownH = parseFloat(steps.afterGrow.h);
    assert.ok(grownW > originalW, `往右下拖出画布后宽度应该变大，实际 ${steps.afterGrow.w}`);
    assert.ok(grownH > originalH, `往右下拖出画布后高度应该变大，实际 ${steps.afterGrow.h}`);
    assert.equal(steps.afterGrow.viewBox, `0 0 ${Math.round(grownW)} ${Math.round(grownH)}`,
      'viewBox 没有跟着 .topo-stage 的像素尺寸同步，连线会被浏览器整体缩放拉变形');

    // 拖回中间：画布应该比刚才的「撑到最大」时小（缩回去了），但不必然等于原始尺寸
    // （这份 fixture 有 5 个节点，挪其中一个回中间，其余节点原本的分布可能仍然比原始画布宽）。
    const shrunkW = parseFloat(steps.afterShrinkBack.w);
    const shrunkH = parseFloat(steps.afterShrinkBack.h);
    assert.ok(shrunkW < grownW || shrunkH < grownH,
      `元素拖回中间后画布应该跟着缩小，拖出时 ${steps.afterGrow.w}x${steps.afterGrow.h}，`
        + `缩回后却是 ${steps.afterShrinkBack.w}x${steps.afterShrinkBack.h}`);
    assert.ok(shrunkW >= originalW && shrunkH >= originalH,
      `画布不该缩得比程序算出来的原始尺寸（${originalW}x${originalH}）还小，`
        + `实际 ${steps.afterShrinkBack.w}x${steps.afterShrinkBack.h}`);

    // 往左上角拖出负坐标：MUST 触发整体平移，平移之后所有方块的左上角 MUST 仍然落在
    // 画布内、离边缘至少留出安全余量（这里用 >= -0.5 容忍取整），而不是被弄丢在看不见的负坐标里。
    assert.ok(steps.afterNegativeDrag.minX >= -0.5 && steps.afterNegativeDrag.minY >= -0.5,
      `往左上方拖出负坐标之后，应该整体平移回正坐标区，实际最靠边的方块在 `
        + `(${steps.afterNegativeDrag.minX}, ${steps.afterNegativeDrag.minY})`);

    // 恢复自动摆放：画布 MUST 精确收回原始尺寸。
    assert.equal(steps.afterReset.w, `${originalW}px`, '恢复自动摆放之后画布宽度没有精确收回原始尺寸');
    assert.equal(steps.afterReset.h, `${originalH}px`, '恢复自动摆放之后画布高度没有精确收回原始尺寸');

    // 持久化可重建：拖出去时的画布尺寸，和「重置后原样套用当时保存的坐标」重建出来的尺寸
    // MUST 完全一样——这就是「存回文件不用单独存画布尺寸」这个设计要成立的前提。
    assert.equal(steps.persistedReplay.replayedW, steps.persistedReplay.grownW,
      '拿保存下来的坐标重放，重建出的画布宽度跟拖动时的实际宽度对不上');
    assert.equal(steps.persistedReplay.replayedH, steps.persistedReplay.grownH,
      '拿保存下来的坐标重放，重建出的画布高度跟拖动时的实际高度对不上');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
