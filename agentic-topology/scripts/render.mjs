import path from 'node:path';
import { parseTopology, TopologyError } from './lib/parse.mjs';
import { validate } from './lib/validate.mjs';
import { layout } from './lib/layout.mjs';
import { enrich } from './lib/enrich.mjs';
import { renderHtml, LANGS } from './lib/render-html.mjs';
import { writeOutput } from './lib/write-output.mjs';
import { resolveTarget } from './lib/nonclobber.mjs';
import { isStale } from './lib/staleness.mjs';
import { errorText } from './lib/error-text.mjs';
import { readInput, textOutput, exitCodeFor } from './lib/cli-output.mjs';


const input = process.argv[2];
const outputFlag = process.argv.indexOf('-o');
const force = process.argv.includes('--force');
const langFlag = process.argv.indexOf('--lang');
// 缺省是中文：现有使用者不带这个参数跑，出来的图 MUST 跟以前逐字一样。
const lang = langFlag >= 0 ? process.argv[langFlag + 1] : 'zh';
try {
  // 取值非法就报错并列出合法值域，MUST NOT 静默回落成中文——
  // 那会让人以为 --lang en 生效了，实际拿到一张中文图。
  if (!Object.keys(LANGS).includes(lang)) {
    throw new TopologyError(`--lang 只接受 ${Object.keys(LANGS).join(' / ')}，收到的是 ${lang}`, 'E_FILE');
  }
  // 输出路径要由输入路径推导，所以这一步 MUST 在 try 里面：没给路径时它会炸，
  // 而那是使用者的输入错误，该走和 validate.mjs 一样的 E_FILE + 退出码 3，
  // MUST NOT 甩一个 Node 原生 TypeError 栈出去（那会被当成程序自身的 bug）。
  if (!input) throw new TopologyError('没有给描述文件路径', 'E_FILE');
  const output = outputFlag >= 0
    ? process.argv[outputFlag + 1]
    : input.replace(/\.topology\.(yaml|json)$/, '.topology.html');
  const parsed = parseTopology(await readInput(input), input);
  const result = validate(parsed.data, parsed.lines);
  if (!result.ok) {
    process.stdout.write(textOutput(result));
    process.exitCode = 2;
  } else {
    const enriched = await enrich(parsed.data, { baseDir: path.dirname(input), lang });
    enriched.staleness = await isStale(parsed.data, { baseDir: path.dirname(input) });
    const pageLayout = layout(parsed.data, { lang });
    // 三个来源的告警都 MUST 出来：布局退让失败、提示词读不到、折叠视图标注被盖住。
    // 折叠那一份只有渲染时才算得出来，所以收进 sink 再一起打。
    const renderWarnings = [];
    const html = renderHtml({
      data: parsed.data, layout: pageLayout, enriched, warnings: renderWarnings, lang,
    });
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
