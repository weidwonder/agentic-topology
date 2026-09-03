// 分流：只看指纹决定走哪条路，docket 原样往下传，一个字段都没动。
import type { Docket } from './intake';

export function route(docket: Docket) {
  if (isKnown(docket.fingerprint)) {
    // 命中缓存：直接把上一轮的结论取出来，docket 不再往下走
    return { reuse: loadCached(docket.fingerprint) };
  }
  // 未命中：docket 原样交给 worker——这里只是转手
  return { fresh: runWorker(docket) };
}
