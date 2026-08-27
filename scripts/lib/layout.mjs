const CONSTANTS = { width: 320, height: 100, gap: 32, margin: 24 };

/** 为节点计算确定性的单列布局。 */
export function layout(data) {
  const nodes = new Map();
  const list = Array.isArray(data.nodes) ? data.nodes : [];
  list.forEach((node, index) => nodes.set(node.id, {
    x: CONSTANTS.margin,
    y: CONSTANTS.margin + index * (CONSTANTS.height + CONSTANTS.gap),
    w: CONSTANTS.width,
    h: CONSTANTS.height,
    row: index,
    col: 0,
  }));
  return {
    stage: {
      w: CONSTANTS.width + CONSTANTS.margin * 2,
      h: Math.max(160, list.length * (CONSTANTS.height + CONSTANTS.gap)),
    },
    nodes,
    groups: new Map(),
    edges: [],
    warnings: [],
  };
}

/** 计算折叠布局占位结果。 */
export function layoutFolded() {
  return { stage: { w: 0, h: 0 }, cards: new Map(), edges: [], warnings: [] };
}
