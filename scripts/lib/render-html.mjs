function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/** 将拓扑数据与布局渲染为不写文件的单文件 HTML。 */
export function renderHtml({ data, layout }) {
  const nodes = (data.nodes || []).map((node) => {
    const box = layout.nodes.get(node.id);
    return `<div class="node" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px">` +
      `<strong>${escapeHtml(node.name)}</strong><p>${escapeHtml(node.responsibility)}</p>` +
      `<small>${node.group ? escapeHtml(node.group) : '未填写'}</small></div>`;
  }).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>` +
    `.stage{position:relative;width:${layout.stage.w}px;height:${layout.stage.h}px}` +
    `.node{position:absolute;border:1px solid #999;padding:12px;box-sizing:border-box;background:#fff}` +
    `</style></head><body><main class="stage">${nodes}</main></body></html>`;
}
