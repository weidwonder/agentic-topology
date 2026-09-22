#!/usr/bin/env node
/**
 * 浏览器证据工具：拿一份已经出好的 `<主题>.topology.html`，在真 Chrome 里打开，
 * 量出它在浏览器里到底长什么样——横向有没有溢出、纵向多高、标注有没有压方块、
 * 方块之间有没有重叠——写成一份绑定产物 sha256 的机器可读收据，外加两张截图。
 *
 * ## 为什么有这个工具，为什么不在 agentic-topology/ 里
 *
 * `agentic-topology/tests/` 下二十多个测试全是对 HTML 字符串做断言，从没在真浏览器里打开过
 * 产物——标签压线、线穿方块、折叠挤成一团、大视口底部一片空白，这类问题测试上完全是盲的。
 * 这个工具补的就是这块盲区：拿真 Chrome 当量尺，把"浏览器里量到的行为"变成可复核的数字。
 *
 * 不放进 `agentic-topology/scripts/`：那个目录被 `tests/acceptance.test.mjs` 钉死一条
 * 「全仓只有 write-output.mjs 碰文件系统写操作」的不变量，这工具要写 png 和 json，放进去
 * 就把那条不变量弄红了。它也不是技能交付物的一部分——使用者装的是技能，不是这个工具。
 *
 * ## 三件事分开报，谁也不蕴含谁
 *
 * - **`chrome.status`**：这次检查有没有真的跑起来（`available` / `unavailable`）。
 * - **浏览器里量到的行为**：`containment`（横纵有没有溢出）与 `overlap`（方块/标注有没有压叠）——
 *   这两项是 Chrome 实际渲染后量出来的硬数字，`status: "pass"` 只对这两项负责。
 * - **`visualReview: "pending"`**：人有没有拿眼睛看过、看着顺不顺眼——这项工具永远回答不了，
 *   收据里永远写死 `"pending"`，不会因为前两项都 pass 就悄悄升级。
 *
 * `skipped` 永远不能升级成 pass：Chrome 找不到时退出码是 2、`status` 是 `"skipped"`，
 * 不产出任何看起来像"过了"的假象。
 *
 * ## 怎么量
 *
 * 复用 `tools/shoot.mjs` 里已经跑通的调用方式：`--headless` + `--screenshot` + `--dump-dom`，
 * 把测量结果编码进探测页面的 `<title>` 再用 `--dump-dom` 读回来。不追求 archify 那套
 * DevTools pipe 的优雅机制——先把证据拿到手，比机制好看更要紧。
 *
 * 压叠检测：往拍照副本里注入一段脚本，对 `.topo-node` / `.topo-fold`（方块与折叠堆）
 * 和 `.topo-elabel`（连线上的信息标注）各自取 `getBoundingClientRect()`，两两算相交面积。
 * 两者能直接放在同一坐标系里比较——`.topo-stage` 的像素宽高与它内部 `<svg>` 的
 * `viewBox` 逐一对应（本仓渲染器保证 1 viewBox 单位 = 1 CSS 像素，无缩放），
 * `.topo-edges` 又以 `inset: 0` 铺满整个 stage，所以 SVG 里量出来的矩形与 HTML 方块的
 * `getBoundingClientRect()` 天然同源，不需要另外换算。
 *
 * 视口高度校准：Chrome headless 的 `--window-size` 在本机实测会让 `window.innerHeight`
 * 比请求值矮一截（疑似给一条不存在的工具栏留位），且这个差值会随平台/版本变化——
 * 所以不硬编码这个数字，改为每次跑先用一张空白页测出当前这次的真实偏移量，
 * 再据此换算出请求给 Chrome 的 `--window-size`，让最终量到的视口精确等于目标视口。
 *
 * 跑法：node tools/visual-check.mjs <html> [--out <目录>]
 * CHROME 环境变量可覆盖 Chrome / Chromium 可执行文件路径。
 *
 * 退出码：0 全部通过 · 1 量出了问题（溢出或压叠）· 2 Chrome 不可用，本次检查未跑成
 *        （收据 `status` 是 `"skipped"`，不是 `"pass"`）· 3 参数或输入文件有问题
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXIT = { PASS: 0, FAIL: 1, SKIPPED: 2, BAD_ARGS: 3 };

// 四个桌面视口：前两个是常见笔记本/桌面尺寸，后两个专门盯"大视口"这一类——
// README 与 TODO 里记过的「大视口下底部一大片空白」正是要在这个尺寸段量出来。
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

const VIEWS = ['overview', 'folded'];

function usage() {
  return [
    '用法：node tools/visual-check.mjs <topology.html> [--out <目录>]',
    '',
    '拿一份已渲染好的 <主题>.topology.html，在真 Chrome 里打开量出它的浏览器行为',
    '（横纵有没有溢出、方块与标注有没有压叠），写一份收据 + 两张截图。',
    '',
    'CHROME 环境变量可覆盖 Chrome / Chromium 可执行文件路径。',
  ].join('\n');
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function which(command) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * 找 Chrome。CHROME 环境变量显式给了就只信它——给了一个不存在的路径，
 * MUST 报错而不是悄悄回落到自动探测，不然使用者以为自己指定的那个在跑，
 * 实际跑的是别的一份。
 */
