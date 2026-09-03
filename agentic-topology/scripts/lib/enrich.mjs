import { readFile } from 'node:fs/promises';
import path from 'node:path';

// 信息块排在连线之后、字段之前：先看方块，再看线，再看线上传的东西，
// 最后才是某个字段。改这四个数会改变产物字节，逐字节相同的断言会红。
const LEVEL_ORDER = { node: 0, edge: 1, information: 2, field: 3 };

function sourceOf(item, fallbackDate, say = SAY.zh) {
  const source = item?.source || {};
  return {
    refs: Array.isArray(source.refs) && source.refs.length ? [...source.refs] : [say.noSource],
    confirmed_at: /^\d{4}-\d{2}-\d{2}$/.test(source.confirmed_at || '')
      ? source.confirmed_at
      : fallbackDate,
  };
}

// 清单条目的句子也是界面文案，跟着出图语言走。
const SAY = {
  zh: {
    node: (ref) => `方块 ${ref} 需要你核实`,
    edge: (ref) => `连线 ${ref} 需要你核实`,
    information: (ref) => `信息「${ref}」需要你核实`,
    prompt: (ref) => `${ref} 的提示词需要你核实`,
    field: (ref, field) => `${ref} 的 ${field} 需要你核实`,
    sameAs: (a, b) => `「${a}」与「${b}」可能是同一份，需要你核实`,
    noSource: '未提供来源', noPrompt: '没有提示词来源',
    promptRange: '提示词行区间超出文件范围', promptUnreadable: '读不到这段提示词',
    ends: (name, wroteFrom, wroteTo, sawFrom, sawTo) =>
      `「${name}」写的是从 ${wroteFrom} 到 ${wroteTo}，但线上看是从 ${sawFrom} 到 ${sawTo}，需要你核实`,
  },
  en: {
    node: (ref) => `block ${ref} needs checking`,
    edge: (ref) => `line ${ref} needs checking`,
    information: (ref) => `"${ref}" needs checking`,
    prompt: (ref) => `the prompt of ${ref} needs checking`,
    field: (ref, field) => `${field} of ${ref} needs checking`,
    sameAs: (a, b) => `"${a}" and "${b}" might be the same thing — please check`,
    noSource: 'no source given', noPrompt: 'no prompt source',
    promptRange: 'the prompt line range is outside the file',
    promptUnreadable: 'cannot read that stretch of prompt',
    ends: (name, wroteFrom, wroteTo, sawFrom, sawTo) =>
      `"${name}" says it goes from ${wroteFrom} to ${wroteTo}, but the lines show ${sawFrom} to ${sawTo}`
      + ' — please check',
  },
};

function itemText(level, ref, field, say) {
  if (level === 'node') return say.node(ref);
  if (level === 'edge') return say.edge(ref);
  if (level === 'information') return say.information(ref);
  if (field === 'system_prompt') return say.prompt(ref);
  return say.field(ref, field);
}

