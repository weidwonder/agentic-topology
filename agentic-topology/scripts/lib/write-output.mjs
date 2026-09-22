import { dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, rename, writeFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** 把 ~ 展开、转成绝对路径，再尽量解析成 realpath（不存在就退回解析后的路径）。 */
async function realOf(input) {
  const expanded = input.startsWith('~/') || input === '~'
    ? resolve(homedir(), input.slice(1).replace(/^\//, ''))
    : resolve(input);
  try {
    return await realpath(expanded);
  } catch {
    // 还不存在的目标文件、或本机上不存在的被分析项目——退回字面解析结果继续比。
    return expanded;
  }
}

/** a 是不是落在目录 b 之内（b 自身不算）。用路径分隔符收边，免得 /foo 命中 /foobar。 */
function isInside(a, b) {
  return a.startsWith(b.endsWith(sep) ? b : b + sep);
}

/**
 * 原子写入唯一的拓扑 HTML 输出文件。
 *
 * 全仓只有这一处碰文件系统写操作（spec §7.2 Invariant 1，AC-036 断言）。
 * 三条断言 MUST 按顺序执行：
 *   ① 目标路径以 .topology.html 结尾；
 *   ② 目标路径 MUST NOT 落在被分析项目之内——这是 Invariant 2「全程只读目标项目」
 *      的强制机制。少了这条，出图本身就能往目标项目里写文件，只读承诺形同虚设；
 *   ③ 先写同目录临时文件再 rename 到位（never-lose-work）。
 *
 * 返回实际写盘的字节数与 sha256：`--json` 收据要报的是「磁盘上这份东西的指纹」，
 * 算这个指纹的活儿只此一处干——在别处（比如 render.mjs）对 html 字符串另算一遍，
 * 万一编码方式哪天在这漂移，两边就会悄悄对不上。
 */
export async function writeOutput(targetPath, html, sourceProject) {
  if (!targetPath.endsWith('.topology.html')) throw new Error('输出路径必须以 .topology.html 结尾');
  if (sourceProject) {
    const project = await realOf(String(sourceProject));
    const target = await realOf(targetPath);
    if (target === project || isInside(target, project)) {
      throw new Error(
        `不能把图写进被分析的项目里：${targetPath}\n`
        + `全程只读目标项目（${sourceProject}），请把 -o 指到项目之外。`,
      );
    }
  }
  const buffer = Buffer.from(html, 'utf8');
  await mkdir(dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.tmp-${process.pid}`;
  await writeFile(temporary, buffer);
  await rename(temporary, targetPath);
  return { bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
}
