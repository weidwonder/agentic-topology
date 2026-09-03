import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FX, renderOk, sect, dataOf } from './helpers.mjs';

const html = (name, out) => renderOk(FX(name), out);

test('画布下方有信息清单概览卡：只列前 3 份，其余给一个看全部的入口', () => {
  const ov = sect(html('multi-payload.topology.yaml', 'iv1.html'), 'view-overview');
  const rows = (ov.match(/class="topo-info-row"/g) || []).length;
  assert.equal(rows, 3, `概览卡该只列 3 份，实际 ${rows} 份`);
  assert.match(ov, /data-goto-info/, '缺「看全部」入口');
});

test('全量视图七列列全，每份都能点', () => {
  const page = html('base.topology.yaml', 'iv2.html');
  const view = sect(page, 'view-info');
  assert.equal((view.match(/<th>/g) || []).length, 7, '不是七列');
  const total = dataOf(page).information.length;
  assert.equal((view.match(/data-info-row=/g) || []).length, total, '全量视图没把每一份都列出来');
  assert.equal((view.match(/data-info-id=/g) || []).length, total, '每份的名字都该能点');
});

test('全量视图有自己的返回入口，不用靠点某一份才退得出去', () => {
  const view = sect(html('base.topology.yaml', 'iv3.html'), 'view-info');
  assert.match(view, /data-back/, '全量视图关不掉');
});

test('线上的信息名按份可点，且不再是连线浮层的入口', () => {
  const ov = sect(html('base.topology.yaml', 'iv4.html'), 'view-overview');
  assert.match(ov, /<tspan class="topo-elabel-name" data-info-id="material-list">/);
  assert.equal(/<text class="topo-elabel"[^>]*data-edge-id/.test(ov), false,
    '线上标注还挂着 data-edge-id，一次点击会同时触发高亮和浮层');
  assert.match(ov, /class="topo-edge-hit" data-edge-id/, '连线浮层仍要有入口');
});

test('「等 N 份」那一段不指向任何一份，点它不该高亮谁', () => {
  const ov = sect(html('multi-payload.topology.yaml', 'iv5.html'), 'view-overview');
  const more = ov.match(/<tspan[^>]*>等 5 份<\/tspan>/);
  assert.ok(more, '没找到「等 5 份」');
  assert.equal(more[0].includes('data-info-id'), false, '「等 N 份」不该带 info 编号');
});

test('两处清单都挂核对角标，顶部总数把信息块级条目算进去', () => {
  const page = html('info-checklist.topology.yaml', 'iv6.html');
  const n = dataOf(page).checklist.length;
  assert.ok(n >= 4, `信息块级条目没进清单，只有 ${n} 条`);
  const ov = sect(page, 'view-overview');
  assert.match(ov, new RegExp(`这几处得你自己去核实 ${n} 处`), '顶部总数没算上信息块级条目');
  assert.match(ov, /class="topo-warn"[^>]*>⚠/, '概览卡上没挂角标');
  assert.match(sect(page, 'view-info'), /class="topo-warn"[^>]*>⚠/, '全量视图没挂角标');
});

test('推测与没读出来的信息名带可见标记，且没占用连线的虚实通道', () => {
  const view = sect(html('info-checklist.topology.yaml', 'iv7.html'), 'view-info');
  const row = view.slice(view.indexOf('data-info-row="material-list"'));
  assert.match(row.slice(0, 400), /topo-flag/, 'unread 的信息名没有可见标记');
  const ov = sect(html('info-checklist.topology.yaml', 'iv7b.html'), 'view-overview');
  const litEdge = ov.match(/<path class="topo-edge is-main[^"]*" data-edge-id="N1-&gt;N2"/);
  assert.ok(litEdge, '连线还在');
  assert.equal(/is-unread|is-inferred/.test(litEdge[0]), false,
    '连线的虚实只表示这条线本身查得准不准，MUST NOT 被信息的可信度占用');
});

test('空态：没有信息时清单说人话，不是一张空表', () => {
  const page = html('empty.topology.yaml', 'iv8.html');
  assert.match(sect(page, 'view-overview'), /这张图里还没有流转的信息/);
  assert.match(sect(page, 'view-info'), /这张图里还没有流转的信息/);
});

test('信息块的每个字段都过转义，恶意描述不会变成可执行的东西', () => {
  const page = html('xss.topology.yaml', 'iv9.html');
  // 内嵌数据块是 JSON、不当 HTML 解析，原文留在那里是对的；要查的是正文那几处。
  const rendered = sect(page, 'view-overview') + sect(page, 'view-info') + sect(page, 'detail-store');
  // 名字、一句话说明、组成三处各埋一个注入点，逐个确认落地时是文字而不是标签
  assert.equal(rendered.includes('<img src=x onerror'), false, '信息名没转义');
  assert.equal(rendered.includes('<svg onload='), false, '组成没转义');
  assert.equal(rendered.includes('<script>alert(3)'), false, '一句话说明没转义');
  assert.match(rendered, /&lt;img src=x onerror/);
  assert.match(rendered, /&lt;svg onload=/);
  // 内嵌数据块里仍是原文，取回来不该被改写
  assert.equal(dataOf(page).information[0].what, `<script>alert(3)</script>&"'`);
});

// ---- 高亮：页面脚本层 --------------------------------------------------------

test('淡出用的是独立的类，MUST NOT 复用筛选的 is-hidden', () => {
  const app = readFileSync('assets/page-shell/app.js', 'utf8');
  assert.match(app, /topo-dim/, '没有独立的淡出类');
  const highlight = app.slice(app.indexOf('function highlightInfo'), app.indexOf('// ---- 详情弹层'));
  assert.equal(highlight.includes('is-hidden'), false,
    '高亮碰了筛选的类，取消筛选会把高亮一起抹掉');
});

test('高亮时被点亮连线两端的方块保持全亮', () => {
  const app = readFileSync('assets/page-shell/app.js', 'utf8');
  assert.match(app, /litNodes\.add\(edge\.from\)/);
  assert.match(app, /litNodes\.add\(edge\.to\)/);
});

test('再点一次同一份就是取消，另有一个不用猜的取消按钮', () => {
  const app = readFileSync('assets/page-shell/app.js', 'utf8');
  assert.match(app, /if \(litInfo === infoId\) \{ clearHighlight\(\); return; \}/);
  assert.match(app, /data-clear-lit/);
  assert.match(app, /litInfo && event\.target\.closest\('\.topo-stage'\)/, '点画布空白处该能取消');
});

test('高亮态是这一次看图的临时状态，存回文件时被剥掉', () => {
  const app = readFileSync('assets/page-shell/app.js', 'utf8');
  const serialize = app.slice(app.indexOf('function serializePage'), app.indexOf('let fileHandle'));
  for (const cls of ['topo-dim', 'topo-lit'])
    assert.ok(serialize.includes(cls), `存回去的文件还带着 ${cls}`);
  assert.match(serialize, /infobar/, '状态栏内容没被剥掉');
});

test('从全量视图点一份，回到画布再高亮——不然亮了也看不见', () => {
  const app = readFileSync('assets/page-shell/app.js', 'utf8');
  assert.match(app, /if \(fromList && litInfo\) showView\('view-overview'\)/);
});

test('三个视图统一切换，一屏只呈现一件事', () => {
  const app = readFileSync('assets/page-shell/app.js', 'utf8');
  assert.match(app, /VIEW_IDS = \['view-overview', 'view-folded', 'view-info'\]/);
});
