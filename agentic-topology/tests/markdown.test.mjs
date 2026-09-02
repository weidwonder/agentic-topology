import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../scripts/lib/markdown.mjs';

test('标题：# ~ ###### 各级都能转成对应的 h 标签', () => {
  assert.equal(renderMarkdown('# 一级'), '<h1>一级</h1>');
  assert.equal(renderMarkdown('###### 六级'), '<h6>六级</h6>');
});

test('行内语法：粗体、斜体、行内代码', () => {
  assert.equal(renderMarkdown('**粗体**'), '<p><strong>粗体</strong></p>');
  assert.equal(renderMarkdown('*斜体*'), '<p><em>斜体</em></p>');
  assert.equal(renderMarkdown('`code`'), '<p><code>code</code></p>');
});

test('行内代码里的 * 不会被当成粗体/斜体语法再解释一遍', () => {
  assert.equal(renderMarkdown('`a*b*c`'), '<p><code>a*b*c</code></p>');
});

test('无序列表：- 和 * 两种写法都支持', () => {
  assert.equal(renderMarkdown('- 一\n- 二'), '<ul><li>一</li><li>二</li></ul>');
  assert.equal(renderMarkdown('* 一\n* 二'), '<ul><li>一</li><li>二</li></ul>');
});

test('有序列表：1. 2. 3.', () => {
  assert.equal(renderMarkdown('1. 一\n2. 二'), '<ol><li>一</li><li>二</li></ol>');
});

test('段落：空行分段，段内单换行渲染成 br', () => {
  const html = renderMarkdown('第一段第一行\n第一段第二行\n\n第二段');
  assert.equal(html, '<p>第一段第一行<br>第一段第二行</p>\n<p>第二段</p>');
});

test('围栏代码块：带语言标注生成 language-xxx class，内容原样保留不做行内替换', () => {
  const html = renderMarkdown('```js\nconst a = 1;\n**not bold**\n```');
  assert.equal(html, '<pre><code class="language-js">const a = 1;\n**not bold**</code></pre>');
});

test('围栏代码块：不写语言时不带 class', () => {
  assert.equal(renderMarkdown('```\nplain\n```'), '<pre><code>plain</code></pre>');
});

test('链接：http/https/mailto 生成 a 标签', () => {
  assert.equal(
    renderMarkdown('[官网](https://example.com)'),
    '<p><a href="https://example.com">官网</a></p>',
  );
  assert.equal(
    renderMarkdown('[写信](mailto:a@b.com)'),
    '<p><a href="mailto:a@b.com">写信</a></p>',
  );
});

test('XSS：script 标签整体被转义成纯文本，不产生可执行标签', () => {
  const html = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'), '不能出现真的 <script> 标签');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('XSS：img onerror 被转义，不产生可执行的 img 标签/属性', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'), '不能出现真的 <img 标签');
  assert.ok(html.includes('&lt;img'));
});

test('XSS：非 http/https/mailto 协议的链接（javascript:）不生成 a 标签', () => {
  const html = renderMarkdown('[x](javascript:alert(1))');
  assert.ok(!html.includes('<a '), '危险协议不能生成 <a> 标签');
  assert.ok(html.includes('javascript:alert(1)'), '原样当纯文本展示');
});

test('XSS：data: 协议链接同样不生成 a 标签', () => {
  const html = renderMarkdown('[x](data:text/html,<script>alert(1)</script>)');
  assert.ok(!html.includes('<a '));
  assert.ok(!html.includes('<script>'));
});

test('空输入 / 非字符串输入返回空串，不抛异常', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(undefined), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(123), '');
  assert.equal(renderMarkdown({}), '');
});
