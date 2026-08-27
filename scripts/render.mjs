import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTopology } from './lib/parse.mjs';
import { validate } from './lib/validate.mjs';
import { layout } from './lib/layout.mjs';
import { enrich } from './lib/enrich.mjs';
import { renderHtml } from './lib/render-html.mjs';
import { writeOutput } from './lib/write-output.mjs';

const input = process.argv[2];
const outputFlag = process.argv.indexOf('-o');
const output = outputFlag >= 0
  ? process.argv[outputFlag + 1]
  : input.replace(/\.topology\.(yaml|json)$/, '.topology.html');
try {
  const parsed = parseTopology(await readFile(input, 'utf8'), input);
  const result = validate(parsed.data, parsed.lines);
  if (!result.ok) {
    process.stdout.write(`${JSON.stringify(result.errors)}\n`);
    process.exitCode = 2;
  } else {
    const enriched = await enrich(parsed.data, { baseDir: path.dirname(input) });
    const html = renderHtml({
      data: parsed.data,
      layout: layout(parsed.data),
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
