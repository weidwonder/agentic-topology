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

function showFolded(folded) {
  const overview = document.getElementById('view-overview');
  const foldedView = document.getElementById('view-folded');
  if (!overview || !foldedView) return;
  overview.hidden = folded;
  foldedView.hidden = !folded;
  window.scrollTo({ top: 0 });
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

// 来回两条边（A→B 与 B→A）在这里会算出同一条曲线、只是首尾颠倒，叠上去就只剩一条。
// 两条边方向相反、法线也相反，所以两边都朝各自的法线让开同样的距离，就分到了路径两侧。
// 这个值 MUST 与 scripts/lib/layout.mjs 的 EDGE_PAIR_OFFSET 一致，否则拖动前后错开量会变。
const PAIR_OFFSET = 10;

/** 一条边要不要错开：只有反向边也在图上时才错，单向边照旧走正中间。 */
function pairSeparation(edgeKeys, fromId, toId) {
  if (fromId === toId) return 0;
  return edgeKeys.has(`${toId}->${fromId}`) ? PAIR_OFFSET : 0;
}

function routeEdge(from, to, separation) {
  const fromMid = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const toMid = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = toMid.x - fromMid.x;
  const dy = toMid.y - fromMid.y;
  let start;
  let end;
  let c1;
  let c2;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const offset = Math.max(40, Math.abs(dx) * 0.4);
    start = { x: dx >= 0 ? from.x + from.w : from.x, y: fromMid.y };
    end = { x: dx >= 0 ? to.x : to.x + to.w, y: toMid.y };
    c1 = { x: start.x + (dx >= 0 ? offset : -offset), y: start.y };
    c2 = { x: end.x - (dx >= 0 ? offset : -offset), y: end.y };
  } else {
    const offset = Math.max(36, Math.abs(dy) * 0.4);
    start = { x: fromMid.x, y: dy >= 0 ? from.y + from.h : from.y };
    end = { x: toMid.x, y: dy >= 0 ? to.y : to.y + to.h };
    c1 = { x: start.x, y: start.y + (dy >= 0 ? offset : -offset) };
    c2 = { x: end.x, y: end.y - (dy >= 0 ? offset : -offset) };
  }
  if (separation) {
    const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    // 只沿卡片那条边滑动：起终点贴在边框上，往边框外挪要么缩到卡片底下，要么空出一道缝。
    // 上面挑边时已按 dx/dy 谁大定了从哪条边出去，这里跟着那个判断取分量即可。
    const shift = Math.abs(dx) >= Math.abs(dy)
      ? { x: 0, y: ((end.x - start.x) / length) * separation }
      : { x: (-(end.y - start.y) / length) * separation, y: 0 };
    const move = (point) => ({ x: point.x + shift.x, y: point.y + shift.y });
    start = move(start);
    end = move(end);
    c1 = move(c1);
    c2 = move(c2);
  }
  const round = (value) => Math.round(value * 10) / 10;
  const mid = {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  };
  return {
    d: `M${round(start.x)},${round(start.y)} C${round(c1.x)},${round(c1.y)} ` +
      `${round(c2.x)},${round(c2.y)} ${round(end.x)},${round(end.y)}`,
    labelX: round(mid.x),
    labelY: round(mid.y),
  };
}

function redrawEdges() {
  const nodes = new Map([...document.querySelectorAll('.topo-node')].map((el) => [el.dataset.nodeId, el]));
  const paths = [...document.querySelectorAll('#view-overview path[data-edge-id]')];
  const edgeKeys = new Set(paths.map((path) => path.dataset.edgeId));
  const seen = new Set();
  for (const path of paths) {
    const key = path.dataset.edgeId;
    const [fromId, toId] = key.split('->');
    const from = nodes.get(fromId);
    const to = nodes.get(toId);
    if (!from || !to) continue;
    const geometry = routeEdge(boxOf(from), boxOf(to), pairSeparation(edgeKeys, fromId, toId));
    path.setAttribute('d', geometry.d);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = document.querySelector(`#view-overview text[data-edge-id="${CSS.escape(key)}"]`);
    if (label) {
      label.setAttribute('x', geometry.labelX);
      label.setAttribute('y', geometry.labelY);
    }
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
    positions.groups[frame.dataset.groupId] = { x: box.x, y: box.y };
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
  redrawEdges();
}

function resetPositions() {
  for (const element of document.querySelectorAll('#view-overview .topo-node, #view-overview .topo-frame'))
    moveElement(element, Number(element.dataset.x), Number(element.dataset.y));
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
      setHint('位置已经写回文件了');
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
  setHint('这个浏览器不支持直接写回文件，已经下载了一份带位置的新文件，覆盖原文件即可');
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
  if (event.target.closest('[data-expand]') || event.target.closest('[data-back]')) {
    showFolded(false);
    return;
  }
  const node = event.target.closest('[data-goto]');
  if (node && !node.dataset.suppressClick) {
    const detail = document.getElementById(`detail-${node.dataset.goto}`);
    openModal(detail, node.querySelector('.topo-node-name')?.textContent || '详情');
    return;
  }
  // 点一条线 MUST 能看到它的详情（FR-026）——线本身、加宽的点击区、线上的标注都算。
  const edge = event.target.closest('[data-edge-id]');
  if (edge) {
    const detail = document.querySelector(`[data-edge-detail="${CSS.escape(edge.dataset.edgeId)}"]`);
    openModal(detail, edge.dataset.edgeId);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

applyPositions(readData()?.positions);
