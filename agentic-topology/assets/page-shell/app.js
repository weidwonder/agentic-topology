/*SLOT:APPLY_FILTER*/

const stage = () => document.querySelector('#view-overview .topo-stage');
const dataElement = () => document.getElementById('topology-data');

function readData() {
  const element = dataElement();
  if (!element) return null;
  try { return JSON.parse(element.textContent); } catch (error) { return null; }
}

function syncFilters() {
  const data = readData();
  if (!data) return;
  const selected = (dimension) => {
    const values = [...document.querySelectorAll(`[data-filter-dimension="${dimension}"]:checked`)]
      .map((input) => input.value);
    return values.length ? values : null;
  };
  const result = applyFilter(data, {
    confidence: selected('confidence'),
    kind: selected('kind'),
    group: selected('group'),
  });
  const visibleNodes = new Set(result.visibleNodeIds);
  const visibleEdges = new Set(result.visibleEdgeKeys);
  for (const element of document.querySelectorAll('[data-node-id]'))
    element.classList.toggle('is-hidden', !visibleNodes.has(element.dataset.nodeId));
  for (const element of document.querySelectorAll('[data-edge-id]'))
    element.classList.toggle('is-hidden', !visibleEdges.has(element.dataset.edgeId));
  // 线上标注身上没有 data-edge-id（它不是连线浮层的入口），所以上面那一轮收不到它。
  // 漏了这一句，筛掉一条边、它那行字还留在图上——与「拖动后标注不跟随」同一个根因。
  for (const element of document.querySelectorAll('[data-label-for]'))
    element.classList.toggle('is-hidden', !visibleEdges.has(element.dataset.labelFor));
}

// ---- 高亮：这份东西流经哪几条线 --------------------------------------------
// 淡出用 .topo-dim，MUST NOT 复用筛选的 .is-hidden——两套状态共用一个类，
// 取消筛选会把高亮一起抹掉，取消高亮又会把筛掉的东西放回来。

let litInfo = null;

function edgesCarrying(data, infoId) {
  return (data.edges || []).filter((edge) =>
    (edge.payloads || []).some((payload) => payload.info === infoId));
}

function clearHighlight() {
  litInfo = null;
  for (const element of document.querySelectorAll('.topo-dim')) element.classList.remove('topo-dim');
  for (const element of document.querySelectorAll('.topo-lit')) element.classList.remove('topo-lit');
  const bar = document.querySelector('[data-infobar]');
  if (bar) { delete bar.dataset.lit; bar.replaceChildren(); }
}

function highlightInfo(infoId) {
  const data = readData();
  if (!data) return;
  const info = (data.information || []).find((item) => item.id === infoId);
  if (!info) return;
  // 再点一次同一份就是取消——这是唯一不需要找按钮的退出方式。
  if (litInfo === infoId) { clearHighlight(); return; }
  clearHighlight();
  litInfo = infoId;
  const carrying = edgesCarrying(data, infoId);
  const litEdges = new Set(carrying.map((edge) => `${edge.from}->${edge.to}`));
  const litNodes = new Set();
  for (const edge of carrying) { litNodes.add(edge.from); litNodes.add(edge.to); }
  // 被高亮连线两端的方块保持全亮：只亮线不亮两头，看的人得自己顺着线找端点。
  for (const element of document.querySelectorAll('#view-overview [data-node-id]'))
    element.classList.toggle('topo-dim', !litNodes.has(element.dataset.nodeId));
  for (const element of document.querySelectorAll('#view-overview [data-edge-id]')) {
    const lit = litEdges.has(element.dataset.edgeId);
    element.classList.toggle('topo-dim', !lit);
    element.classList.toggle('topo-lit', lit);
  }
  for (const label of document.querySelectorAll('#view-overview text.topo-elabel')) {
    const lit = [...label.querySelectorAll('[data-info-id]')]
      .some((span) => span.dataset.infoId === infoId);
    label.classList.toggle('topo-dim', !lit);
    label.classList.toggle('topo-lit', lit);
  }
  const bar = document.querySelector('[data-infobar]');
  if (bar) {
    bar.dataset.lit = infoId;
    const name = document.createElement('strong');
    name.textContent = info.name || info.id;
    const what = document.createElement('span');
    what.className = 'grow muted';
    what.textContent = info.what || '';
    const count = document.createElement('span');
    count.textContent = data.ui?.carrying?.[infoId] ?? String(carrying.length);
    const close = document.createElement('button');
    close.className = 'btn btn-ghost btn-sm';
    close.textContent = data.ui?.clearLit ?? '';
    close.dataset.clearLit = '';
    bar.replaceChildren(name, what, count, close);
  }
}

