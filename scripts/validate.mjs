import { readFile } from 'node:fs/promises';
import { parseTopology } from './lib/parse.mjs';
import { validate } from './lib/validate.mjs';

const input = process.argv[2];
try {
  const parsed = parseTopology(await readFile(input, 'utf8'), input);
  const result = validate(parsed.data, parsed.lines);
  if (process.argv.includes('--format') && process.argv[process.argv.indexOf('--format') + 1] === 'json') {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    const output = result.ok
      ? `✅ 描述合格：${result.stats.nodes} 个节点、${result.stats.edges} 条边\n`
      : `${result.errors.join('\n')}\n`;
    process.stdout.write(output);
  }
  process.exitCode = result.ok ? 0 : 2;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.code === 'E_SYNTAX' ? 3 : 1;
}
