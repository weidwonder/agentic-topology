import { readFile } from 'node:fs/promises';
import { TopologyError } from './parse.mjs';

/**
 * 两个 CLI（validate / render）共用的入口读取、出口文案与退出码映射。
 * 放在一处是因为两边 MUST 说同一句话、给同一个码——分开写过一次就漂移过一次。
 */

/** JSON 收据的信封版本号。收据形状以后要是变了，下游靠这个字段判断，而不是猜字段有没有变。 */
export const SCHEMA_VERSION = 1;

/** 校验结果的人读文案。 */
export function textOutput(result) {
  if (result.ok) return `✅ 描述合格：${result.stats.nodes} 个节点、${result.stats.edges} 条边\n`;
  const lines = ['❌ 描述不合格，没有出图。下面的问题得先改好：', ''];
  for (const error of result.errors) {
    lines.push(`[${error.code}] ${error.path}`, `    ${error.message}`);
    // supportedFixes 来自 diagnostics.mjs 的对照表——照着改，不用回头去猜校验器想要什么。
    if (error.supportedFixes?.length) {
      lines.push(`    可用的修复手段：${error.supportedFixes.join('；')}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * 读入描述文件的原始字节。读不了（不存在、是目录、没权限）MUST 归到 E_FILE，
 * 因为那是使用者的输入问题，不是程序自身出了 bug——退出码 1 只留给后者。
 *
 * 按 Buffer 读，不按字符串读：调用方要么直接要字节（算 sha256、数字节数），
 * 要么自己 `.toString('utf8')` 解码成文本——同一份内存数据派生两种视图，
 * 不会因为「先转成字符串」在字节层面失真，也不必为了两种需要各读一次磁盘。
 */
export async function readInputBytes(inputPath) {
  if (!inputPath) throw new TopologyError('没有给描述文件路径', 'E_FILE');
  try {
    return await readFile(inputPath);
  } catch (error) {
    throw new TopologyError(`读不了这个文件：${error.code || error.message}`, 'E_FILE');
  }
}

/** 读入描述文件并解码成 UTF-8 文本——validate.mjs 只要文本，不必关心字节层面的东西。 */
export async function readInput(inputPath) {
  const bytes = await readInputBytes(inputPath);
  return bytes.toString('utf8');
}

/** 抛出来的异常对应哪个退出码：3 = 语法错或读不了文件，1 = 程序自身异常。 */
export function exitCodeFor(error) {
  return error.code === 'E_SYNTAX' || error.code === 'E_FILE' ? 3 : 1;
}
