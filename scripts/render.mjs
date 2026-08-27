import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTopology } from './lib/parse.mjs';
import { validate } from './lib/validate.mjs';
import { layout } from './lib/layout.mjs';
import { enrich } from './lib/enrich.mjs';
import { renderHtml } from './lib/render-html.mjs';
import { writeOutput } from './lib/write-output.mjs';

function textOutput(result) {
  if (result.ok) return `✅ 描述合格：${result.stats.nodes} 个节点、${result.stats.edges} 条边\n`;
  const lines = ['❌ 描述不合格，没有出图。下面的问题得先改好：', ''];
  for (const error of result.errors) lines.push(`[${error.code}] ${error.path}`, `    ${error.message}`, '');
  return `${lines.join('\n')}\n`;
}

const input = process.argv[2];
const outputFlag = process.argv.indexOf('-o');
const output = outputFlag >= 0
  ? process.argv[outputFlag + 1]
  : input.replace(/\.topology\.(yaml|json)$/, '.topology.html');
try {
  const parsed = parseTopology(await readFile(input, 'utf8'), input);
  const result = validate(parsed.data, parsed.lines);
  if (!result.ok) {
    process.stdout.write(textOutput(result));
    process.exitCode = 2;
  } else {
    const enriched = await enrich(parsed.data, { baseDir: path.dirname(input) });
    const pageLayout = layout(parsed.data);
    for (const warning of pageLayout.warnings) process.stderr.write(`${warning}\n`);
    const html = renderHtml({
      data: parsed.data,
      layout: pageLayout,
      folded: null,
      enriched,
    });
    await writeOutput(output, html, parsed.data.source_project);
    process.stdout.write(`${output}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.code === 'E_SYNTAX' ? 3 : 1;
}
