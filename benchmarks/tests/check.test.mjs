import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { run, FIXTURES } from './helpers.mjs';

test('check：真实的 manifest 与三份 case 自洽', () => {
  const { status, stdout } = run(['check']);
  assert.equal(status, 0, stdout);
  assert.match(stdout, /check 通过/);
});

test('check：故意写坏的 case（边引用了没声明过的节点）被拦下，退出码 2', () => {
  const manifest = path.join(FIXTURES, 'broken-suite', 'manifest.json');
  const { status, stderr } = run(['check', '--manifest', manifest]);
  assert.equal(status, 2);
  assert.match(stderr, /不在 required_agent_nodes 或 endpoint_aliases 里/);
});

test('check：manifest 指向不存在的文件时退出码 2', () => {
  const { status, stderr } = run(['check', '--manifest', path.join(FIXTURES, 'does-not-exist.json')]);
  assert.equal(status, 2);
  assert.match(stderr, /不存在/);
});
