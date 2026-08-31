/** 表示拓扑描述解析失败。 */
export class TopologyError extends Error {
  constructor(message, code = 'E_SYNTAX', path = null, line = null) {
    super(message);
    this.name = 'TopologyError';
    this.code = code;
    this.path = path;
    this.line = line;
  }
}

function parseScalar(value, line) {
  const text = value.trim();
  const forbidden = [
    ['&', '锚点'], ['*', '引用或别名'], ['{', '流式映射'], ['!!', '标签'], ['>', '折叠块标量'],
  ];
  for (const [prefix, name] of forbidden) {
    if (text.startsWith(prefix)) throw new TopologyError(`不支持 ${name}`, 'E_SYNTAX', null, line);
  }
  if (text.startsWith('&')) throw new TopologyError('不支持锚点', 'E_SYNTAX', null, line);
  if (text === '[]') return [];
  if (text.startsWith('[')) {
    throw new TopologyError('不支持流式序列；非空序列请用块序列 - item', 'E_SYNTAX', null, line);
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '') return null;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    return text.slice(1, -1).replace(/\\([\\"nt])/g, (_, char) => {
      const escapes = { '\\': '\\', '"': '"', n: '\n', t: '\t' };
      return escapes[char];
    });
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1);
  // 引号开了却没在本行闭合——最常见的是把长文本按习惯换了行。
  // 不给这条专门的消息，报出来的会是下一行的「缩进层级不支持」，指错地方也说错原因。
  for (const quote of ['"', "'"]) {
    if (text.startsWith(quote) && !(text.length >= 2 && text.endsWith(quote))) {
      throw new TopologyError(
        `引号标量没有在同一行闭合；多行文本请改用 | 或 |-`, 'E_SYNTAX', null, line);
    }
  }
  const hash = text.indexOf(' #');
  return hash >= 0 ? text.slice(0, hash).trimEnd() : text;
}

function nextMeaningful(rawLines, start) {
  let index = start;
  while (index < rawLines.length) {
    const line = rawLines[index];
    if (line.trim() && !line.trimStart().startsWith('#')) return index;
    index += 1;
  }
  return index;
}

function parseBlock(rawLines, start, indent, path, lines) {
  const first = nextMeaningful(rawLines, start);
  if (first >= rawLines.length) return { value: null, next: first };
  const isSequence = rawLines[first].slice(indent).startsWith('- ');
  const value = isSequence ? [] : {};
  let index = first;
  while (index < rawLines.length) {
    const raw = rawLines[index];
    if (!raw.trim() || raw.trimStart().startsWith('#')) { index += 1; continue; }
    const currentIndent = raw.length - raw.trimStart().length;
    if (currentIndent < indent) break;
    if (currentIndent > indent) {
      throw new TopologyError('缩进层级不支持', 'E_SYNTAX', null, index + 1);
    }
    const content = raw.trim();
    if (content === '---') throw new TopologyError('不支持多文档', 'E_SYNTAX', null, index + 1);
    if (isSequence) {
      if (!content.startsWith('- ')) break;
      const itemText = content.slice(2);
      const itemPath = `${path}[${value.length}]`;
      const inlineKey = itemText.match(/^([^:]+):(?:\s|$)/);
      if (inlineKey) {
        const item = {};
        value.push(item);
        const colon = itemText.indexOf(':');
        const key = itemText.slice(0, colon).trim();
        const rest = itemText.slice(colon + 1).trim();
        const keyPath = `${itemPath}.${key}`;
        lines.set(keyPath, index + 1);
        if (rest === '') {
          const child = parseBlock(rawLines, index + 1, indent + 2, keyPath, lines);
          item[key] = child.value;
          index = child.next;
        } else {
          item[key] = parseScalar(rest, index + 1);
          index += 1;
        }
        const childIndent = index < rawLines.length
          ? rawLines[index].length - rawLines[index].trimStart().length
          : -1;
        if (childIndent > indent) {
          const child = parseBlock(rawLines, index, childIndent, itemPath, lines);
          Object.assign(item, child.value);
          index = child.next;
        }
      } else {
        value.push(parseScalar(itemText, index + 1));
        lines.set(itemPath, index + 1);
        index += 1;
      }
      continue;
    }
    const colon = content.indexOf(':');
    if (colon < 0) throw new TopologyError('不支持的语法', 'E_SYNTAX', null, index + 1);
    const key = content.slice(0, colon).trim();
    const rest = content.slice(colon + 1).trim();
    const keyPath = path ? `${path}.${key}` : key;
    lines.set(keyPath, index + 1);
    if (rest === '|' || rest === '|-') {
      const block = [];
      let cursor = index + 1;
      while (cursor < rawLines.length) {
        const blockRaw = rawLines[cursor];
        const blockIndent = blockRaw.length - blockRaw.trimStart().length;
        if (blockRaw.trim() && blockIndent <= indent) break;
        block.push(blockRaw.slice(Math.min(blockRaw.length, indent + 2)));
        cursor += 1;
      }
      value[key] = block.join('\n') + (rest === '|' ? '\n' : '');
      index = cursor;
    } else if (rest === '') {
      const childStart = nextMeaningful(rawLines, index + 1);
      if (childStart >= rawLines.length) { value[key] = null; index = childStart; continue; }
      const childIndent = rawLines[childStart].length - rawLines[childStart].trimStart().length;
      const child = parseBlock(rawLines, childStart, childIndent, keyPath, lines);
      value[key] = child.value;
      index = child.next;
    } else {
      value[key] = parseScalar(rest, index + 1);
      index += 1;
    }
  }
  return { value, next: index };
}

/** 解析受限 YAML 子集或标准 JSON，并记录每个值的源行号。 */
export function parseTopology(text, filename = '') {
  if (text.startsWith('\uFEFF')) throw new TopologyError('文件必须是 UTF-8 无 BOM', 'E_SYNTAX', null, 1);
  if (filename.endsWith('.json')) {
    try { return { data: JSON.parse(text), lines: new Map() }; }
    catch (error) { throw new TopologyError(`JSON 解析失败：${error.message}`); }
  }
  const rawLines = text.split(/\r?\n/);
  for (let index = 0; index < rawLines.length; index += 1) {
    if (rawLines[index].includes('\t')) {
      throw new TopologyError('不支持 Tab 缩进', 'E_SYNTAX', null, index + 1);
    }
    if (rawLines[index].trimStart().startsWith('? ')) {
      throw new TopologyError('不支持复杂键', 'E_SYNTAX', null, index + 1);
    }
  }
  const lines = new Map();
  const first = nextMeaningful(rawLines, 0);
  const parsed = parseBlock(rawLines, first, 0, '', lines);
  return { data: parsed.value, lines };
}
