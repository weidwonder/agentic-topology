import { readFile } from 'node:fs/promises';
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
import { textOutput, exitCodeFor } from './lib/cli-output.mjs';


const input = process.argv[2];
const outputFlag = process.argv.indexOf('-o');
const output = outputFlag >= 0
  ? process.argv[outputFlag + 1]
  : input.replace(/\.topology\.(yaml|json)$/, '.topology.html');
const force = process.argv.includes('--force');
try {
  const parsed = parseTopology(await readFile(input, 'utf8'), input);
  const result = validate(parsed.data, parsed.lines);
  if (!result.ok) {
    process.stdout.write(textOutput(result));
    process.exitCode = 2;
  } else {
    const enriched = await enrich(parsed.data, { baseDir: path.dirname(input) });
    enriched.staleness = await isStale(parsed.data, { baseDir: path.dirname(input) });
    const pageLayout = layout(parsed.data);
    for (const warning of pageLayout.warnings) process.stderr.write(`${warning}\n`);
    const html = renderHtml({ data: parsed.data, layout: pageLayout, enriched });
    const target = resolveTarget(output, force);
    await writeOutput(target.path, html);
    if (target.renamedFrom) process.stderr.write(`已有一份，已另存为 ${target.path}\n`);
    process.stdout.write(`${target.path}\n`);
  }
} catch (error) {
  process.stderr.write(errorText(error, input));
  process.exitCode = exitCodeFor(error);
}