// ---- 详情弹层 --------------------------------------------------------------
// 详情全部预渲染在 #detail-store 里，弹层只负责把对应那一段搬到眼前。
// 这样离线单文件不用任何模板引擎，点开也不会有一帧空白。
function openModal(source, title) {
  const modal = document.getElementById('topo-modal');
  const body = document.getElementById('topo-modal-body');
  if (!modal || !body || !source) return;
  body.replaceChildren(source.cloneNode(true));
  const heading = document.getElementById('topo-modal-title');
  if (heading && title) heading.textContent = title;
  modal.hidden = false;
  modal.querySelector('.topo-modal-close')?.focus();
}

function closeModal() {
  const modal = document.getElementById('topo-modal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.getElementById('topo-modal-body')?.replaceChildren();
}

const VIEW_IDS = ['view-overview', 'view-folded', 'view-info'];

/** 一屏只呈现一件事：切到哪个就只显示哪个，其余一律收起来。 */
function showView(id) {
  for (const viewId of VIEW_IDS) {
    const view = document.getElementById(viewId);
    if (view) view.hidden = viewId !== id;
  }
  window.scrollTo({ top: 0 });
}

function showFolded(folded) {
  showView(folded ? 'view-folded' : 'view-overview');
}

// ---- 连线重算 --------------------------------------------------------------
// 拖过之后就没有「列」这回事了，出图时那套按列分情形的走线在这里不适用；
// 这里一律按两个方块的实际相对位置挑边、拉贝塞尔，拖到哪都能连上。
function boxOf(element) {
  return {
    x: parseFloat(element.style.left) || 0,
    y: parseFloat(element.style.top) || 0,
    w: element.offsetWidth,
    h: element.offsetHeight,
  };
}

// 一个方块上挂着好几条线时，它们 MUST NOT 都从同一条边框的正中出入——全挤在一点，
// 箭头叠成一团，看不出哪条线连的是谁。所以分两步：先按两个方块的相对位置定「走哪条边框」，
// 再把落在同一条边框上的接点沿这条边框排开。
// 这两个常量与下面四个分槽函数（anchorRatio / anchorPoint / anchorSortKey / assignAnchors）
// 是 scripts/lib/layout.mjs 那份的逐字副本，改这边 MUST 同改那边，否则同一张图在出图时
// 和拖过之后接点会跳；六个符号是否还同解由 tests/edges.test.mjs 的「同源」用例逐个钉住。
const ANCHOR_PAD = 10;
const ANCHOR_SLOT = 18;

/** 同一条边框上第 index 个（共 count 个）接点落在这条边框的哪个比例位置。只有一条线时就是正中。 */
function anchorRatio(index, count, length) {
  if (count <= 1) return 0.5;
  // 摊开的总宽不超过边框减掉两头留白；线少时按 ANCHOR_SLOT 收着排，免得两条线也摊成一把扇子。
  const usable = Math.max(0, length - ANCHOR_PAD * 2);
  const spacing = Math.min(ANCHOR_SLOT, usable / count);
  return 0.5 + ((index - (count - 1) / 2) * spacing) / length;
}

/** 比例位置换成边框线上的实际坐标：接点永远贴在边框上，既不进方块也不出方块。 */
function anchorPoint(box, side, ratio) {
  if (side === 'top') return { x: box.x + box.w * ratio, y: box.y };
  if (side === 'bottom') return { x: box.x + box.w * ratio, y: box.y + box.h };
  if (side === 'left') return { x: box.x, y: box.y + box.h * ratio };
  return { x: box.x + box.w, y: box.y + box.h * ratio };
}

/** 同一条边框上谁排前面：看对端在哪边。对端靠上的线接点也靠上，线就不用互相穿过去。 */
function anchorSortKey(side, other) {
  return side === 'left' || side === 'right' ? other.y + other.h / 2 : other.x + other.w / 2;
}

/** 拖过之后没有「列」这回事：横着差得多就走左右两条边框，否则走上下。 */
function edgeSides(from, to) {
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy))
    return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
  return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}

