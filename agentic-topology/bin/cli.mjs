#!/usr/bin/env node
/**
 * agentic-topology 的统一入口。
 *
 * 三个子命令：
 *   install   把技能装进当前项目，装完就可以直接对 Claude 说"画一下这个项目的编排"
 *   render    把一份编排描述渲染成单文件网页
 *   validate  只校验描述、不出图
 *
 * 注意 install 会写文件，而 render / validate 这条链上**只有**
 * scripts/lib/write-output.mjs 允许写盘（spec §7.2 Invariant 1，AC-036 断言）。
 * 两者互不调用：install 在本文件里就地完成，MUST NOT 被 render / validate 引用。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { install, INSTALL_TARGETS } from './install.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [command, ...rest] = process.argv.slice(2);

const USAGE = `agentic-topology —— 把一个 agentic 应用的编排画成一张能点开下钻的图

  npx agentic-topology install [--agent claude|codex] [--dir <目录>]
      把技能装进当前项目。装完直接对你的编码 agent 说
      「画一下这个项目的编排」就行，不需要你再敲任何命令。

  npx agentic-topology render <描述文件> [-o <输出.html>] [--force]
      把一份编排描述渲染成可离线打开的单文件网页。
      <描述文件> 通常是上一步里 agent 自己读源码写出来的，不用你手写。

  npx agentic-topology validate <描述文件> [--format json]
      只校验、不出图。

退出码：0 通过 · 2 校验不通过 · 3 语法错或文件读不了 · 1 程序自身异常
`;

function runScript(name, args) {
  const child = spawn(process.execPath, [path.join(ROOT, 'scripts', name), ...args],
    { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

if (command === 'render') runScript('render.mjs', rest);
else if (command === 'validate') runScript('validate.mjs', rest);
else if (command === 'install') {
  const flag = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const agent = flag('agent') || 'claude';
  if (!INSTALL_TARGETS[agent]) {
    process.stderr.write(`不认识的 --agent：${agent}\n可选：${Object.keys(INSTALL_TARGETS).join(' / ')}\n`);
    process.exit(1);
  }
  try {
    const result = await install({ root: ROOT, agent, dir: flag('dir'), cwd: process.cwd() });
    process.stdout.write(`已装到 ${result.target}\n`);
    process.stdout.write(`复制了 ${result.files} 个文件\n\n`);
    process.stdout.write('接下来：直接对你的编码 agent 说「画一下这个项目的编排」。\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
} else if (command === '--version' || command === '-v') {
  const { version } = JSON.parse(
    await (await import('node:fs/promises')).readFile(path.join(ROOT, 'package.json'), 'utf8'));
  process.stdout.write(`${version}\n`);
} else {
  process.stdout.write(USAGE);
  process.exit(command === undefined || command === '--help' || command === '-h' ? 0 : 1);
}
