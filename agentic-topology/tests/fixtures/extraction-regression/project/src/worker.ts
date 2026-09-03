// 干活：读 docket 里的文件，逐份出一个判定，最后打包成结果。
import type { Docket } from './intake';

export function runWorker(docket: Docket) {
  const verdicts = docket.files.map((file) => judge(file));
  return { verdicts, fingerprint: docket.fingerprint };
}

// 汇总：把 worker 的结果重新组织成给人看的那份报告——
// 这是**新造**的一份东西，不是 worker 结果的透传。
export function summarise(result: ReturnType<typeof runWorker>) {
  return {
    lines: result.verdicts.map(renderLine),
    total: result.verdicts.length,
  };
}
