import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FX, renderOk, sect, dataOf } from './helpers.mjs';

test('行区间被内嵌并高亮，区间外的行不带进来', () => {
  const d = sect(renderOk(FX('base.topology.yaml'), 'pr.html'), 'view-node-detail');
  assert.match(d, /topo-src-body/);
  assert.match(d, /你是规划师。/);                      // 第 1 行在区间内
  assert.match(d, /不许调用任何写文件的工具。/);          // 第 6 行在区间内
  assert.ok(!d.includes('这一行在区间之外'), '第 7 行在区间外，不得被带进来');
  assert.match(d, /topo-line/);
});

test('文件名与行号恒常可见', () => {
  const d = sect(renderOk(FX('base.topology.yaml'), 'pr.html'), 'view-node-detail');
  assert.match(d, /planner\.v2\.md/);
  assert.match(d, /第\s*1[–\-]6\s*行/);
});

test('相对路径以描述文件所在目录为基准', async () => {
  const { enrich } = await import('../scripts/lib/enrich.mjs');
  const { data } = await import('./helpers.mjs').then((h) => h.load(FX('base.topology.yaml')));
  const r = await enrich(data, { baseDir: 'tests/fixtures' });
  const p = r.prompts.get('N3');
  assert.equal(p.kind, 'file');
  assert.equal(p.lines.length, 6);
  assert.equal(p.lines[0], '你是规划师。');
});

test('读不到时照常出图，该项进核对清单，且不拒绝出图', () => {
  const html = renderOk(FX('prompt-missing.topology.yaml'), 'pm.html');
  const d = sect(html, 'view-node-detail');
  assert.match(d, /读不到这个文件的第/);
  assert.match(d, /nope\.md/, '读不到也要显示文件名');
  const cl = dataOf(html).checklist;
  assert.ok(cl.some((c) => c.confidence === 'unread' && /提示词/.test(c.text)),
    '读不到的提示词必须进核对清单');
});

test('不做主机名判断：产物里没有任何伪造的可用性分支', () => {
  const html = readFileSync('tests/tmp/pr.topology.html', 'utf8');
  for (const bad of [/hostname/i, /origin_machine/i, /navigator\.clipboard/])
    assert.doesNotMatch(html, bad, `出现了被禁止的环境判断 ${bad}`);
});
