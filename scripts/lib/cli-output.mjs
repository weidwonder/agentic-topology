/**
 * 两个 CLI（validate / render）共用的出口文案与退出码映射。
 * 放在一处是因为两边 MUST 说同一句话、给同一个码——分开写过一次就漂移过一次。
 */

/** 校验结果的人读文案。 */
export function textOutput(result) {
  if (result.ok) return `✅ 描述合格：${result.stats.nodes} 个节点、${result.stats.edges} 条边\n`;
  const lines = ['❌ 描述不合格，没有出图。下面的问题得先改好：', ''];
  for (const error of result.errors) {
    lines.push(`[${error.code}] ${error.path}`, `    ${error.message}`, '');
  }
  return `${lines.join('\n')}\n`;
}

/** 抛出来的异常对应哪个退出码：3 = 语法错或读不了文件，1 = 程序自身异常。 */
export function exitCodeFor(error) {
  return error.code === 'E_SYNTAX' ? 3 : 1;
}
