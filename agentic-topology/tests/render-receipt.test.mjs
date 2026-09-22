/**
 * 原子交付与字节收据（评审任务②）：描述文件的字节冻结快照后再渲染，
 * `--json` 收据里两个 sha256 与字节数都对得上磁盘上的实际内容，
 * 失败时（校验不过 / 写不出去）不产出收据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FX, TMP } from './helpers.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const runJson = (fixturePath, outName) => {
  mkdirSync('tests/tmp', { recursive: true });
  const out = TMP(outName);
  rmSync(out, { force: true });
  const r = spawnSync('node', ['scripts/render.mjs', fixturePath, '-o', out, '--force', '--json'],
    { encoding: 'utf8' });
  return { r, out };
};

test('成功时 --json 输出的收据信封与两份 sha256/字节数都对得上磁盘实际内容', () => {
  const { r, out } = runJson(FX('base.topology.yaml'), 'receipt-ok.html');
  assert.equal(r.status, 0, `render 失败：\n${r.stdout}\n${r.stderr}`);
  const receipt = JSON.parse(r.stdout);
  assert.equal(receipt.schemaVersion, 1);

  const specBytes = readFileSync(FX('base.topology.yaml'));
  assert.equal(receipt.specification.path, FX('base.topology.yaml'));
  assert.equal(receipt.specification.bytes, specBytes.length);
  assert.equal(receipt.specification.sha256, sha256(specBytes));

  const artifactBytes = readFileSync(out);
  assert.equal(receipt.artifact.path, out);
  assert.equal(receipt.artifact.bytes, artifactBytes.length);
  assert.equal(receipt.artifact.sha256, sha256(artifactBytes));

  assert.equal(typeof receipt.stats.nodes, 'number');
  assert.equal(typeof receipt.stats.edges, 'number');
  assert.equal(typeof receipt.stats.checklist, 'number');
  assert.equal(receipt.stats.nodes, 4);
  assert.equal(receipt.stats.edges, 4);
});

test('两次对同一份描述跑 --json，sha256 逐字节相同（复现「同一份描述出一样的图」的收据版本）', () => {
  const a = runJson(FX('base.topology.yaml'), 'receipt-a.html');
  const b = runJson(FX('base.topology.yaml'), 'receipt-b.html');
  const ra = JSON.parse(a.r.stdout);
  const rb = JSON.parse(b.r.stdout);
  assert.equal(ra.specification.sha256, rb.specification.sha256);
  assert.equal(ra.artifact.sha256, rb.artifact.sha256);
});

test('校验不通过时不产出收据，stdout 仍是原来的人读报错，且不产出 HTML', () => {
  mkdirSync('tests/tmp', { recursive: true });
  const out = TMP('receipt-invalid.html');
  rmSync(out, { force: true });
  const r = spawnSync('node',
    ['scripts/render.mjs', FX('rules/R-04.topology.yaml'), '-o', out, '--json'],
    { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.equal(existsSync(out), false, '校验不通过却产出了 HTML');
  assert.throws(() => JSON.parse(r.stdout), '失败时 stdout 不该是一份 JSON 收据');
  assert.match(r.stdout, /不合格|没有出图/);
});

test('写不出去（目标落在被分析项目内）时不产出收据', () => {
  mkdirSync('tests/tmp/receipt-fakeproj/sub', { recursive: true });
  const project = 'tests/tmp/receipt-fakeproj';
  const doc = readFileSync(FX('base.topology.yaml'), 'utf8')
    .replace(/^source_project:.*$/m, `source_project: "${project}"`);
  const input = 'tests/tmp/receipt-inside.topology.yaml';
  writeFileSync(input, doc);
  rmSync(`${project}/sub/x.topology.html`, { force: true });
  const r = spawnSync('node',
    ['scripts/render.mjs', input, '-o', `${project}/sub/x.topology.html`, '--force', '--json'],
    { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(existsSync(`${project}/sub/x.topology.html`), false);
  assert.throws(() => JSON.parse(r.stdout), '失败时 stdout 不该是一份 JSON 收据');
});

test('不带 --json 时行为与之前完全一样：人读文案，不是 JSON', () => {
  const { r } = runJson(FX('base.topology.yaml'), 'receipt-noflag.html');
  assert.equal(r.status, 0);
  mkdirSync('tests/tmp', { recursive: true });
  const out = TMP('receipt-noflag2.html');
  rmSync(out, { force: true });
  const plain = spawnSync('node', ['scripts/render.mjs', FX('base.topology.yaml'), '-o', out, '--force'],
    { encoding: 'utf8' });
  assert.equal(plain.status, 0);
  assert.match(plain.stdout, /个方块/);
  assert.throws(() => JSON.parse(plain.stdout));
});

// ---- 冻结快照：读到的是真字节，不是解码之后的字符数 --------------------------
test('readInputBytes 给的是原始字节（Buffer），字节数按 UTF-8 算，不是 JS 字符串长度', async () => {
  const { readInputBytes } = await import('../scripts/lib/cli-output.mjs');
  mkdirSync('tests/tmp', { recursive: true });
  const input = 'tests/tmp/freeze-bytes.topology.yaml';
  // 中文字符在 UTF-8 里是多字节；字节数与「.length（UTF-16 code unit 数）」不相等，
  // 用这个落差证明收据里的 bytes 数得是真字节数，不是随手拿字符串长度充数。
  const text = readFileSync(FX('base.topology.yaml'), 'utf8');
  writeFileSync(input, text);
  const bytes = await readInputBytes(input);
  assert.ok(Buffer.isBuffer(bytes), 'readInputBytes 应当返回 Buffer');
  assert.equal(bytes.length, Buffer.byteLength(text, 'utf8'));
  assert.notEqual(bytes.length, text.length, '这份 fixture 含中文，字节数应当多于字符数');
});

test('读同一份文件两次得到相同字节，且与磁盘上此刻的内容一致（没有中途被别的读法污染）', async () => {
  const { readInputBytes } = await import('../scripts/lib/cli-output.mjs');
  const bytes = await readInputBytes(FX('base.topology.yaml'));
  const onDisk = readFileSync(FX('base.topology.yaml'));
  assert.equal(sha256(bytes), sha256(onDisk));
});