/**
 * 一次算完整张图的接点：按「方块 + 哪条边框」归堆，堆内按对端方位排序，再沿边框均分。
 * 排序 MUST 有确定的 tie-break（这里用边的键 + 是首端还是尾端），否则每次重画的顺序都可能不一样。
 */
function assignAnchors(plans) {
  const bySide = new Map();
  for (const plan of plans) {
    for (const endpoint of [plan.tail, plan.head]) {
      const key = `${endpoint.nodeId}\u0000${endpoint.side}`;
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key).push(endpoint);
    }
  }
  for (const endpoints of bySide.values()) {
    endpoints.sort((a, b) => (a.sortKey - b.sortKey)
      || (a.tieBreak < b.tieBreak ? -1 : a.tieBreak > b.tieBreak ? 1 : 0));
    // 同一桶里的端点按定义就是同一个方块的同一条边框，box 取第一个即可，下面一路用它。
    const { box, side } = endpoints[0];
    const length = side === 'left' || side === 'right' ? box.h : box.w;
    endpoints.forEach((endpoint, index) => {
      endpoint.point = anchorPoint(box, side, anchorRatio(index, endpoints.length, length));
    });
  }
}

/**
 * 接点定了之后拉贝塞尔：控制点朝出发的那条边框的法线方向探出去，线才是从边上「长」出来的。
 * 只收 fromSide 是因为**假定 toSide 是 fromSide 的对边**（右↔左、下↔上），这由 edgeSides() 保证，
 * 所以两端的外推方向必然相反、同一个 sign 一正一负就够。将来若加一种不对称的挑边（比如 右→上），
 * MUST 同时把 toSide 传进来各算各的 sign，否则这里会静默画错。
 */
function routeEdge(start, end, fromSide) {
  const horizontal = fromSide === 'left' || fromSide === 'right';
  const sign = fromSide === 'right' || fromSide === 'bottom' ? 1 : -1;
  const offset = horizontal
    ? Math.max(40, Math.abs(end.x - start.x) * 0.4)
    : Math.max(36, Math.abs(end.y - start.y) * 0.4);
  const c1 = horizontal
    ? { x: start.x + sign * offset, y: start.y }
    : { x: start.x, y: start.y + sign * offset };
  const c2 = horizontal
    ? { x: end.x - sign * offset, y: end.y }
    : { x: end.x, y: end.y - sign * offset };
  const round = (value) => Math.round(value * 10) / 10;
  const point = (t) => {
    const u = 1 - t;
    return {
      x: u ** 3 * start.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * end.x,
      y: u ** 3 * start.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * end.y,
    };
  };
  return {
    d: `M${round(start.x)},${round(start.y)} C${round(c1.x)},${round(c1.y)} ` +
      `${round(c2.x)},${round(c2.y)} ${round(end.x)},${round(end.y)}`,
    point,
  };
}

