import { readFile } from 'node:fs/promises';
import path from 'node:path';

const LEVEL_ORDER = { node: 0, edge: 1, field: 2 };

function sourceOf(item, fallbackDate) {
  const source = item?.source || {};
  return {
    refs: Array.isArray(source.refs) && source.refs.length ? [...source.refs] : ['未提供来源'],
    confirmed_at: /^\d{4}-\d{2}-\d{2}$/.test(source.confirmed_at || '')
      ? source.confirmed_at
      : fallbackDate,
  };
}

function itemText(level, ref, field) {
  if (level === 'node') return `方块 ${ref} 需要你核实`;
  if (level === 'edge') return `连线 ${ref} 需要你核实`;
  return `${ref} 的 ${field} 需要你核实`;
}

function addChecklist(list, level, ref, field, confidence, source, fallbackDate) {
  if (confidence !== 'inferred' && confidence !== 'unread') return;
  list.push({
    level,
    ref,
    field: field ?? null,
    confidence,
    text: itemText(level, ref, field),
    source: sourceOf(source, fallbackDate),
  });
}

function sortChecklist(list) {
  return list.sort((a, b) => {
    const confidence = (a.confidence === 'unread' ? 0 : 1) - (b.confidence === 'unread' ? 0 : 1);
    if (confidence !== 0) return confidence;
    const level = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (level !== 0) return level;
    const aKey = `${a.ref}.${a.field || ''}`;
    const bKey = `${b.ref}.${b.field || ''}`;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

async function promptView(node, baseDir, warnings, checklist, fallbackDate) {
  const prompt = node.system_prompt;
  if (!prompt) return undefined;
  if (prompt.inline !== undefined) return { kind: 'inline', text: prompt.inline };
  if (!prompt.file) return { kind: 'unreadable', reason: '没有提示词来源' };
  const file = path.resolve(baseDir, prompt.file);
  try {
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const from = Number(prompt.from) || 1;
    const to = Number(prompt.to) || lines.length;
    return {
      kind: 'file',
      file: prompt.file,
      from,
      to,
      lines: lines.slice(Math.max(0, from - 1), to),
    };
  } catch (error) {
    const ref = node.id;
    const source = sourceOf(node, fallbackDate);
    addChecklist(checklist, 'field', ref, 'system_prompt', 'unread', node, fallbackDate);
    warnings.push(`prompt: unable to read ${node.id}: ${error.message}`);
    return { kind: 'unreadable', file: prompt.file, reason: '读不到这段提示词' };
  }
}

/** 按可信度规则生成核对清单，并补充提示词展示数据。 */
export async function enrich(data, { baseDir = '.' } = {}) {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(data.generated_at || '') ? data.generated_at : '1970-01-01';
  const checklist = [];
  const prompts = new Map();
  const warnings = [];
  for (const node of nodes) {
    addChecklist(checklist, 'node', node.id, null, node.confidence, node, fallbackDate);
    for (const [field, confidence] of Object.entries(node.field_confidence || {}))
      addChecklist(checklist, 'field', node.id, field, confidence, node, fallbackDate);
    const prompt = await promptView(node, baseDir, warnings, checklist, fallbackDate);
    if (prompt) prompts.set(node.id, prompt);
  }
  for (const edge of edges) {
    const ref = `${edge.from}->${edge.to}`;
    addChecklist(checklist, 'edge', ref, null, edge.confidence, edge, fallbackDate);
    for (const [field, confidence] of Object.entries(edge.field_confidence || {}))
      addChecklist(checklist, 'field', ref, field, confidence, edge, fallbackDate);
  }
  sortChecklist(checklist);
  return {
    checklist,
    prompts,
    stats: { checklist_items: checklist.length },
    warnings,
  };
}
