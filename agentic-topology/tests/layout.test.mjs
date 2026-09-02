import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FX, data, intersects } from './helpers.mjs';
import { layout, nodeHeight } from '../scripts/lib/layout.mjs';
import { measureLabel, textWidth, wrapLineCount } from '../scripts/lib/measure.mjs';

// 卡片各段的实测尺寸，抄自 assets/page-shell/topo.css（改 CSS MUST 同步改这里）：
//   .topo-node      { width:184px; padding:8px 10px; border:1px; box-sizing:border-box }
//   .topo-node-top  里是 10px 的药丸：字 + 上下各 1px 内边距 + 1px 边框
//   .topo-node-name { font-size:12px;   line-height:1.35; margin-top:3px }
//   .topo-node-desc { font-size:10.5px; line-height:1.4;  margin-top:3px }
//   .topo-marks     { margin-top:5px } 里是 9.5px 的药丸
const CSS = {
  width: 184, padX: 10, padY: 8, border: 1, topRow: 17,
  nameSize: 12, nameLine: 12 * 1.35, nameGap: 3,
  descSize: 10.5, descLine: 10.5 * 1.4, descGap: 3,
  marks: 22,
};
const CONTENT_W = CSS.width - CSS.padX * 2 - CSS.border * 2;

/** 按 topo.css 重算一张卡片的文字到底要多高——高度是程序写死的，装不下就溢出下边界。 */
function 文字所需高度(node) {
  const name = String(node.name || '');
  const desc = String(node.responsibility || '');
  const marked = Number(node.concurrency?.default) > 1 || node.spawns_subagents === true;
  return CSS.padY * 2 + CSS.border * 2 + CSS.topRow
    + (name ? CSS.nameGap + wrapLineCount(name, CONTENT_W, CSS.nameSize) * CSS.nameLine : 0)
    + (desc ? CSS.descGap + wrapLineCount(desc, CONTENT_W, CSS.descSize) * CSS.descLine : 0)
    + (marked ? CSS.marks : 0);
}

test('measureLabel：中文 12px、ASCII 6px、高 16', () => {
  assert.deepEqual(measureLabel('abc'), { w: 18, h: 16 });
  assert.deepEqual(measureLabel('中文'), { w: 24, h: 16 });
  assert.deepEqual(measureLabel('a中'), { w: 18, h: 16 });
});

test('wrapLineCount：按全角/半角宽度换行，恰好撑满不换行', () => {
  assert.equal(wrapLineCount('a'.repeat(10), 60), 1); // 10*6=60，刚好不超
  assert.equal(wrapLineCount('a'.repeat(11), 60), 2); // 第 11 个字符超了
  assert.equal(wrapLineCount('中'.repeat(5), 60), 1); // 5*12=60，刚好不超
  assert.equal(wrapLineCount('中'.repeat(6), 60), 2);
});

test('textWidth：同一句话按不同字号折算出不同宽度', () => {
  assert.equal(textWidth('中中', 12), 24);
  assert.equal(textWidth('中中', 10.5), 21);
  assert.equal(textWidth('ab', 10.5), 10.5);
  assert.equal(textWidth('中a', 12), 18);
});

test('wrapLineCount：换行符按空白折叠，不当强制断行（卡片描述没设 white-space:pre-line）', () => {
  assert.equal(wrapLineCount('a\n\nb', 100), 1);
  assert.equal(wrapLineCount('', 100), 1);
});

test('nodeHeight 修复回归：中文责任描述按实际换行数算高度，不能再用「每行 26 字」估半截', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  const longText = '瑞星久宇被识成互久宇、瑞昱久宇、福建久宇，判同一实体看地址税号账号合同号型号这些硬信息。'
    .repeat(4); // 302 字左右，中文为主，跟 aiudit_platform 实际炸掉的 A3 节点同一量级
  doc.nodes[2].responsibility = longText;
  const oldBuggyExtraLines = Math.max(0, Math.ceil(longText.length / 26) - 2);
  const oldBuggyHeight = 76 + 14 * oldBuggyExtraLines;
  const box = layout(doc).nodes.get('N3');
  assert.ok(box.h >= Math.ceil(文字所需高度(doc.nodes[2])), '应按真实换行数出高度');
  assert.ok(box.h > oldBuggyHeight, '不能再退回旧的「长度/26」估算，那会比实际需要矮一大截');
});

