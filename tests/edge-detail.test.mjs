import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, renderOk, sect } from './helpers.mjs';

const seg = (fx, out, key) => {
  const d = sect(renderOk(FX(fx), out), 'view-node-detail');
  const i = d.indexOf(`data-edge-detail="${key}"`);
  assert.ok(i >= 0, `没有 ${key} 的边详情容器`);
  const j = d.indexOf('data-edge-detail=', i + 1);
  return d.slice(i, j === -1 ? undefined : j);
};

test('边详情六项齐全', () => {
  const s = seg('multi-payload.topology.yaml', 'ed.html', 'N2->N3');
  for (const w of ['正常往下走', '什么情况下走', '靠什么交过去',
    '同时来了好几份怎么办', '查证时间'])
    assert.ok(s.includes(w), `边详情缺「${w}」`);
  assert.ok(s.includes('复用未命中'), 'trigger 的值要显示全，不是截断版');
});

test('5 个传递物全部列出，产生与传递时机各自可见', () => {
  const s = seg('multi-payload.topology.yaml', 'ed.html', 'N2->N3');
  assert.equal((s.match(/什么时候造出来的/g) || []).length, 5);
  assert.equal((s.match(/什么时候交出去的/g) || []).length, 5);
  for (const c of ['活儿说明文件', '开工纪律', '判分标准全文',
    '上轮打回原因', '一次性的交结论凭据'])
    assert.ok(s.includes(c), `漏了传递物「${c}」`);
});

test('同向合并的边，多个传递物逐个分别列出', () => {
  const s = seg('base.topology.yaml', 'ed2.html', 'N1->N2');
  assert.equal((s.match(/什么时候造出来的/g) || []).length, 2);
  assert.ok(s.includes('材料清册') && s.includes('用来比对的四个指纹'));
});

test('父子回传边的「收下之前先查什么」显著呈现', () => {
  const s = seg('multi-payload.topology.yaml', 'ed.html', 'SUB1->N3');
  assert.match(s, /收下之前先查什么/);
  assert.ok(s.indexOf('收下之前先查什么') < s.indexOf('查证时间'), '它应当排在靠前的位置');
});

test('边在图上可点击：有 data-edge-id 与加宽命中层', () => {
  const ov = sect(renderOk(FX('base.topology.yaml'), 'ed3.html'), 'view-overview');
  assert.match(ov, /data-edge-id="N1-&gt;N2"|data-edge-id="N1->N2"/);
  assert.match(ov, /class="topo-edge-hit"/);
});
