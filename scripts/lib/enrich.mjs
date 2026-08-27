/** 读取并补充渲染所需的最小富化结果。 */
export async function enrich() {
  return { checklist: [], prompts: new Map(), stats: {}, warnings: [] };
}
