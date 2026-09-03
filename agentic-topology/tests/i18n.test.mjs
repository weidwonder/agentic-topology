import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { FX, TMP, renderOk } from './helpers.mjs';

const render = (fixture, out, ...extra) =>
  spawnSync('node', ['scripts/render.mjs', fixture, '-o', TMP(out), '--force', ...extra],
    { encoding: 'utf8' });

const bodyOf = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '');

const SAMPLE_EN = 'assets/templates/example-en.topology.yaml';

test('缺省是中文：不带 --lang 跑，跟明确写 --lang zh 逐字节一样', () => {
  render(FX('base.topology.yaml'), 'lang-default.html');
  render(FX('base.topology.yaml'), 'lang-zh.html', '--lang', 'zh');
  assert.equal(readFileSync(TMP('lang-default.html'), 'utf8'),
    readFileSync(TMP('lang-zh.html'), 'utf8'));
});

test('--lang 取值非法时报错并列出合法值域，MUST NOT 静默回落成中文', () => {
  const r = render(FX('base.topology.yaml'), 'lang-bad.html', '--lang', 'de');
  assert.notEqual(r.status, 0, '非法取值该报错');
  const out = r.stdout + r.stderr;
  assert.match(out, /zh/, '没列出合法值域');
  assert.match(out, /en/, '没列出合法值域');
  assert.match(out, /de/, '没说收到的是什么');
});

test('选英文时框架文案全是英文，正文里一个中文框架词都不剩', () => {
  const r = render(SAMPLE_EN, 'lang-en.html', '--lang', 'en');
  assert.equal(r.status, 0, r.stderr);
  const body = bodyOf(readFileSync(TMP('lang-en.html'), 'utf8'));
  const cjk = body.match(/[一-鿿]+/g) || [];
  assert.deepEqual(cjk, [], `英文界面里还有中文：${cjk.slice(0, 8).join(' / ')}`);
});

test('英文界面同样不许用术语——中文那份禁用词清单的英文投影', () => {
  const body = bodyOf(readFileSync(TMP('lang-en.html'), 'utf8')).replace(/<[^>]+>/g, ' ');
  for (const word of ['node', 'edge', 'payload', 'carrier', 'entity', 'field',
    'struct', 'concurrency', 'confidence']) {
    assert.equal(new RegExp(`\\b${word}s?\\b`, 'i').test(body), false,
      `英文界面里出现了术语「${word}」——大白话判据对两种语言一视同仁`);
  }
});

test('中文界面照旧不许用术语，现行清单全量保留、只追加', () => {
  const body = bodyOf(renderOk(FX('base.topology.yaml'), 'lang-zh2.html')).replace(/<[^>]+>/g, ' ');
  // 前七个是现行清单，MUST NOT 因为这次改动被削掉；后两个是随信息块追加的
  for (const word of ['节点', '边', '传递物', '并发数', '可信度', '载体', '结构体', '实体', '字段'])
    assert.equal(body.includes(word), false, `中文界面里出现了术语「${word}」`);
});

test('英文出图 MUST NOT 翻译描述文件里的正文', () => {
  const zh = bodyOf(renderOk(FX('base.topology.yaml'), 'lang-zh3.html'));
  render(FX('base.topology.yaml'), 'lang-en2.html', '--lang', 'en');
  const en = bodyOf(readFileSync(TMP('lang-en2.html'), 'utf8'));
  // 方块名、职责、信息名与它的一句话说明，四处在英文页面上原样出现
  for (const prose of ['整理材料清单', '列出全部材料，给每份算个指纹，用来判断有没有变过',
    '材料清册', '用来判断材料与要求有没有变过的四个比对值']) {
    assert.ok(zh.includes(prose), `中文页面里没有「${prose}」，这条断言的前提不成立`);
    assert.ok(en.includes(prose), `英文页面把描述正文翻掉了：「${prose}」`);
  }
});

test('两套文案的 key 完全一致，不许一边有一边没有', async () => {
  const { LANGS } = await import('../scripts/lib/render-html.mjs');
  const keysOf = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) =>
    (value && typeof value === 'object' && !Array.isArray(value))
      ? keysOf(value, `${prefix}${key}.`) : [`${prefix}${key}`]);
  assert.deepEqual(keysOf(LANGS.zh).sort(), keysOf(LANGS.en).sort());
});

test('核对清单的句子也跟着语言走', async () => {
  const { enrich } = await import('../scripts/lib/enrich.mjs');
  const { load } = await import('./helpers.mjs');
  const { data } = load(FX('info-checklist.topology.yaml'));
  const zh = await enrich(data, { baseDir: 'tests/fixtures', lang: 'zh' });
  const en = await enrich(data, { baseDir: 'tests/fixtures', lang: 'en' });
  assert.ok(zh.checklist.some((item) => item.text.includes('需要你核实')));
  assert.ok(en.checklist.some((item) => item.text.includes('needs checking')));
  // 引号里是描述文件里的信息名，MUST NOT 翻译；剥掉之后剩下的才是框架文案
  const framework = (text) => text.replace(/「[^」]*」|"[^"]*"/g, '');
  assert.equal(en.checklist.some((item) => /[一-鿿]/.test(framework(item.text))),
    false, '英文清单里还有中文框架文案');
  assert.ok(en.checklist.some((item) => item.text.includes('材料清册')),
    '英文清单把描述里的信息名也翻掉了');
  assert.equal(zh.checklist.length, en.checklist.length, '两种语言的条目数 MUST 一样');
});

test('随本仓交付的英文样例描述能过校验、能出图', () => {
  const r = spawnSync('node', ['scripts/validate.mjs', SAMPLE_EN], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('界面用语表四列齐、四条硬规矩、两份禁用词清单', () => {
  const doc = readFileSync('references/界面用语表.md', 'utf8');
  assert.match(doc, /界面上必须说成（中文）\s*\|\s*界面上必须说成（英文）/, '对照表没有英文列');
  assert.match(doc, /MUST NOT 在这四套之外再造第五个说法/, '「三套」的硬规矩没改写成四套');
  assert.match(doc, /## 四条硬规矩/);
  assert.match(doc, /MUST NOT 翻译描述文件里的正文/);
  for (const word of ['「实体」', '「字段」']) assert.ok(doc.includes(word), `中文禁用词清单没追加 ${word}`);
  for (const word of ['`payload`', '`carrier`', '`entity`']) assert.ok(doc.includes(word), `英文禁用词清单缺 ${word}`);
  // 表格每一行都 MUST 有四列，且英文那列 MUST NOT 留空
  for (const line of doc.split('\n')) {
    if (!line.startsWith('| ') || line.includes('---')) continue;
    const cells = line.split('|').slice(1, -1);
    assert.equal(cells.length, 4, `这一行不是四列：${line}`);
    assert.ok(cells[3].trim().length > 0, `英文列空着：${line}`);
  }
});