function findChrome() {
  if (process.env.CHROME) {
    return existsSync(process.env.CHROME) ? path.resolve(process.env.CHROME) : null;
  }
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
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const resolved = which(command);
    if (resolved) return resolved;
  }
  return null;
}

function runChrome(chrome, args, { timeout = 30000 } = {}) {
  return spawnSync(chrome, args, { encoding: 'utf8', timeout });
}

/**
 * 校准 `--window-size` 与真实视口之间的偏移。用一张空白页请求一个参考尺寸，
 * 把 Chrome 实际给出的 `window.innerWidth/innerHeight` 读回来，两者之差就是这次运行、
 * 这台机器、这个 Chrome 版本的真实偏移——量出来的，不是抄一个别处见过的数字。
 */
function calibrateViewportOffset(chrome, workDir) {
  const probe = path.join(workDir, 'calibrate.html');
  writeFileSync(probe, '<!doctype html><html><body><script>'
    + 'document.title = "C=" + window.innerWidth + "x" + window.innerHeight;'
    + '</script></body></html>');
  const reference = { width: 1000, height: 700 };
  const result = runChrome(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--dump-dom',
    `--window-size=${reference.width},${reference.height}`, `file://${probe}`,
  ]);
  const hit = /<title>C=(\d+)x(\d+)<\/title>/.exec(result.stdout || '');
  if (!hit) {
    throw new Error(`校准视口偏移失败，Chrome 没有按预期回填 <title>：\n${result.stderr || result.stdout}`);
  }
  return {
    deltaW: reference.width - Number(hit[1]),
    deltaH: reference.height - Number(hit[2]),
  };
}

/** 按 tools/shoot.mjs 里验证过的写法切视图：swap 两个 <section> 的 hidden 属性。 */
function selectView(html, view) {
  if (view === 'overview') return html;
  if (view === 'folded') {
    if (!html.includes('<section id="view-folded" class="view" hidden>')) return null;
    return html
      .replace('<section id="view-overview" class="view">', '<section id="view-overview" class="view" hidden>')
      .replace('<section id="view-folded" class="view" hidden>', '<section id="view-folded" class="view">');
  }
  throw new Error(`未知视图：${view}`);
}

/**
 * 注入的探测脚本：量容器溢出，并对"方块/折叠堆"与"连线标注"两类元素两两取
 * getBoundingClientRect() 算相交面积。三个数值判据都写在这里、不在外层重算，
 * 避免探测页面里算出来的数字和外层报告的数字对不上。
 */
