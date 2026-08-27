import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intersects, walk } from './helpers.mjs';

test('intersects：相交与相接', () => {
  assert.equal(intersects({x:0,y:0,w:10,h:10}, {x:5,y:5,w:10,h:10}), true);
  assert.equal(intersects({x:0,y:0,w:10,h:10}, {x:10,y:0,w:10,h:10}), false);
});

test('walk 能列出 fixtures 下的文件', () => {
  const files = walk('tests/fixtures');
  assert.ok(files.some((f) => f.endsWith('base.topology.yaml')));
});