// ---- 标注退让 --------------------------------------------------------------
// 出图时 layout.mjs 会把每行字推开去躲卡片和别人的标注；拖动之后这里得重来一遍，
// 否则一次重画就把那套排布全抹平、所有字落回线中点糊成一团。
// 退让参数**不在这里写死**：出图时随 topology-data 一起注入（唯一真相在 layout.mjs），
// 这样两边的退让力度永远一致，MUST NOT 在这里另起一套数字。
function labelRules() {
  const rules = readData()?.labelLayout;
  return {
    tValues: rules?.T_VALUES || [0.5],
    step: rules?.STEP || 8,
    steps: rules?.STEPS || 0,
    sizes: rules?.sizes || {},
  };
}

function labelBox(point, size) {
  return { x: point.x - size.w / 2, y: point.y - size.h / 2, w: size.w, h: size.h };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** 曲线上某点的法线：用邻近两点的切线求，弯的地方也是真的「垂直于线」让开。 */
function normalAt(geometry, t) {
  const before = geometry.point(Math.max(0, t - 0.01));
  const after = geometry.point(Math.min(1, t + 0.01));
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

/** 沿线取一串 t、每个 t 再往法线两侧一格格挪；越靠中点、离线越近的越先试。 */
function labelCandidates(geometry, rules) {
  const candidates = [];
  for (const t of rules.tValues) {
    const base = geometry.point(t);
    const normal = normalAt(geometry, t);
    for (let step = 0; step <= rules.steps; step += 1) {
      const distances = step === 0 ? [0] : [step * rules.step, -step * rules.step];
      for (const distance of distances) {
        candidates.push({
          point: { x: base.x + normal.x * distance, y: base.y + normal.y * distance },
          cost: Math.abs(distance) + 120 * Math.abs(t - 0.5),
        });
      }
    }
  }
  return candidates.sort((a, b) => a.cost - b.cost);
}

/** 挑第一个不压到任何障碍物的位置；一个都挑不到就退回线中点（和出图时同一个兜底）。 */
function placeLabel(geometry, size, obstacles, rules) {
  for (const candidate of labelCandidates(geometry, rules)) {
    const box = labelBox(candidate.point, size);
    if (!obstacles.some((obstacle) => overlaps(box, obstacle))) return candidate.point;
  }
  return geometry.point(0.5);
}

/** 这行字占多大：优先在浏览器里现量，量不到（无 getBBox 的环境）用出图时估的值。 */
function labelSize(element, key, rules) {
  const measured = element?.getBBox?.();
  if (measured && measured.width > 0) return { w: measured.width, h: measured.height };
  return rules.sizes[key] || { w: 0, h: 0 };
}

function redrawEdges() {
  const nodes = new Map([...document.querySelectorAll('.topo-node')].map((el) => [el.dataset.nodeId, el]));
  const boxes = new Map();
  const boxOfNode = (id) => {
    if (!boxes.has(id)) boxes.set(id, boxOf(nodes.get(id)));
    return boxes.get(id);
  };
  // 一条边在 DOM 里有两个 path（画出来那条 + 加宽的点击区），它们共用一个 data-edge-id。
  // 分槽按「边」算，MUST NOT 按 path 算——按 path 算等于每条边都被数了两遍，接点会摊开一倍。
  const plans = new Map();
  for (const path of document.querySelectorAll('#view-overview path[data-edge-id]')) {
    const key = path.dataset.edgeId;
    if (plans.has(key)) {
      plans.get(key).paths.push(path);
      continue;
    }
    const [fromId, toId] = key.split('->');
    if (!nodes.has(fromId) || !nodes.has(toId)) continue;
    const from = boxOfNode(fromId);
    const to = boxOfNode(toId);
    const { fromSide, toSide } = edgeSides(from, to);
    plans.set(key, {
      key,
      paths: [path],
      fromSide,
      tail: { nodeId: fromId, side: fromSide, box: from,
        sortKey: anchorSortKey(fromSide, to), tieBreak: `${key}#tail` },
      head: { nodeId: toId, side: toSide, box: to,
        sortKey: anchorSortKey(toSide, from), tieBreak: `${key}#head` },
    });
  }
  assignAnchors([...plans.values()]);
  const rules = labelRules();
  // 标注要躲的是**看不清**：方块会把它整个盖住，别的标注会跟它糊在一起。
  // 分堆的框 MUST NOT 算障碍物——堆内的线整条都在自己框里，把框当障碍就无处可放。
  // 这一条与出图时同源（layout.mjs 的 obstacles 也只收方块 + 已放的标注）。
  const obstacles = [...boxes.values()];
  for (const plan of plans.values()) {
    const geometry = routeEdge(plan.tail.point, plan.head.point, plan.fromSide);
    for (const path of plan.paths) path.setAttribute('d', geometry.d);
    // 靠 data-label-for 认这行字。MUST NOT 用 data-edge-id——标注身上没有那个属性
    // （它标的是「连线浮层的入口」，标注不是入口），按它找永远是 null，
    // 线跟着拖走了、字却留在原地。
    const label = document.querySelector(
      `#view-overview text[data-label-for="${CSS.escape(plan.key)}"]`);
    if (!label) continue;
    const size = labelSize(label, plan.key, rules);
    const point = placeLabel(geometry, size, obstacles, rules);
    obstacles.push(labelBox(point, size));
    const round = (value) => Math.round(value * 10) / 10;
    label.setAttribute('x', round(point.x));
    label.setAttribute('y', round(point.y));
  }
}

// ---- 拖动与位置持久化 ------------------------------------------------------
let dirty = false;

function markDirty(value) {
  dirty = value;
  const bar = document.querySelector('[data-canvas-bar]');
  if (bar) bar.dataset.dirty = value ? '1' : '0';
}

function moveElement(element, x, y) {
  element.style.left = `${Math.round(x)}px`;
  element.style.top = `${Math.round(y)}px`;
}

function membersOfGroup(groupId) {
  return [...document.querySelectorAll(`.topo-node[data-group="${CSS.escape(groupId)}"]`)];
}

// 分组框的内边距，跟出图时 layout.mjs 的 GROUP_PAD_X / GROUP_PAD_TOP 一个口径。
const GROUP_PAD_X = 24;
const GROUP_PAD_TOP = 26;

/** 把每个分组框收紧到组内方块的外接矩形。
 *  方块能被拖到框外面，框却不跟着走的话，「这块属于哪一堆」就变成了假信息。 */
function fitGroups() {
  for (const frame of document.querySelectorAll('#view-overview .topo-frame')) {
    const members = membersOfGroup(frame.dataset.groupId);
    if (members.length === 0) continue;
    const boxes = members.map(boxOf);
    const left = Math.min(...boxes.map((box) => box.x)) - GROUP_PAD_X;
    const top = Math.min(...boxes.map((box) => box.y)) - GROUP_PAD_TOP;
    const right = Math.max(...boxes.map((box) => box.x + box.w)) + GROUP_PAD_X;
    const bottom = Math.max(...boxes.map((box) => box.y + box.h)) + GROUP_PAD_X;
    moveElement(frame, left, top);
    frame.style.width = `${Math.round(right - left)}px`;
    frame.style.height = `${Math.round(bottom - top)}px`;
  }
}

function startDrag(event) {
  const target = event.target.closest('.topo-node, .topo-frame');
  if (!target || !stage()?.contains(target)) return;
  // 弹层里的详情不参与拖动；点在按钮上也不拖。
  if (event.target.closest('button, a, summary, input, label')) return;
  const isGroup = target.classList.contains('topo-frame');
  const followers = isGroup ? membersOfGroup(target.dataset.groupId) : [];
  const origin = { x: event.clientX, y: event.clientY };
  const startBox = boxOf(target);
  const followerBoxes = followers.map((node) => ({ node, box: boxOf(node) }));
  let moved = false;
  target.classList.add('is-dragging');
  target.setPointerCapture?.(event.pointerId);

  const onMove = (moveEvent) => {
    const dx = moveEvent.clientX - origin.x;
    const dy = moveEvent.clientY - origin.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    moved = true;
    moveElement(target, startBox.x + dx, startBox.y + dy);
    for (const follower of followerBoxes) moveElement(follower.node, follower.box.x + dx, follower.box.y + dy);
    if (!isGroup) fitGroups();
    redrawEdges();
  };
  const onUp = () => {
    target.classList.remove('is-dragging');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if (moved) {
      markDirty(true);
      // 拖动结束才算「点过」——没真移动才当成点击去开详情。
      target.dataset.suppressClick = '1';
      setTimeout(() => delete target.dataset.suppressClick, 0);
    }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function collectPositions() {
  const positions = { nodes: {}, groups: {} };
  for (const node of document.querySelectorAll('#view-overview .topo-node')) {
    const box = boxOf(node);
    positions.nodes[node.dataset.nodeId] = { x: box.x, y: box.y };
  }
  for (const frame of document.querySelectorAll('#view-overview .topo-frame')) {
    const box = boxOf(frame);
    positions.groups[frame.dataset.groupId] = { x: box.x, y: box.y, w: box.w, h: box.h };
  }
  return positions;
}

function applyPositions(positions) {
  if (!positions) return;
  for (const [id, point] of Object.entries(positions.nodes || {})) {
    const node = document.querySelector(`#view-overview .topo-node[data-node-id="${CSS.escape(id)}"]`);
    if (node) moveElement(node, point.x, point.y);
  }
  for (const [id, point] of Object.entries(positions.groups || {})) {
    const frame = document.querySelector(`#view-overview .topo-frame[data-group-id="${CSS.escape(id)}"]`);
    if (frame) moveElement(frame, point.x, point.y);
  }
  fitGroups();
  redrawEdges();
}

function resetPositions() {
  for (const element of document.querySelectorAll('#view-overview .topo-node, #view-overview .topo-frame'))
    moveElement(element, Number(element.dataset.x), Number(element.dataset.y));
  for (const frame of document.querySelectorAll('#view-overview .topo-frame')) {
    frame.style.width = `${frame.dataset.w}px`;
    frame.style.height = `${frame.dataset.h}px`;
  }
  redrawEdges();
  markDirty(true);
}

function setHint(text) {
  const hint = document.querySelector('[data-canvas-hint]');
  if (hint) hint.textContent = text;
}

/** 把当前位置写进内嵌数据块，再整页序列化出来——存回去的还是一份能离线打开的单文件。 */
function serializePage() {
  const element = dataElement();
  const data = readData() || {};
  data.positions = collectPositions();
  element.textContent = JSON.stringify(data).replace(/<\/script/gi, '<\\/script');
  const clone = document.documentElement.cloneNode(true);
  // 筛选状态、打开的弹层都是这一次看图的临时状态，MUST NOT 焊进存回去的文件。
  for (const hidden of clone.querySelectorAll('.is-hidden')) hidden.classList.remove('is-hidden');
  // 高亮同理：它是这一次看图的临时状态，存回去的文件 MUST 是干净的。
  for (const dim of clone.querySelectorAll('.topo-dim')) dim.classList.remove('topo-dim');
  for (const lit of clone.querySelectorAll('.topo-lit')) lit.classList.remove('topo-lit');
  const infobar = clone.querySelector('[data-infobar]');
  if (infobar) { infobar.removeAttribute('data-lit'); infobar.replaceChildren(); }
  for (const checked of clone.querySelectorAll('[data-filter-dimension]')) checked.removeAttribute('checked');
  const modal = clone.querySelector('#topo-modal');
  if (modal) {
    modal.setAttribute('hidden', '');
    modal.querySelector('#topo-modal-body')?.replaceChildren();
  }
  const bar = clone.querySelector('[data-canvas-bar]');
  if (bar) bar.dataset.dirty = '0';
  return `<!doctype html>\n${clone.outerHTML}`;
}

let fileHandle = null;

async function saveLayout() {
  const html = serializePage();
  const canUseFileSystem = typeof window.showSaveFilePicker === 'function';
  if (canUseFileSystem) {
    try {
      if (!fileHandle) {
        const suggested = decodeURIComponent(location.pathname.split('/').pop() || 'topology.html');
        fileHandle = await window.showSaveFilePicker({
          suggestedName: suggested,
          types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }],
        });
      }
      const writable = await fileHandle.createWritable();
      await writable.write(html);
      await writable.close();
      markDirty(false);
      setHint(readData()?.ui?.savedOk ?? '');
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      // 授权失败或写入被拒时退回下载，别把人卡在这儿。
      fileHandle = null;
    }
  }
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = decodeURIComponent(location.pathname.split('/').pop() || 'topology.html');
  link.click();
  URL.revokeObjectURL(url);
  markDirty(false);
  setHint(readData()?.ui?.saveFallback ?? '');
}

// ---- 事件接线 --------------------------------------------------------------
document.addEventListener('change', (event) => {
  if (event.target.matches('[data-filter-dimension]')) syncFilters();
});

document.addEventListener('pointerdown', startDrag);

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-modal-close]')) { closeModal(); return; }
  if (event.target.closest('[data-save-layout]')) { saveLayout(); return; }
  if (event.target.closest('[data-reset-layout]')) { resetPositions(); return; }
  // 全貌 ↔ 折叠视图的入口（FR-032：MUST NOT 存在只能进不能出的层）
  if (event.target.closest('[data-goto-folded]')) { showFolded(true); return; }
  if (event.target.closest('[data-goto-info]')) { showView('view-info'); return; }
  if (event.target.closest('[data-expand]') || event.target.closest('[data-back]')) {
    showFolded(false);
    return;
  }
  if (event.target.closest('[data-clear-lit]')) { clearHighlight(); return; }
  // 线上的信息名、两处清单里的名字，点哪个都是同一件事：高亮这份东西流经的线。
  const infoName = event.target.closest('[data-info-id]');
  if (infoName) {
    const fromList = infoName.closest('#view-info');
    highlightInfo(infoName.dataset.infoId);
    // 从全量视图点进来的，MUST 回到画布——不然亮了也看不见。
    if (fromList && litInfo) showView('view-overview');
    return;
  }
  const node = event.target.closest('[data-goto]');
  if (node && !node.dataset.suppressClick) {
    const detail = document.getElementById(`detail-${node.dataset.goto}`);
    openModal(detail, node.querySelector('.topo-node-name')?.textContent
      || readData()?.ui?.detail || '');
    return;
  }
  // 点一条线 MUST 能看到它的详情（FR-026）——线本身与加宽的点击区都算。
  // 线上的标注**不算**：它是信息高亮的触发点，身上只有定位用的 data-label-for。
  const edge = event.target.closest('[data-edge-id]');
  if (edge) {
    const detail = document.querySelector(`[data-edge-detail="${CSS.escape(edge.dataset.edgeId)}"]`);
    openModal(detail, edge.dataset.edgeId);
    return;
  }
  // 点画布空白处取消高亮。
  if (litInfo && event.target.closest('.topo-stage')) clearHighlight();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeModal(); clearHighlight(); }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.dataset?.infoId) {
    event.preventDefault();
    highlightInfo(event.target.dataset.infoId);
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

applyPositions(readData()?.positions);
// 卡片高度是估出来的、正文又走 Markdown，实际渲染出来常比估算高一点；
// 开局先按真实尺寸把分组框收一遍，免得框底和最后一张卡片差出一截。
fitGroups();
