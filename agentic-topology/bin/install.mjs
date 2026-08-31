/**
 * 把技能装进使用者的项目。
 *
 * 只复制**交付物**——SKILL.md、references/、assets/、scripts/。
 * MUST NOT 复制 tests/、docs/、node_modules/：那些是开发这个技能时用的，
 * 装到别人项目里只会占地方，还会让 agent 在检索时读到无关内容。
 */
import { readdir, mkdir, copyFile, stat, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

/** a 是不是等于 b、或者是 b 的祖先目录。 */
function isSameOrAncestor(a, b) {
  const rel = path.relative(a, b);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 这个目录看起来是不是本技能装出来的？
 * 只认一个凭据：里面有一份 name 是 agentic-topology 的 SKILL.md。
 * 认不出来就不删——宁可让人手动清一次，也不能把别人的东西悄悄抹掉。
 */
async function looksLikeOurInstall(target) {
  try {
    const text = await readFile(path.join(target, 'SKILL.md'), 'utf8');
    return /^name:\s*agentic-topology\s*$/m.test(text);
  } catch {
    return false;
  }
}

async function isEmptyDir(target) {
  try {
    return (await readdir(target)).length === 0;
  } catch {
    return false;
  }
}

export async function install({ root, agent = 'claude', dir, cwd = process.cwd() }) {
  const relative = dir || INSTALL_TARGETS[agent];
  if (!relative) throw new Error(`不认识的 agent：${agent}`);
  const target = path.resolve(cwd, relative);
  const resolvedRoot = path.resolve(root);

  // ── 装之前的四道闸。这一步之后会 rm -rf target，删错了没法回滚，所以宁严勿松。──
  if (resolvedRoot === target) throw new Error('装到自己身上了，换个目录');
  if (isSameOrAncestor(target, cwd)) {
    throw new Error(
      `不能装到「${relative}」——它就是你当前所在的目录、或者是它的上层。\n`
      + '安装会先清空目标目录，装到这里等于把你的工作目录删掉。\n'
      + `请指定一个子目录，比如 --dir ${INSTALL_TARGETS[agent] || '.claude/skills/agentic-topology'}`,
    );
  }
  if (isSameOrAncestor(target, resolvedRoot)) {
    throw new Error(`不能装到「${relative}」——它是本技能源码所在目录的上层，装过去会把源码删掉。`);
  }

  const existed = existsSync(target);
  if (existed && !(await isEmptyDir(target)) && !(await looksLikeOurInstall(target))) {
    throw new Error(
      `「${relative}」已经存在，而且看起来不是本技能装出来的（里面没有 agentic-topology 的 SKILL.md）。\n`
      + '安装会先清空这个目录，所以这里停下来了——没有删除任何东西。\n'
      + '确认这个目录可以被覆盖的话，先自己删掉它再重装；否则换一个 --dir。',
    );
  }

  // 到这里才允许清。留着上一版的文件，agent 会同时读到两份互相矛盾的规则。
  await rm(target, { recursive: true, force: true });
  let files = 0;
  for (const name of PAYLOAD) {
    files += await copyTree(path.join(root, name), path.join(target, name));
  }
  return { target: path.relative(cwd, target) || target, files, replaced: existed };
}