function probeScript() {
  return `<script>
(function () {
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  function overlapOf(a, b) {
    var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    // 0.5px 容差：避免两个恰好贴边的方块因为子像素取整被误判成"压叠"。
    if (w > 0.5 && h > 0.5) return { w: w, h: h, area: w * h };
    return null;
  }
  function textOf(el) {
    return (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
  }
  var cards = Array.from(document.querySelectorAll('.topo-node, .topo-fold')).map(function (el) {
    var r = rectOf(el);
    var id = el.getAttribute('data-node-id');
    if (!id) {
      var nameEl = el.querySelector('.topo-fold-name, .topo-node-name');
      id = nameEl ? textOf(nameEl) : textOf(el);
    }
    return Object.assign({ id: id }, r);
  }).filter(function (c) { return c.w > 0 && c.h > 0; });
  var labels = Array.from(document.querySelectorAll('.topo-elabel')).map(function (el) {
    return Object.assign({ text: textOf(el) }, rectOf(el));
  }).filter(function (l) { return l.w > 0 && l.h > 0; });

  var cardOverlaps = [];
  for (var i = 0; i < cards.length; i += 1) {
    for (var j = i + 1; j < cards.length; j += 1) {
      var o = overlapOf(cards[i], cards[j]);
      if (o) cardOverlaps.push({ a: cards[i].id, b: cards[j].id, w: Math.round(o.w), h: Math.round(o.h), area: Math.round(o.area) });
    }
  }
  var labelCardOverlaps = [];
  for (var k = 0; k < labels.length; k += 1) {
    for (var m = 0; m < cards.length; m += 1) {
      var o2 = overlapOf(labels[k], cards[m]);
      if (o2) labelCardOverlaps.push({ label: labels[k].text, card: cards[m].id, w: Math.round(o2.w), h: Math.round(o2.h), area: Math.round(o2.area) });
    }
  }

  // .topo-wrap 自己也是个 overflow:auto 的滚动容器（画布比它宽就在它内部横向滚动，
  // 不会冒泡成页面级溢出）。只看 document.documentElement 量不出这一层——
  // 画布在容器内部被裁掉一截，document 的 scrollWidth 完全不知情，分开量、分开报。
  // 两个视图（overview / folded）的 <section> 同时在 DOM 里，只有一个没挂 [hidden]。
  // 不限定在当前可见视图内找，querySelector 会捞到另一个视图里 display:none 的
  // .topo-wrap，量出一堆假的 0——这个坑只在两个视图并存的页面上才会踩到。
  var wrap = document.querySelector('.view:not([hidden]) .topo-wrap');
  var wrapOverflow = wrap ? {
    scrollWidth: Math.ceil(wrap.scrollWidth),
    scrollHeight: Math.ceil(wrap.scrollHeight),
    clientWidth: wrap.clientWidth,
    clientHeight: wrap.clientHeight,
  } : null;

  var result = {
    wrapOverflow: wrapOverflow,
    scrollWidth: Math.ceil(document.documentElement.scrollWidth),
    scrollHeight: Math.ceil(document.documentElement.scrollHeight),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    cardCount: cards.length,
    labelCount: labels.length,
    cardOverlaps: cardOverlaps,
    labelCardOverlaps: labelCardOverlaps,
  };
  document.title = 'R=' + encodeURIComponent(JSON.stringify(result));
})();
</script>`;
}

function measureInViewport(chrome, htmlForView, viewport, offset, workDir, tag) {
  const probe = path.join(workDir, `${tag}.html`);
  writeFileSync(probe, htmlForView.replace('</body>', `${probeScript()}</body>`));
  const requestedWidth = viewport.width + offset.deltaW;
  const requestedHeight = viewport.height + offset.deltaH;
  const result = runChrome(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--dump-dom',
    '--virtual-time-budget=4000',
    `--window-size=${requestedWidth},${requestedHeight}`, `file://${probe}`,
  ]);
  const hit = /<title>R=([^<]*)<\/title>/.exec(result.stdout || '');
  if (!hit) {
    throw new Error(`量不出视口指标（${tag}）：\n${result.stderr || result.stdout}`);
  }
  return JSON.parse(decodeURIComponent(hit[1]));
}

/**
 * .topo-wrap 是它自己的横向滚动容器（overflow: auto），固定宽度截图会把滚出去的那截
 * 悄悄吃掉——图看起来"内容被裁掉了"，其实只是没滚过去，两者是完全不同的问题，
 * 截图工具不该把后者伪装成前者。所以拍照副本里把 .topo-wrap 强制 overflow: visible，
 * 让画布整个摊开，再照实测一次摊开后的宽高——只改拍照用的这份副本，不动出图产物本身。
 */
function unwrapCanvas(html) {
  return html.replace('</head>',
    '<style>.topo-wrap{overflow:visible!important}</style></head>');
}

/** 页面摊开后的真实宽高：同一招——把 scrollWidth/scrollHeight 写进 <title> 再读回来。 */
function measureFullSize(chrome, htmlForView, workDir, tag) {
  const probe = path.join(workDir, `${tag}-size.html`);
  writeFileSync(probe, htmlForView.replace('</body>',
    '<script>document.title = "S=" + document.documentElement.scrollWidth + "x" + document.documentElement.scrollHeight;</script></body>'));
  const result = runChrome(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--dump-dom',
    '--virtual-time-budget=4000', '--window-size=1440,900', `file://${probe}`,
  ]);
  const hit = /<title>S=(\d+)x(\d+)<\/title>/.exec(result.stdout || '');
  if (!hit) throw new Error(`量不出页面尺寸（${tag}）：\n${result.stderr || result.stdout}`);
  return {
    width: Math.min(9000, Math.max(1440, Number(hit[1])) + 24),
    height: Math.min(9000, Number(hit[2]) + 24),
  };
}

