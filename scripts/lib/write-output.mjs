import { dirname } from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';

/** 原子写入唯一的拓扑 HTML 输出文件。 */
export async function writeOutput(targetPath, html) {
  if (!targetPath.endsWith('.topology.html')) throw new Error('输出路径必须以 .topology.html 结尾');
  await mkdir(dirname(targetPath), { recursive: true });
  const temporary = `${targetPath}.tmp-${process.pid}`;
  await writeFile(temporary, html, 'utf8');
  await rename(temporary, targetPath);
}
