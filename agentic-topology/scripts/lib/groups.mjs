/**
 * 分组推导的唯一实现。
 *
 * 主视图（layout）与折叠视图（foldSummary）MUST 用同一份。两处各写一遍时条件真的走岔过：
 * 一处只在「压根没声明 groups」时并成一堆，另一处还多一个「声明了 groups 但没有任何节点填
 * group」分支。于是同一份描述，折叠视图画出几张卡片、主视图却画成一个不分堆的大框——
 * 两个视图对同一份数据给出互相矛盾的画法。
 */
export function baseGroups(data, nodes) {
  const declared = Array.isArray(data.groups) ? data.groups : [];
  // 声明了分组、却没有任何节点认领它 —— 这时并不存在分组，MUST 并成一堆。
  if (declared.length === 0 || !nodes.some((node) => node.group)) {
    return [{ id: '__all__', name: '全部', order: undefined, nodes }];
  }
  const groups = declared.map((group) => ({
    id: group.id,
    name: group.name,
    order: group.order,
    nodes: nodes.filter((node) => node.group === group.id),
  }));
  const ungrouped = nodes.filter((node) => !node.group);
  if (ungrouped.length > 0) {
    groups.push({ id: '__ungrouped__', name: '没标堆的', order: undefined, nodes: ungrouped });
  }
  return groups;
}
