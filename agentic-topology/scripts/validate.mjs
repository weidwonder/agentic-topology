import path from 'node:path';
import { parseTopology } from './lib/parse.mjs';
import { validate } from './lib/validate.mjs';
import { errorText } from './lib/error-text.mjs';
import { readInput, textOutput, exitCodeFor, SCHEMA_VERSION } from './lib/cli-output.mjs';


const input = process.argv[2];
try {
  const parsed = parseTopology(await readInput(input), input);
  const result = validate(parsed.data, parsed.lines, { baseDir: path.dirname(input) });
  if (process.argv.includes('--format') && process.argv[process.argv.indexOf('--format') + 1] === 'json') {
    // 顶层信封 schemaVersion：收据格式以后要是变了，下游靠这个字段判断，不用去猜字段有没有变。
    process.stdout.write(`${JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...result })}\n`);
  } else {
    process.stdout.write(textOutput(result));
  }
  process.exitCode = result.ok ? 0 : 2;
} catch (error) {
  process.stderr.write(errorText(error, input));
  process.exitCode = exitCodeFor(error);
}