function shootFullPage(chrome, htmlForView, workDir, tag, outPng) {
  const unwrapped = unwrapCanvas(htmlForView);
  const probe = path.join(workDir, `${tag}-shot.html`);
  writeFileSync(probe, unwrapped);
  const { width, height } = measureFullSize(chrome, unwrapped, workDir, tag);
  const result = runChrome(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--screenshot=${outPng}`, `--window-size=${width},${height}`,
    '--force-device-scale-factor=2', `file://${probe}`,
  ], { timeout: 30000 });
  if (!existsSync(outPng)) throw new Error(`截图失败（${tag}）：\n${result.stderr || result.stdout}`);
}

function buildIssues(viewportResults) {
  const issues = [];
  for (const entry of viewportResults) {
    if (entry.overflowX || entry.overflowY) {
      issues.push({
        code: 'containment/overflow',
        view: entry.view,
        viewport: { width: entry.width, height: entry.height },
        message: `${entry.view} 视图在 ${entry.width}x${entry.height} 视口下${entry.overflowX ? '横向' : ''}${entry.overflowX && entry.overflowY ? '和' : ''}${entry.overflowY ? '纵向' : ''}溢出`,
        evidence: {
          scrollWidth: entry.scrollWidth, innerWidth: entry.innerWidth,
          scrollHeight: entry.scrollHeight, innerHeight: entry.innerHeight,
        },
      });
    }
    if (entry.wrapOverflowX || entry.wrapOverflowY) {
      issues.push({
        code: 'containment/wrap-overflow',
        view: entry.view,
        viewport: { width: entry.width, height: entry.height },
        message: `${entry.view} 视图的画布容器（.topo-wrap）在 ${entry.width}x${entry.height} 视口下需要${entry.wrapOverflowX ? '横向' : ''}${entry.wrapOverflowX && entry.wrapOverflowY ? '和' : ''}${entry.wrapOverflowY ? '纵向' : ''}滚动才能看全——这层不会冒泡成整页溢出，document 级 containment 检查看不见它`,
        evidence: entry.wrapOverflow,
      });
    }
    for (const o of entry.cardOverlaps) {
      issues.push({
        code: 'overlap/card-card',
        view: entry.view,
        viewport: { width: entry.width, height: entry.height },
        message: `方块「${o.a}」与「${o.b}」在 ${entry.width}x${entry.height} 视口下重叠 ${o.w}x${o.h}px`,
        evidence: o,
      });
    }
    for (const o of entry.labelCardOverlaps) {
      issues.push({
        code: 'overlap/label-card',
        view: entry.view,
        viewport: { width: entry.width, height: entry.height },
        message: `连线标注「${o.label}」压到方块「${o.card}」，在 ${entry.width}x${entry.height} 视口下重叠 ${o.w}x${o.h}px`,
        evidence: o,
      });
    }
  }
  return issues;
}

