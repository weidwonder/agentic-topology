import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, data, renderOk, sect, intersects } from './helpers.mjs';
import { layout, layoutFolded } from '../scripts/lib/layout.mjs';
import { foldSummary } from '../scripts/lib/interactions.mjs';

const DOC = () => data(FX('three-groups.topology.yaml'));

test('折叠不丢信息：节点 ID 集合与边 ID 集合都相等', () => {
  const doc = DOC();
  const s = foldSummary(doc);
  const inner = new Set(s.cards.flatMap((c) => c.nodeIds));
  assert.deepEqual([...inner].sort(), doc.nodes.map((n) => n.id).sort());
  const innerEdges = new Set(s.cards.flatMap((c) => c.innerEdgeKeys));
  const interEdges = new Set(s.interGroupEdges.flatMap((e) => e.sourceEdgeKeys));
  const all = new Set([...innerEdges, ...interEdges]);
  assert.deepEqual([...all].sort(), doc.edges.map((e) => `${e.from}->${e.to}`).sort());
});

test('堆间连线同向合并成一条，且能追溯到被合并的原始边', () => {
  const s = foldSummary(DOC());
  const pairs = s.interGroupEdges.map((e) => `${e.from}->${e.to}`);
  assert.equal(new Set(pairs).size, pairs.length, '同一对堆同一方向出现了多条线');
  for (const e of s.interGroupEdges) assert.ok(e.sourceEdgeKeys.length >= 1);
  assert.ok(pairs.includes('g1->g2'), '缺 g1→g2 这条堆间线');
});

test('堆间连线标注完全不被任何卡片覆盖（PRD 硬项）', () => {
  const F = layoutFolded(DOC());
  let checked = 0;
  for (const e of F.edges) {
    assert.equal(e.overlapUnresolved, false,
      `折叠视图不允许标注退让失败：${e.from}→${e.to}`);
    const lb = { x: e.labelX - e.labelW / 2, y: e.labelY - e.labelH / 2, w: e.labelW, h: e.labelH };
    for (const c of F.cards.values())
      assert.equal(intersects(lb, c), false, `标注「${e.label}」被卡片「${c.name}」覆盖了`);
    checked++;
  }
  assert.ok(checked >= 2, `应当至少有 2 条堆间线，实际 ${checked}`);
});

test('卡片摘要数字由程序数出，与实际一致', () => {
  const doc = DOC(), F = layoutFolded(doc);
  const g1 = F.cards.get('g1');
  assert.equal(g1.nodeCount, doc.nodes.filter((n) => n.group === 'g1').length);
  assert.equal(g1.agents, doc.nodes.filter((n) => n.group === 'g1' && n.kind === 'agent').length);
  assert.ok(g1.chain.length > 0, '要有一句「谁→谁→谁」的串联说明');
});

test('折叠视图有全部展开按钮与不丢信息的说明', () => {
  const v = sect(renderOk(FX('three-groups.topology.yaml'), 'fold.html'), 'view-folded');
  assert.match(v, /全部展开/);
  assert.match(v, /一个方块一条线都没少/);
  assert.match(v, /收起来只是不显示堆里面那\s*\d+\s*条线/);
});

test('跨堆连线标签放在首个真实间隙且不覆盖卡片', () => {
  const doc = data(FX('folded-span.topology.yaml'));
  const F = layoutFolded(doc);
  for (const e of F.edges) {
    const lb = { x: e.labelX - e.labelW / 2, y: e.labelY - e.labelH / 2, w: e.labelW, h: e.labelH };
    for (const c of F.cards.values()) assert.equal(intersects(lb, c), false);
  }
  const span = F.edges.find((e) => e.from === 'g1' && e.to === 'g3');
  assert.equal(span.confidence, 'inferred');
  assert.equal(span.overlapUnresolved, false);
  assert.equal(F.edges.every((e) => e.overlapUnresolved === false), true);
  const html = renderOk(FX('folded-span.topology.yaml'), 'folded-span.html');
  const folded = sect(html, 'view-folded');
  assert.match(folded, /topo-edge[^>]*is-inferred/);
});
