import { readFile } from 'node:fs/promises';
import { TopologyError } from './parse.mjs';

/**
 * 两个 CLI（validate / render）共用的入口读取、出口文案与退出码映射。
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

/**
 * 读入描述文件。读不了（不存在、是目录、没权限）MUST 归到 E_READ，
 * 因为那是使用者的输入问题，不是程序自身出了 bug——退出码 1 只留给后者。
 */
export async function readInput(inputPath) {
  if (!inputPath) throw new TopologyError('没有给描述文件路径', 'E_FILE');
  try {
    return await readFile(inputPath, 'utf8');
  } catch (error) {
    throw new TopologyError(`读不了这个文件：${error.code || error.message}`, 'E_FILE');
  }
}

/** 抛出来的异常对应哪个退出码：3 = 语法错或读不了文件，1 = 程序自身异常。 */
export function exitCodeFor(error) {
  return error.code === 'E_SYNTAX' || error.code === 'E_FILE' ? 3 : 1;
}
