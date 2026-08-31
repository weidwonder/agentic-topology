import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function sourceRefs(data) {
  const refs = [];
  const add = (item) => {
    for (const ref of item?.source?.refs || []) {
      const file = String(ref).split(':')[0];
      if (file && !refs.includes(file)) refs.push(file);
    }
  };
  add(data.graph);
  for (const exit of data.graph?.exits || []) add(exit);
  for (const node of data.nodes || []) add(node);
  for (const edge of data.edges || []) add(edge);
  return refs;
}

function resolveSourceProject(sourceProject, baseDir) {
  const value = String(sourceProject || '');
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return path.resolve(baseDir, value);
}

/** 判断描述是否早于其来源引用文件的最新修改时间。 */
export async function isStale(data, { baseDir = '.' } = {}) {
  const sourceRoot = resolveSourceProject(data.source_project, baseDir);
  try {
    const rootStat = await stat(sourceRoot);
    if (!rootStat.isDirectory()) throw new Error('来源项目不是目录');
  } catch {
    return { stale: false, reason: '读不到来源项目，无法判断', newestMtime: null };
  }
  const generatedAt = Date.parse(`${data.generated_at}T00:00:00Z`);
  let newest = 0;
  let newestFile = null;
  for (const ref of sourceRefs(data)) {
    try {
      const fileStat = await stat(path.join(sourceRoot, ref));
      if (fileStat.mtimeMs > newest) {
        newest = fileStat.mtimeMs;
        newestFile = ref;
      }
    } catch {
      continue;
    }
  }
  if (!newestFile || !Number.isFinite(generatedAt) || newest <= generatedAt) {
    return { stale: false, reason: null, newestMtime: newest ? new Date(newest).toISOString() : null };
  }
  return {
    stale: true,
    reason: `源码 ${newestFile} 的修改时间晚于描述生成时间`,
    newestMtime: new Date(newest).toISOString(),
  };
}