test('卡片高度装得下名字：名字换行多几行，卡片就要高几行', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  const node = doc.nodes[2];
  node.responsibility = '按材料体量决定要不要开客户过滤，开了就先召回再逐块提。';
  node.name = '材料索引与转换';
  const 短名高度 = layout(doc).nodes.get('N3').h;
  // 真实数据里就有这么长的名字（「按材料体量决定要不要开客户过滤」一类），12px 下要占 3 行
  node.name = '按材料体量决定要不要开客户过滤（含扫描件识别与原件定位反查）';
  const 长名高度 = layout(doc).nodes.get('N3').h;
  const 多出的行数 = wrapLineCount(node.name, CONTENT_W, CSS.nameSize) - 1;
  assert.ok(多出的行数 >= 2, '这个名字应该要换 3 行，否则这条用例没在测该测的东西');
  assert.ok(长名高度 - 短名高度 >= 多出的行数 * CSS.nameLine - 1,
    `名字多换 ${多出的行数} 行，卡片只高了 ${长名高度 - 短名高度}px——名字没算进高度，描述会被挤出下边界`);
});

test('名字与描述按各自字号折算：12px 的名字比 10.5px 的描述先换行', () => {
  const 十五个字 = '按材料体量决定要不要开客户过滤';
  assert.equal(wrapLineCount(十五个字, CONTENT_W, CSS.nameSize), 2, '12px 下 15 个全角字要换 2 行');
  assert.equal(wrapLineCount(十五个字, CONTENT_W, CSS.descSize), 1, '10.5px 下同样 15 个字只占 1 行');
  // 名字那一行的行高（12*1.35≈16.2）比描述那一行（10.5*1.4≈14.7）高，多换一行也 MUST 按名字的行高算
  const 底料 = '把要求落到具体的检查项上，并给每项选好用哪些材料，逐条记下依据与出处，供下一步复核。';
  const 差值 = nodeHeight({ name: 十五个字, responsibility: 底料 }) - nodeHeight({ name: '索引', responsibility: 底料 });
  assert.ok(差值 >= 16 && 差值 <= 17,
    `名字多换一行应当高 16~17px（12px×1.35），实际高了 ${差值}px——按描述的行高或压根没算名字都会落在这个区间外`);
});

test('真实数据每张卡片都装得下自己的文字（名字 + 描述 + 并发标记）', () => {
  for (const name of ['benchmarks/aiudit.topology.yaml', 'aiudit-internal-control.topology.yaml']) {
    const doc = data(FX(name));
    const L = layout(doc);
    for (const node of doc.nodes) {
      const 需要 = 文字所需高度(node);
      const 给了 = L.nodes.get(node.id).h;
      assert.ok(给了 >= Math.ceil(需要),
        `${name} 的 ${node.id}：卡片高 ${给了}px，文字要 ${Math.ceil(需要)}px，会溢出下边界`);
    }
  }
});

test('分组各占一列，列序按 order', () => {
  const L = layout(data(FX('three-groups.topology.yaml')));
  assert.ok(L.groups.get('g1').x < L.groups.get('g2').x);
  assert.ok(L.groups.get('g2').x < L.groups.get('g3').x);
  assert.equal(L.groups.get('g1').col, 0);
});

test('组内按最长路径分层，同层同行', () => {
  const L = layout(data(FX('three-groups.topology.yaml')));
  assert.equal(L.nodes.get('N1').row, 0);
  assert.equal(L.nodes.get('N2').row, 1);
  assert.equal(L.nodes.get('N3').row, 2);
  assert.ok(L.nodes.get('N2').y > L.nodes.get('N1').y);
});

test('分组框包住本组全部节点，且不与别的分组框相交', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  const L = layout(doc);
  for (const n of doc.nodes) {
    const box = L.groups.get(n.group), b = L.nodes.get(n.id);
    assert.ok(b.x >= box.x && b.x + b.w <= box.x + box.w, `${n.id} 横向超出分组框`);
    assert.ok(b.y >= box.y && b.y + b.h <= box.y + box.h, `${n.id} 纵向超出分组框`);
  }
  const boxes = [...L.groups.values()];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      assert.equal(intersects(boxes[i], boxes[j]), false, '两个分组框相交了');
});

test('布局确定性：两次运行完全相同', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  assert.equal(JSON.stringify([...layout(doc).nodes]), JSON.stringify([...layout(doc).nodes]));
});

test('分组之间成环不失败，按原始顺序排并给出提示', () => {
  const L = layout(data(FX('cyclic-groups.topology.yaml')));
  assert.ok(L.warnings.some((w) => /成环/.test(w)));
  assert.ok(L.stage.w > 0 && L.stage.h > 0);
  assert.equal(L.nodes.size, 5);
});

test('全都没填分组时归入一个隐式分组，全部节点仍有坐标', () => {
  const L = layout(data(FX('no-group.topology.yaml')));
  assert.equal(L.nodes.size, 4);
  for (const [, b] of L.nodes) assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
});

test('部分节点没填分组时归入「没标堆的」并排最右', () => {
  const doc = data(FX('three-groups.topology.yaml'));
  delete doc.nodes[0].group;
  const L = layout(doc);
  const un = L.groups.get('__ungrouped__');
  assert.ok(un, '应当有隐式分组 __ungrouped__');
  for (const [id, g] of L.groups) if (id !== '__ungrouped__') assert.ok(g.x < un.x);
});