async function main() {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a) => !a.startsWith('--'));
  const outIndex = argv.indexOf('--out');
  const htmlArg = positional[0];

  if (!htmlArg || argv.includes('-h') || argv.includes('--help')) {
    console.log(usage());
    process.exit(htmlArg ? EXIT.PASS : EXIT.BAD_ARGS);
    return;
  }

  const htmlPath = path.resolve(htmlArg);
  if (!existsSync(htmlPath)) {
    console.error(`找不到文件：${htmlPath}`);
    process.exit(EXIT.BAD_ARGS);
    return;
  }
  if (!/\.html?$/i.test(htmlPath)) {
    console.error(`只接受 .html：${htmlPath}`);
    process.exit(EXIT.BAD_ARGS);
    return;
  }

  const outDir = outIndex >= 0 && argv[outIndex + 1]
    ? path.resolve(argv[outIndex + 1])
    : path.dirname(htmlPath);
  mkdirSync(outDir, { recursive: true });

  const stem = path.basename(htmlPath).replace(/\.html?$/i, '');
  const receiptPath = path.join(outDir, `${stem}.visual-check.json`);

  const artifactBytes = readFileSync(htmlPath);
  const artifactSha = sha256Hex(artifactBytes);
  const html = artifactBytes.toString('utf8');

  const receipt = {
    schemaVersion: 1,
    tool: 'visual-check',
    checkedAt: new Date().toISOString(),
    artifact: {
      // 绝对路径：收据要能脱离"跑的时候 cwd 在哪"被人读懂，不依赖调用者当时的目录。
      path: htmlPath,
      sha256: artifactSha,
      bytes: artifactBytes.byteLength,
    },
    chrome: { status: 'unavailable', executable: null },
    // 三件事分开报：status 只对下面 viewports 里量到的 containment/overlap 数字负责，
    // visualReview 永远是这份收据答不了的那一半，MUST NOT 因为 status 是 pass 就顺手改成别的值。
    status: 'fail',
    visualReview: 'pending',
    viewports: [],
    issues: [],
    screenshots: [],
  };

  const chrome = findChrome();
  if (!chrome) {
    receipt.status = 'skipped';
    receipt.error = process.env.CHROME
      ? `CHROME 环境变量指向的路径不可用：${process.env.CHROME}`
      : '没找到 Chrome / Chromium。设置 CHROME 环境变量指向可执行文件后重跑。';
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.error(receipt.error);
    console.error(`收据（status: skipped）已写到 ${receiptPath} —— 这不是"通过"，是"没跑成"。`);
    process.exit(EXIT.SKIPPED);
    return;
  }
  receipt.chrome = { status: 'available', executable: chrome };

  const workDir = mkdtempSync(path.join(os.tmpdir(), 'visual-check-'));
  try {
    const offset = calibrateViewportOffset(chrome, workDir);
    receipt.chrome.viewportCalibration = offset;

    const availableViews = VIEWS.filter((view) => selectView(html, view) !== null);
    if (availableViews.length === 0) {
      throw new Error('页面里连 view-overview 都没有，产物结构和预期不一致。');
    }

    for (const view of availableViews) {
      const viewHtml = selectView(html, view);
      for (const viewport of VIEWPORTS) {
        const tag = `${view}-${viewport.width}x${viewport.height}`;
        const metrics = measureInViewport(chrome, viewHtml, viewport, offset, workDir, tag);
        const overflowX = metrics.scrollWidth > metrics.innerWidth;
        const overflowY = metrics.scrollHeight > metrics.innerHeight;
        receipt.viewports.push({
          view,
          width: viewport.width,
          height: viewport.height,
          innerWidth: metrics.innerWidth,
          innerHeight: metrics.innerHeight,
          scrollWidth: metrics.scrollWidth,
          scrollHeight: metrics.scrollHeight,
          overflowX,
          overflowY,
          // 底部空白：只如实记录量到的像素数，不据此下"好不好看"的判断——
          // 那是人眼复核的事，不是这份收据能替人拍板的。
          bottomWhitespacePx: Math.max(0, metrics.innerHeight - metrics.scrollHeight),
          cardCount: metrics.cardCount,
          labelCount: metrics.labelCount,
          cardOverlaps: metrics.cardOverlaps,
          labelCardOverlaps: metrics.labelCardOverlaps,
          // 画布自己的容器（.topo-wrap）也能横向/纵向滚动，这层溢出不会冒泡成上面的
          // document 级 overflowX/Y——单独量、单独报，两者不互相蕴含。
          wrapOverflowX: metrics.wrapOverflow ? metrics.wrapOverflow.scrollWidth > metrics.wrapOverflow.clientWidth : false,
          wrapOverflowY: metrics.wrapOverflow ? metrics.wrapOverflow.scrollHeight > metrics.wrapOverflow.clientHeight : false,
          wrapOverflow: metrics.wrapOverflow,
        });
      }
    }

    for (const view of availableViews) {
      const viewHtml = selectView(html, view);
      const outPng = path.join(outDir, `${stem}.visual-check.${view}.png`);
      shootFullPage(chrome, viewHtml, workDir, view, outPng);
      receipt.screenshots.push({ view, file: outPng });
    }

    // 证据链保护：如果检查过程中产物被重新渲染覆盖了，这份收据就不再对得上它绑定的 sha256，
    // 与其悄悄写一份名不副实的收据，不如直接报错。
    const afterBytes = readFileSync(htmlPath);
    if (sha256Hex(afterBytes) !== artifactSha || afterBytes.byteLength !== artifactBytes.byteLength) {
      throw new Error('检查过程中产物文件被改动了，收据绑定的 sha256 已经对不上，本次检查作废。');
    }

    receipt.issues = buildIssues(receipt.viewports);
    receipt.status = receipt.issues.length === 0 ? 'pass' : 'fail';

    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

    console.log(`视口 × 视图共 ${receipt.viewports.length} 组测量，发现 ${receipt.issues.length} 处问题。`);
    for (const issue of receipt.issues) console.log(`  [${issue.code}] ${issue.message}`);
    console.log(`收据：${receiptPath}`);
    for (const shot of receipt.screenshots) console.log(`截图：${shot.file}`);
    console.log('visualReview: pending —— 这份收据只是浏览器量出来的数字，人眼复核还没做。');

    process.exit(receipt.status === 'pass' ? EXIT.PASS : EXIT.FAIL);
  } catch (error) {
    receipt.status = 'fail';
    receipt.error = error.message;
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.error(`visual-check 跑失败了：${error.message}`);
    console.error(`收据：${receiptPath}`);
    process.exit(EXIT.FAIL);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();
