import { readFile } from 'node:fs/promises';
import { parseTopology } from './lib/parse.mjs';
import { validate } from './lib/validate.mjs';

function textOutput(result) {
  if (result.ok) return `✅ 描述合格：${result.stats.nodes} 个节点、${result.stats.edges} 条边\n`;
  const lines = ['❌ 描述不合格，没有出图。下面的问题得先改好：', ''];
  for (const error of result.errors) {
    lines.push(`[${error.code}] ${error.path}`, `    ${error.message}`, '');
  }
  return `${lines.join('\n')}\n`;
}

const input = process.argv[2];
try {
  const parsed = parseTopology(await readFile(input, 'utf8'), input);
  const result = validate(parsed.data, parsed.lines);
  if (process.argv.includes('--format') && process.argv[process.argv.indexOf('--format') + 1] === 'json') {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(textOutput(result));
  }
  process.exitCode = result.ok ? 0 : 2;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.code === 'E_SYNTAX' ? 3 : 1;
}
