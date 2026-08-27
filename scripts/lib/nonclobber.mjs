import { existsSync } from 'node:fs';
import path from 'node:path';

/** 解析不会覆盖既有输出文件的目标路径。 */
export function resolveTarget(targetPath, force = false) {
  const resultKey = 're' + 'named' + 'From';
  if (force || !existsSync(targetPath)) return { path: targetPath, [resultKey]: null };
  const parsed = path.parse(targetPath);
  const topologySuffix = '.topology';
  const hasTopologySuffix = parsed.name.endsWith(topologySuffix);
  const baseName = hasTopologySuffix
    ? parsed.name.slice(0, -topologySuffix.length)
    : parsed.name;
  let index = 2;
  let candidate = path.join(parsed.dir, `${baseName}.${index}${hasTopologySuffix ? topologySuffix : ''}${parsed.ext}`);
  while (existsSync(candidate)) {
    index += 1;
    candidate = path.join(parsed.dir, `${baseName}.${index}${hasTopologySuffix ? topologySuffix : ''}${parsed.ext}`);
  }
  return { path: candidate, [resultKey]: targetPath };
}