function addChecklist(list, level, ref, field, confidence, source, fallbackDate, say) {
  // design 是「这块还在设计稿上，本来就没落地」，不是「你去核实一下」——MUST NOT 进核对清单。
  if (confidence !== 'inferred' && confidence !== 'unread') return;
  list.push({
    level,
    ref,
    field: field ?? null,
    confidence,
    text: itemText(level, ref, field, say),
    source: sourceOf(source, fallbackDate, say),
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

async function promptView(node, baseDir, warnings, checklist, fallbackDate, say) {
  const prompt = node.system_prompt;
  if (!prompt) return undefined;
  if (prompt.inline !== undefined) return { kind: 'inline', text: prompt.inline };
  if (!prompt.file) return { kind: 'unreadable', reason: say.noPrompt };
  const file = path.resolve(baseDir, prompt.file);
  try {
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const from = Number(prompt.from) || 1;
    const to = Number(prompt.to) || lines.length;
    if (from < 1 || to < from || to > lines.length) {
      addChecklist(checklist, 'field', node.id, 'system_prompt', 'unread', node, fallbackDate, say);
      warnings.push(`prompt: range out of bounds for ${node.id}`);
      return {
        kind: 'unreadable',
        file: prompt.file,
        from,
        to,
        reason: say.promptRange,
      };
    }
    return {
      kind: 'file',
      file: prompt.file,
      from,
      to,
      lines: lines.slice(Math.max(0, from - 1), to),
    };
  } catch (error) {
    const ref = node.id;
    const source = sourceOf(node, fallbackDate, say);
    addChecklist(checklist, 'field', ref, 'system_prompt', 'unread', node, fallbackDate, say);
    warnings.push(`prompt: unable to read ${node.id}: ${error.message}`);
    return { kind: 'unreadable', file: prompt.file, reason: say.promptUnreadable };
  }
}

/** 按可信度规则生成核对清单，并补充提示词展示数据。 */
export async function enrich(data, { baseDir = '.', lang = 'zh' } = {}) {
  const say = SAY[lang] || SAY.zh;
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const fallbackDate = /^\d{4}-\d{2}-\d{2}$/.test(data.generated_at || '') ? data.generated_at : '1970-01-01';
  const checklist = [];
  const prompts = new Map();
  const warnings = [];
  for (const node of nodes) {
    addChecklist(checklist, 'node', node.id, null, node.confidence, node, fallbackDate, say);
    for (const [field, confidence] of Object.entries(node.field_confidence || {}))
      addChecklist(checklist, 'field', node.id, field, confidence, node, fallbackDate, say);
    const prompt = await promptView(node, baseDir, warnings, checklist, fallbackDate, say);
    if (prompt) prompts.set(node.id, prompt);
  }
  for (const edge of edges) {
    const ref = `${edge.from}->${edge.to}`;
    addChecklist(checklist, 'edge', ref, null, edge.confidence, edge, fallbackDate, say);
    for (const [field, confidence] of Object.entries(edge.field_confidence || {}))
      addChecklist(checklist, 'field', ref, field, confidence, edge, fallbackDate, say);
  }
  const information = Array.isArray(data.information) ? data.information : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  // 从连线算出来的「从哪来 / 到哪去」：一份信息可能被好几条线传，
  // 起点取第一条传它的线的上游，终点取最后一条的下游。
  const flowEnds = new Map();
  for (const edge of edges) {
    for (const payload of edge.payloads || []) {
      if (!payload?.info) continue;
      const ends = flowEnds.get(payload.info) || { from: edge.from, to: edge.to };
      ends.to = edge.to;
      flowEnds.set(payload.info, ends);
    }
  }
  const samePairs = new Set();
  for (const item of information) {
    const name = item?.name || item?.id;
    addChecklist(checklist, 'information', name, null, item?.confidence, item, fallbackDate, say);
    // 「可能与哪份是同一份」：互指的两份只出一条，MUST NOT 两头各报一次。
    if (item?.same_as) {
      const other = information.find((x) => x?.id === item.same_as);
      const pair = [item.id, item.same_as].sort().join('\u0000');
      if (other && !samePairs.has(pair)) {
        samePairs.add(pair);
        checklist.push({
          level: 'information',
          ref: name,
          field: 'same_as',
          confidence: item.confidence === 'unread' ? 'unread' : 'inferred',
          text: say.sameAs(name, other.name || other.id),
          source: sourceOf(item, fallbackDate, say),
        });
      }
    }
    // 信息块上写的起终点，与从连线算出来的对不上：图上按连线算的画，
    // 这里只把不一致点出来交给人核实。
    const ends = flowEnds.get(item?.id);
    if (ends && nodeIds.has(item?.origin) && nodeIds.has(item?.destination)
      && (ends.from !== item.origin || ends.to !== item.destination)) {
      checklist.push({
        level: 'information',
        ref: name,
        field: 'origin',
        confidence: 'inferred',
        text: say.ends(name, item.origin, item.destination, ends.from, ends.to),
        source: sourceOf(item, fallbackDate, say),
      });
    }
  }
  sortChecklist(checklist);
  return {
    checklist,
    prompts,
    stats: { checklist_items: checklist.length },
    warnings,
  };
}
