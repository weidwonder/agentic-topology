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

test('回归：核对清单默认收起，用折叠列表呈现而不是一次性铺满整屏', () => {
  const ov = sect(H(), 'view-overview');
  assert.match(
    ov,
    /<details class="topo-acc-item"><summary class="topo-acc-head">这几处得你自己去核实/,
    '核对清单应该用未展开的 <details> 折叠，不是一次性全铺开',
  );
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
