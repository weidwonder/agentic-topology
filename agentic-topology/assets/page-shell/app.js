/*SLOT:APPLY_FILTER*/

function syncFilters() {
  const dataElement = document.getElementById('topology-data');
  if (!dataElement) return;
  const data = JSON.parse(dataElement.textContent);
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

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-filter-dimension]')) syncFilters();
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-goto]');
  if (target) document.getElementById(`detail-${target.dataset.goto}`)?.scrollIntoView();
  // 点一条线 MUST 能看到它的详情（FR-026）——线本身、加宽的点击区、线上的标注都算。
  const edge = event.target.closest('[data-edge-id]');
  if (edge) document.querySelector(`[data-edge-detail="${edge.dataset.edgeId}"]`)?.scrollIntoView();
  // 全貌 → 折叠视图的入口（FR-032：MUST NOT 存在只能进不能出的层）
  if (event.target.closest('[data-goto-folded]')) document.getElementById('view-folded')?.scrollIntoView();
  if (event.target.closest('[data-back]')) window.scrollTo({ top: 0, behavior: 'smooth' });
  // 折叠视图的「全部展开」：全貌视图里每个方块每条线都画着，回到那里就是展开后的样子。
  if (event.target.closest('[data-expand]')) document.getElementById('view-overview')?.scrollIntoView();
});
