/**
 * 把技能装进使用者的项目。
 *
 * 只复制**交付物**——SKILL.md、references/、assets/、scripts/。
 * MUST NOT 复制 tests/、docs/、node_modules/：那些是开发这个技能时用的，
 * 装到别人项目里只会占地方，还会让 agent 在检索时读到无关内容。
 */
import { readdir, mkdir, copyFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';

/** 各家编码 agent 放技能的地方。加新的 agent 只改这张表。 */
export const INSTALL_TARGETS = {
  claude: '.claude/skills/agentic-topology',
  codex: '.agents/skills/agentic-topology',
};

/** 交付物清单——与 package.json 的 files 字段同源，改一处 MUST 同时改另一处。 */
const PAYLOAD = ['SKILL.md', 'references', 'assets', 'scripts'];

async function copyTree(from, to) {
  const info = await stat(from);
  if (!info.isDirectory()) {
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
    return 1;
  }
  await mkdir(to, { recursive: true });
  let count = 0;
  for (const name of (await readdir(from)).sort()) {
    count += await copyTree(path.join(from, name), path.join(to, name));
  }
  return count;
}

export async function install({ root, agent = 'claude', dir, cwd = process.cwd() }) {
  const relative = dir || INSTALL_TARGETS[agent];
  if (!relative) throw new Error(`不认识的 agent：${agent}`);
  const target = path.resolve(cwd, relative);
  if (path.resolve(root) === target) throw new Error('装到自己身上了，换个目录');

  // 装之前先清干净——留着上一版的文件，agent 会同时读到两份互相矛盾的规则。
  await rm(target, { recursive: true, force: true });
  let files = 0;
  for (const name of PAYLOAD) {
    files += await copyTree(path.join(root, name), path.join(target, name));
  }
  return { target: path.relative(cwd, target) || target, files };
}
