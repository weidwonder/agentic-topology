function applyFilter(data, { confidence = null, kind = null, group = null } = {}) {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const filters = { confidence, kind, group };
  const visibleNodes = nodes.filter((node) => Object.entries(filters).every(([dimension, values]) =>
    !values || values.includes(node[dimension])));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  return {
    visibleNodeIds: visibleNodes.map((node) => node.id),
    visibleEdgeKeys: edges
      .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
      .map((edge) => `${edge.from}->${edge.to}`),
  };
}

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
  if (event.target.closest('[data-back]')) window.scrollTo({ top: 0, behavior: 'smooth' });
});
