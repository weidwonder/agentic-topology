import { readFile } from 'node:fs/promises';
import { parseTopology } from './lib/parse.mjs';
import { validate } from './lib/validate.mjs';
import { errorText } from './lib/error-text.mjs';
import { textOutput, exitCodeFor } from './lib/cli-output.mjs';


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
  process.stderr.write(errorText(error, input));
  process.exitCode = exitCodeFor(error);
}
