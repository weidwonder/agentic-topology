import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, renderOk, bodyText, sect, dataOf } from './helpers.mjs';

const H = () => renderOk(FX('three-groups.topology.yaml'), 'ov.html');

test('整图层常驻可见 + 起止标记', () => {
  const ov = sect(H(), 'view-overview');
  assert.match(ov, /一条固定流水线/);       // topology 白话
  assert.match(ov, /各看各的/);             // context_sharing 白话
  assert.match(ov, /topo-pill/);            // 发起标记
  assert.match(ov, /在哪.{0,4}结束/);       // 终止标记
  assert.match(ov, /校验连续失败/);         // 每个终点的终止条件都能看到
});

test('回归：发起标记不再绝对定位盖住分组框，entry 多长都不会糊住第一行节点', () => {
  const ov = sect(H(), 'view-overview');
  const pillOpen = ov.indexOf('<div class="topo-pill">');
  const stageOpen = ov.indexOf('<div class="topo-stage"');
  assert.ok(pillOpen >= 0 && stageOpen >= 0, '发起标记或图区没找到');
  assert.ok(pillOpen < stageOpen, '发起标记应该在图区前面的正常文档流里，不是叠在图上');
  assert.doesNotMatch(ov.slice(pillOpen, pillOpen + 60), /style="left:/, '发起标记不该再用像素坐标定位');
});

test('核对清单不单开一块，条目挂到各自的方块上，鼠标停上去看得到', () => {
  const ov = sect(H(), 'view-overview');
  assert.doesNotMatch(ov, /topo-checklist-scroll/, '核对清单不该再单开一个区域');
  assert.match(ov, /<span class="topo-warn" title="[^"]*需要你核实[^"]*"/, '方块上没有核实角标');
  assert.match(ov, /这几处得你自己去核实 \d+ 处/, '顶部该保留一个总数');
});

test('节点一眼可读：图上直接有职责文字', () => {
  const ov = sect(H(), 'view-overview');
  assert.match(ov, /topo-node-desc/);
  assert.match(ov, /列出全部材料/);
});

test('并发 >1 与会派子代理的节点，图上节点本身有可见标记', () => {
  const ov = sect(H(), 'view-overview');
  const n4 = ov.slice(ov.indexOf('data-node-id="N4"'), ov.indexOf('data-node-id="N4"') + 900);
  assert.match(n4, /topo-mark[^>]*is-conc/);
  assert.match(n4, /同时干\s*3\s*件/);
  // 并发为 1 的节点不得有并发标记
  const n1 = ov.slice(ov.indexOf('data-node-id="N1"'), ov.indexOf('data-node-id="N1"') + 900);
  assert.doesNotMatch(n1, /topo-mark[^>]*is-conc/);
});

test('可信度与节点属性分开摆，三档颜色可区分', () => {
  const html = H();
  assert.match(html, /topo-flag is-sure/);
  const css = html.match(/<style[\s\S]*?<\/style>/g).join('');
  for (const cls of ['is-sure', 'is-guess', 'is-unknown'])
    assert.match(css, new RegExp(`\\.topo-flag\\.${cls}`), `缺可信度样式 .${cls}`);
});

test('零外链', () => {
  const html = H();
  for (const bad of [/https?:\/\//, /fetch\s*\(/, /XMLHttpRequest/, /WebSocket/,
                     /<link[^>]+rel=["']stylesheet/, /<script[^>]+src=/, /@import/])
    assert.doesNotMatch(html, bad, `命中外链模式 ${bad}`);
});

test('界面白话：正文里没有契约词', () => {
  const body = bodyText(H());
  for (const w of ['节点', '传递物', '并发数', '可信度', '载体', '结构体', '执行者'])
    assert.ok(!body.includes(w), `界面正文出现了契约词「${w}」`);
});

test('标识符不翻译', () => {
  const html = renderOk(FX('base.topology.yaml'), 'ids.html');
  for (const id of ['read', 'write', 'edit']) assert.ok(html.includes(id));
});

test('HTML 转义，且内嵌数据块可安全取回', () => {
  const html = renderOk(FX('xss.topology.yaml'), 'xss.html');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const d = dataOf(html);
  assert.equal(d.nodes[0].responsibility, `<script>alert(1)</script>&"'`);
});

test('发起说明走 Markdown 渲染，占满整条宽度', () => {
  const html = renderOk(FX('three-groups.topology.yaml'), 'md.html');
  const ov = sect(html, 'view-overview');
  assert.match(ov, /class="topo-md"/, '发起说明没有走 Markdown 容器');
  const css = html.match(/<style[\s\S]*?<\/style>/g).join('');
  assert.match(css, /\.topo-pill\s*\{[^}]*width:\s*100%/, '发起说明没占满宽度');
});

test('方块与分组框半透明，底下的连线看得见', () => {
  const css = renderOk(FX('three-groups.topology.yaml'), 'alpha.html')
    .match(/<style[\s\S]*?<\/style>/g).join('');
  for (const [selector, name] of [[/\.topo-node\s*\{[^}]*/, '方块'], [/\.topo-frame\s*\{[^}]*/, '分组框']]) {
    const rule = css.match(selector)[0];
    assert.match(rule, /transparent/, `${name}不透明，会把连线整个盖住`);
  }
});

test('方块和分组都能拖，位置能存回文件', () => {
  const html = renderOk(FX('three-groups.topology.yaml'), 'drag.html');
  const ov = sect(html, 'view-overview');
  assert.match(ov, /data-group-id="g1"[^>]*data-x="/, '分组框没有可复位的原始坐标');
  assert.match(ov, /data-node-id="N1"[^>]*data-x="/, '方块没有可复位的原始坐标');
  assert.match(ov, /data-save-layout/, '没有存回文件的入口');
  assert.match(ov, /data-reset-layout/, '没有恢复自动摆放的入口');
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.match(script, /showSaveFilePicker/, '没接浏览器写文件能力');
  assert.match(script, /positions/, '位置没有进内嵌数据块');
  assert.match(script, /redrawEdges/, '拖动后连线不会跟着重画');
});

test('弹层默认藏着：display:flex 不能盖掉 [hidden]', () => {
  const html = renderOk(FX('three-groups.topology.yaml'), 'modal.html');
  assert.match(sect(html, 'topo-modal'), /id="topo-modal" hidden/, '弹层默认没藏起来');
  const css = html.match(/<style[\s\S]*?<\/style>/g).join('');
  assert.match(css, /\.topo-modal\[hidden\]\s*\{[^}]*display:\s*none/,
    '缺这条规则弹层会一直挂在屏幕上');
});

test('设计态：design 是合法档位，图上标「设计中」，且不进核对清单', () => {
  const html = renderOk(FX('design-state.topology.yaml'), 'design.html');
  const ov = sect(html, 'view-overview');
  assert.match(ov, /topo-flag is-design"[^>]*>设计中/, '设计态没有自己的徽章');
  assert.match(ov, /value="design"><span>设计中/, '筛选里没有「设计中」这一档');
  assert.doesNotMatch(ov, /topo-warn/, '设计态不该进核对清单——没落地的东西谈不上核实');
  assert.match(ov, /这几处得你自己去核实 0 处/, '整份设计稿的核实条目应当为 0');
});

test('底色只分 AI / 程序 / 岔路口三类，可信度不抢底色', () => {
  const html = renderOk(FX('three-groups.topology.yaml'), 'kinds.html');
  const ov = sect(html, 'view-overview');
  for (const [id, cls] of [['N3', 'is-agent'], ['N1', 'is-program'], ['N2', 'is-decision']])
    assert.match(ov, new RegExp(`class="topo-node ${cls}[^"]*" data-node-id="${id}"`), `${id} 没按类型上色`);
  const css = html.match(/<style[\s\S]*?<\/style>/g).join('');
  for (const [cls, color] of [['is-agent', '#2563eb'], ['is-program', '#d97706'], ['is-decision', '#7c3aed']])
    assert.match(css, new RegExp(`\\.topo-node\\.${cls}[^}]*${color}`), `${cls} 没有自己的底色`);
});

test('正文一律走 Markdown：卡片、详情、两头的说明都是', () => {
  const html = renderOk(FX('three-groups.topology.yaml'), 'md2.html');
  const ov = sect(html, 'view-overview');
  assert.match(ov, /topo-node-desc"><div class="topo-md">/, '卡片正文没走 Markdown');
  assert.match(ov, /topo-pill-head">从哪开始<\/div><div class="topo-md">/, '发起说明没走 Markdown');
  assert.match(ov, /topo-pill-head">在哪结束<\/div><div class="topo-exit">/, '收尾块没跟发起块统一');
  assert.match(sect(html, 'detail-store'), /<div class="topo-md">/, '详情正文没走 Markdown');
});

test('标题栏有这张图是谁的', () => {
  const ov = sect(renderOk(FX('three-groups.topology.yaml'), 'title.html'), 'view-overview');
  assert.match(ov, /class="topo-title">tests\/fixtures\/fake-project</, '标题栏没有拓扑标题');
});

test('发起说明与收尾说明都在画布外面，一前一后夹着图', () => {
  const ov = sect(renderOk(FX('three-groups.topology.yaml'), 'outside.html'), 'view-overview');
  const startAt = ov.indexOf('从哪开始');
  const wrapAt = ov.indexOf('<div class="topo-wrap">');
  const endAt = ov.indexOf('在哪结束');
  assert.ok(startAt >= 0 && wrapAt >= 0 && endAt >= 0, '三块都得在');
  assert.ok(startAt < wrapAt, '发起说明该在画布前面，不能塞进画布里');
  assert.ok(endAt > wrapAt, '收尾说明该在画布后面');
});

test('详情弹层：定义列表两列对齐，正文不往标签列里顶', () => {
  const css = renderOk(FX('three-groups.topology.yaml'), 'kv.html')
    .match(/<style[\s\S]*?<\/style>/g).join('');
  const row = css.match(/\.kv-row\s*\{[^}]*\}/)[0];
  assert.match(row, /display:\s*grid/, '两列对齐要用 grid，flex+space-between 会让正文顶回标签列');
  assert.match(row, /grid-template-columns/);
  const dd = css.match(/\.kv-row > dd\s*\{[^}]*\}/)[0];
  assert.match(dd, /text-align:\s*left/, '正文列该左对齐');
  const cell = css.match(/\.topo-chain-cell\s*\{[^}]*\}/)[0];
  assert.doesNotMatch(cell, /border:/, '弹层里那一格不该再画框——框在弹层内边距处会被裁掉半条边');
});

test('分组框跟着组内方块的外接矩形走，并且能复位', () => {
  const html = renderOk(FX('three-groups.topology.yaml'), 'fit.html');
  const ov = sect(html, 'view-overview');
  assert.match(ov, /data-group-id="g1"[^>]*data-w="\d+"[^>]*data-h="\d+"/, '分组框没留原始尺寸，复位不回去');
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.match(script, /function fitGroups\(\)/, '没有把分组框收紧到组内方块的逻辑');
  assert.match(script, /if \(!isGroup\) fitGroups\(\)/, '拖动方块时分组框没跟着缩放');
});
