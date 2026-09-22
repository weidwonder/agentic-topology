// 测试共用的小工具：跑一次 benchmark.mjs 子命令，拿到 { stdout, stderr, status }。
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BENCHMARK = path.join(HERE, '..', 'benchmark.mjs');
export const FIXTURES = path.join(HERE, 'fixtures');

export function fx(name) {
  return path.join(FIXTURES, name);
}

export function run(args) {
  const result = spawnSync(process.execPath, [BENCHMARK, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function parseReceipt(stdout) {
  const line = stdout.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}
