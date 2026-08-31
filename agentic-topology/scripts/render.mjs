import path from 'node:path';
import { parseTopology } from './lib/parse.mjs';
import { validate } from './lib/validate.mjs';
import { layout } from './lib/layout.mjs';
import { enrich } from './lib/enrich.mjs';
import { renderHtml } from './lib/render-html.mjs';
import { writeOutput } from './lib/write-output.mjs';
import { resolveTarget } from './lib/nonclobber.mjs';
import { isStale } from './lib/staleness.mjs';
import { errorText } from './lib/error-text.mjs';
import { readInput, textOutput, exitCodeFor } from './lib/cli-output.mjs';


const input = process.argv[2];
const outputFlag = process.argv.indexOf('-o');
const output = outputFlag >= 0
  ? process.argv[outputFlag + 1]
  : input.replace(/\.topology\.(yaml|json)$/, '.topology.html');
const force = process.argv.includes('--force');
try {
  const parsed = parseTopology(await readInput(input), input);
  const result = validate(parsed.data, parsed.lines);
  if (!result.ok) {
    process.stdout.write(textOutput(result));
    process.exitCode = 2;
  } else {
    const enriched = await enrich(parsed.data, { baseDir: path.dirname(input) });
    enriched.staleness = await isStale(parsed.data, { baseDir: path.dirname(input) });
    const pageLayout = layout(parsed.data);
    // 三个来源的告警都 MUST 出来：布局退让失败、提示词读不到、折叠视图标注被盖住。
    // 折叠那一份只有渲染时才算得出来，所以收进 sink 再一起打。
    const renderWarnings = [];
    const html = renderHtml({ data: parsed.data, layout: pageLayout, enriched, warnings: renderWarnings });
    for (const warning of [...pageLayout.warnings, ...(enriched.warnings || []), ...renderWarnings]) {
      process.stderr.write(`${warning}\n`);
    }
    const target = resolveTarget(output, force);
    await writeOutput(target.path, html, parsed.data.source_project);
    if (target.renamedFrom) process.stderr.write(`已有一份，已另存为 ${target.path}\n`);
    // spec §8：成功时 MUST 打印路径与三个数，让人不用打开文件就知道这张图有多大。
    const checks = (enriched.checklist || []).length;
    process.stdout.write(`输出：${target.path}\n`);
    process.stdout.write(
      `${result.stats.nodes} 个方块 · ${result.stats.edges} 条连线 · ${checks} 处要你核实\n`);
  }
} catch (error) {
  process.stderr.write(errorText(error, input));
  process.exitCode = exitCodeFor(error);
}
