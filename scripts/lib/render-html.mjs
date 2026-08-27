import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutFolded } from './layout.mjs';
import { applyFilter, foldSummary } from './interactions.mjs';

const ASSET_DIR = fileURLToPath(new URL('../../assets/page-shell/', import.meta.url));
const SHELL = readFileSync(`${ASSET_DIR}/shell.html`, 'utf8');
const THEME = readFileSync(`${ASSET_DIR}/theme.css`, 'utf8');
const COMPONENTS = readFileSync(`${ASSET_DIR}/components.css`, 'utf8');
const TOPO = readFileSync(`${ASSET_DIR}/topo.css`, 'utf8');
const APP = readFileSync(`${ASSET_DIR}/app.js`, 'utf8').replace(
  '/*SLOT:APPLY_FILTER*/',
  applyFilter.toString(),
);

const WORDS = {
  topology: {
    peer_loop: '大家轮着来',
    manager_worker: '一个总管派活',
    decentralized_handoff: '各自往下传',
    fixed_workflow: '一条固定流水线',
  },
  context: { full: '全都看得见', isolated: '各看各的', mixed: '一部分看得见' },
  kind: { agent: 'AI', program: '程序', decision: '岔路口' },
  confidence: { certain: '查实了', inferred: '只是猜的', unread: '没查出来' },
  category: {
    normal: '正常往下走',
    pass_or_skip: '通过或跳过',
    reject_or_halt: '打回或叫停',
  },
  labels: {
    overview: '编排全貌', back: '回上一层', what: '干什么', inputs: '收到什么',
    outputs: '交出什么', purpose: '它夹在中间是为了解决什么', group: '属于哪一堆',
    concurrency: '同时跑几个', source: '从哪查到的', prompt: '它的提示词写在哪',
    abilities: '它能用哪些能力', spawn: '它会不会派别人干活', stop: '它什么时候会停下',
    links: '它跟谁连着', tools: '自带的工具', mcp: '外挂的能力（MCP）',
    skills: '装的技能（Skill）', none: '一个都没有', notSet: '没设',
    checklist: '这几处得你自己去核实',
    start: '从哪开始', end: '在哪结束', folded: '收起来看', expand: '全部展开', detail: '详情',
    concurrent: '同时干', items: '件', fan: '会派别人', in: '进', out: '出',
    line: '第', confirmed: '查证', inCount: '条进来', outCount: '条出去',
    foldedHint: '收起来只是不显示堆里面的线，一个方块一条线都没少',
    edgeCategory: '这是条什么线', trigger: '什么情况下走', carrier: '靠什么交过去',
    confirmedTime: '查证时间',
    screening: '收下之前先查什么', concurrencyControl: '同时来了好几份怎么办',
    payload: '这条线上传的东西', producedAt: '什么时候造出来的',
    deliveredAt: '什么时候交出去的',
    limits: {
      steps: '走多少步', time: '花多长时间', cost: '花钱', consecutive_failures: '连着失败几次',
    },
  },
};

/** 将任意描述文本安全转成 HTML 实体。 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function value(item, fallback = WORDS.labels.notSet) {
  if (item === undefined || item === null || item === '' || item === 'not_set') return esc(
    item === 'not_set' ? WORDS.labels.notSet : fallback,
  );
  return esc(item);
}

function optional(item) {
  return value(item, '未填写');
}

function flag(confidence) {
  const cls = confidence === 'certain' ? 'is-sure' : confidence === 'inferred' ? 'is-guess' : 'is-unknown';
  return `<span class="topo-flag ${cls}">${value(WORDS.confidence[confidence] || confidence)}</span>`;
}

function nodeHtml(node, box) {
  const confidence = node.confidence || 'unread';
  const classes = ['topo-node', node.kind === 'agent' ? 'is-agent' : '', confidence !== 'certain' ? 'is-guess' : ''];
  const marks = [];
  if (Number(node.concurrency?.default) > 1) {
    marks.push(`<span class="topo-mark is-conc">${WORDS.labels.concurrent} ` +
      `${value(node.concurrency.default)} ${WORDS.labels.items}</span>`);
  }
  if (node.spawns_subagents === true) {
    marks.push(`<span class="topo-mark is-fan">${WORDS.labels.fan}</span>`);
  }
  const labels = WORDS.kind;
  const top = `<div class="topo-node-top"><span class="topo-node-kind">${value(labels[node.kind])}</span>` +
    `<span class="topo-node-id">${value(node.id)}</span>${flag(confidence)}</div>`;
  const head = `<div class="${classes.filter(Boolean).join(' ')}" data-node-id="${value(node.id)}"` +
    ` data-goto="${value(node.id)}" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px">`;
  return `${head}${top}<div class="topo-node-name">${value(node.name)}</div>` +
    `<div class="topo-node-desc">${value(node.responsibility)}</div>` +
    (marks.length ? `<div class="topo-marks">${marks.join('')}</div>` : '') + '</div>';
}

function overview(data, pageLayout, staleness) {
  const frames = [...pageLayout.groups.values()].map((group) =>
    `<div class="topo-frame" style="left:${group.x}px;top:${group.y}px;width:${group.w}px;height:${group.h}px">` +
    `<span class="topo-frame-label">${value(group.name)}</span></div>`).join('');
  const edges = pageLayout.edges.map((edge) => {
    const cls = edge.category === 'pass_or_skip' ? 'is-ok' :
      edge.category === 'reject_or_halt' ? 'is-back' : 'is-main';
    const trust = edge.confidence === 'certain' ? '' : ` is-${edge.confidence}`;
    const edgeId = `${edge.from}->${edge.to}`;
    return `<path class="topo-edge ${cls}${trust}" data-edge-id="${value(edgeId)}"` +
      ` d="${esc(edge.d)}" marker-end="url(#ah-${cls.slice(3)})"/>` +
      `<path class="topo-edge-hit" data-edge-id="${value(edgeId)}" d="${esc(edge.d)}"/>` +
      `<text class="topo-elabel" data-edge-id="${value(edgeId)}" x="${edge.labelX}"` +
      ` y="${edge.labelY}">${value(edge.label)}</text>`;
  }).join('');
  const nodes = [...pageLayout.nodes.entries()].map(([id, box]) =>
    nodeHtml(data.nodes.find((node) => node.id === id), box)).join('');
  const exits = (data.graph?.exits || []).map((exit) =>
    `<li class="list-item"><span class="badge">${value(exit.name)}</span>` +
    `<span class="text-xs grow">${value(exit.condition)}</span></li>`).join('');
  const incompleteNotice = data.analysis_complete === false
    ? '<div class="alert alert-warning">还没分析完，这张图不全</div>' : '';
  const staleNotice = staleness?.stale
    ? `<div class="alert alert-warning">这张图可能已经过期：${value(staleness.reason)}</div>` : '';
  const emptyNotice = (data.nodes || []).length === 0
    ? '<div class="alert"><strong>还没有可画的东西</strong>' +
      '<span class="text-sm muted">打开写好的描述，填入方块和连线后再出图。</span></div>' : '';
  const marker = (id, color) => `<marker id="${id}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">` +
    `<path d="M0,0 L6,3 L0,6 z" fill="${color}"/></marker>`;
  const markers = `<defs>${marker('ah-main', 'var(--primary)')}${marker('ah-ok', 'var(--success)')}` +
    `${marker('ah-back', 'var(--destructive)')}</defs>`;
  const head = `<section id="view-overview" class="view"><div class="app-bar">` +
    `<span class="topo-crumb">${WORDS.labels.overview}</span></div><div class="screen">` +
    `<div class="row"><span class="badge badge-secondary">${value(WORDS.topology[data.graph?.topology])}</span>` +
    `<span class="badge badge-outline">${value(WORDS.context[data.graph?.context_sharing])}</span>` +
    `<span class="topo-flag is-sure">${(data.nodes || []).length} 个方块</span>` +
    `<span class="topo-flag is-sure">${(data.edges || []).length} 条连线</span>` +
    `<span class="topo-flag is-sure">${esc(WORDS.labels.checklist)} ${data.checklist?.length || 0} 处</span>` +
    `<span class="text-xs muted">查证时间 ${value(data.generated_at)}</span></div>` +
    incompleteNotice + staleNotice + emptyNotice +
    filterControls(data) +
    `<div class="topo-legend"><span class="topo-legend-item"><span class="topo-swatch"></span>` +
    `${esc(WORDS.category.normal)}</span>` +
    `<span class="topo-legend-item"><span class="topo-swatch is-ok"></span>${esc(WORDS.category.pass_or_skip)}</span>` +
    `<span class="topo-legend-item"><span class="topo-swatch is-back"></span>` +
    `${esc(WORDS.category.reject_or_halt)}</span></div>`;
  const diagram = `<div class="topo-wrap"><div class="topo-stage" style="width:${pageLayout.stage.w}px;` +
    `height:${pageLayout.stage.h}px"><svg class="topo-edges"` +
    ` viewBox="0 0 ${pageLayout.stage.w} ${pageLayout.stage.h}"` +
    ` aria-hidden="true">${markers}${edges}</svg>${frames}<div class="topo-pill" style="left:0;top:0">` +
    `${esc(WORDS.labels.start)}：${value(data.graph?.entry)}</div>${nodes}</div></div>`;
  const ending = `<div class="card card-compact"><div class="card-header"><div class="card-title">` +
    `${esc(WORDS.labels.end)}</div></div>` +
    `<div class="card-content"><ul class="list">${exits}</ul></div></div></div></section>`;
  const checklist = (data.checklist || []).map((item) =>
    `<li class="list-item"><span class="text-xs grow">${value(item.text)}</span></li>`).join('');
  const checklistCard = `<div class="card card-compact"><div class="card-header"><div class="card-title">` +
    `${esc(WORDS.labels.checklist)} ${data.checklist?.length || 0} 处</div></div>` +
    `<div class="card-content"><ul class="list">${checklist}</ul></div></div>`;
  return `${head}${diagram}${checklistCard}${ending}`;
}

function filterControls(data) {
  const checkbox = (dimension, key, label) => `<label class="topo-filter-option">` +
    `<input type="checkbox" data-filter-dimension="${esc(dimension)}" value="${esc(key)}">` +
    `<span>${value(label)}</span></label>`;
  const confidence = Object.entries(WORDS.confidence)
    .map(([key, label]) => checkbox('confidence', key, label)).join('');
  const kinds = Object.entries(WORDS.kind).map(([key, label]) => checkbox('kind', key, label)).join('');
  const groups = (data.groups || []).map((group) => checkbox('group', group.id, group.name)).join('');
  return `<div class="topo-filters"><fieldset><legend>查得准不准</legend>${confidence}</fieldset>` +
    `<fieldset><legend>AI 还是程序</legend>${kinds}</fieldset>` +
    `<fieldset><legend>分堆</legend>${groups || '<span class="muted text-xs">没有分堆</span>'}</fieldset></div>`;
}

function kv(label, content) {
  return `<div class="kv-row"><dt>${esc(label)}</dt><dd>${content}</dd></div>`;
}

function promptSection(node, prompt) {
  if (node.kind !== 'agent') return '';
  const source = prompt || node.system_prompt || {};
  let body = `<span class="topo-flag is-unknown">${esc(WORDS.confidence.unread)}</span>`;
  const file = source.file || node.system_prompt?.file;
  const from = source.from || node.system_prompt?.from || 1;
  const to = source.to || node.system_prompt?.to || from;
  if (source.kind === 'inline' || source.inline !== undefined) {
    const text = source.text !== undefined ? source.text : source.inline;
    body = `<div class="topo-src"><div class="topo-src-body"><div class="topo-line is-hit">` +
      `<span>1</span><span class="mono">${value(text)}</span></div></div></div>`;
  } else if (file && source.kind === 'unreadable') {
    body = `<div class="topo-src"><div class="topo-src-head"><span class="mono">${value(file)} ` +
      `${WORDS.labels.line} ${value(from)}–${value(to)} 行</span></div>` +
      `<div class="topo-src-body"><span class="text-sm muted">读不到这个文件的第 ` +
      `${value(from)}–${value(to)} 行：` +
      `${value(source.reason || '无法读取')}</span></div></div>`;
  } else if (file) {
    const lines = Array.isArray(source.lines) ? source.lines : [];
    const renderedLines = lines.map((line, index) => `<div class="topo-line is-hit">` +
      `<span>${Number(from) + index}</span><span class="mono">${value(line)}</span></div>`).join('');
    body = `<div class="topo-src"><div class="topo-src-head"><span class="mono">${value(file)} ` +
      `${WORDS.labels.line} ${value(from)}–${value(to)} 行</span></div>` +
      `<div class="topo-src-body">${renderedLines}</div></div>`;
  }
  const mark = file
    ? `${WORDS.labels.line} ${value(from)}–${value(to)} 行`
    : '';
  return `<details class="topo-acc-item"><summary class="topo-acc-head">${esc(WORDS.labels.prompt)}` +
    `<span class="topo-acc-mark">${mark}</span></summary><div class="topo-acc-body">${body}</div></details>`;
}

function abilities(node) {
  if (node.kind !== 'agent') return '';
  const list = (items) => Array.isArray(items) && items.length
    ? items.map((item) => `<span class="badge badge-secondary mono">${value(item)}</span>`).join('')
    : `<span class="text-xs muted">${esc(WORDS.labels.none)}</span>`;
  const section = (title, items) => `<div class="text-xs font-semibold muted">${esc(title)}</div>` +
    `<div class="row">${list(items)}</div>`;
  return `<details class="topo-acc-item"><summary class="topo-acc-head">${esc(WORDS.labels.abilities)}` +
    `<span class="topo-acc-mark">工具 ${node.tools?.length || 0} · MCP ${node.mcp?.length || 0}` +
    ` · Skill ${node.skills?.length || 0}</span></summary>` +
    `<div class="topo-acc-body"><div class="stack-sm">${section(WORDS.labels.tools, node.tools)}` +
    `<div class="separator"></div>` +
    `${section(WORDS.labels.mcp, node.mcp)}<div class="separator"></div>` +
    `${section(WORDS.labels.skills, node.skills)}</div></div></details>`;
}

function stopSection(node) {
  if (node.kind !== 'agent') return '';
  const conditions = (node.stop?.conditions || []).map((condition) =>
    `<li class="list-item"><span class="text-sm">${value(condition)}</span></li>`).join('');
  const rows = Object.entries(node.stop?.limits || {})
    .map(([key, item]) => kv(WORDS.labels.limits[key] || key, value(item))).join('');
  return `<details class="topo-acc-item"><summary class="topo-acc-head">${esc(WORDS.labels.stop)}</summary>` +
    `<div class="topo-acc-body"><ul class="list">${conditions}</ul><dl class="kv">${rows}</dl></div></details>`;
}

function linksSection(node, data) {
  const incoming = (data.edges || []).filter((edge) => edge.to === node.id);
  const outgoing = (data.edges || []).filter((edge) => edge.from === node.id);
  const item = (edge, direction) => {
    const id = direction === WORDS.labels.in ? edge.from : edge.to;
    const other = data.nodes.find((candidate) => candidate.id === id);
    const payloads = (edge.payloads || []).map((payload) => value(payload.content)).join('、');
    return `<li class="list-item"><span class="badge badge-outline">${esc(direction)}</span>` +
      `<span class="text-xs grow">${other ? value(other.name) : value(id)}：${payloads}</span></li>`;
  };
  return `<details class="topo-acc-item"><summary class="topo-acc-head">${esc(WORDS.labels.links)}` +
    `<span class="topo-acc-mark">${incoming.length} ${WORDS.labels.inCount} · ` +
    `${outgoing.length} ${WORDS.labels.outCount}</span></summary>` +
    `<div class="topo-acc-body"><ul class="list">${incoming.map((edge) => item(edge, WORDS.labels.in)).join('')}` +
    `${outgoing.map((edge) => item(edge, WORDS.labels.out)).join('')}</ul></div></details>`;
}

function detail(data, node, enriched) {
  const group = (data.groups || []).find((item) => item.id === node.group);
  const rows = [
    kv(WORDS.labels.what, value(node.responsibility)),
    kv(WORDS.labels.inputs, value(node.inputs)),
    kv(WORDS.labels.outputs, value(node.outputs)),
  ];
  if (node.kind !== 'agent') rows.push(kv(WORDS.labels.purpose, value(node.purpose)));
  rows.push(kv(WORDS.labels.group, optional(group?.name)));
  rows.push(kv(WORDS.labels.concurrency, value(node.concurrency?.default)));
  const source = `<span class="mono text-xs">${value(node.source?.refs?.join(' · '))}` +
    ` · ${value(node.source?.confirmed_at)} ${WORDS.labels.confirmed}</span>`;
  rows.push(kv(WORDS.labels.source, source));
  const subcards = node.spawns_subagents === true && Array.isArray(node.subagents)
    ? node.subagents.map((sub) => `<div class="topo-sub"><button class="btn btn-ghost btn-sm"` +
      ` data-goto="${value(sub.node)}">${value(sub.node)}</button>` +
      `<span class="text-xs">${value(sub.note)}</span></div>`).join('')
    : '';
  const spawn = node.kind === 'agent' ? `<details class="topo-acc-item"><summary class="topo-acc-head">` +
    `${esc(WORDS.labels.spawn)}<span class="topo-acc-mark">` +
    `${node.spawns_subagents ? WORDS.labels.fan : `不${WORDS.labels.fan.slice(1)}`}</span></summary>` +
    `<div class="topo-acc-body"><div class="stack-sm"><div class="text-sm">` +
    `${node.spawns_subagents ? `${WORDS.labels.fan}干活` : `不会${WORDS.labels.fan.slice(1)}干活`}</div>` +
    `${subcards || `<span class="text-xs muted">${esc(WORDS.labels.none)}</span>`}</div></div></details>` : '';
  const sections = `<details class="topo-acc-item" open><summary class="topo-acc-head">` +
    `${esc(WORDS.labels.what)}<span class="topo-acc-mark">${flag(node.confidence)}</span></summary>` +
    `<div class="topo-acc-body"><dl class="kv">${rows.join('')}</dl></div></details>` +
    `${promptSection(node, enriched?.prompts?.get(node.id))}` +
    `${abilities(node)}${spawn}${stopSection(node)}${linksSection(node, data)}`;
  const labels = WORDS.kind;
  return `<section id="detail-${value(node.id)}" class="topo-detail" data-detail-for="${value(node.id)}">` +
    `<div class="topo-chain"><div class="topo-chain-cell is-focus"><div class="topo-node-top">` +
    `<span class="topo-node-kind">${value(labels[node.kind])}</span>` +
    `<span class="topo-node-id">${value(node.id)}</span></div>` +
    `<div class="topo-node-name">${value(node.name)}</div></div></div>` +
    `<div class="topo-acc">${sections}</div></section>`;
}

function edgeDetail(edge) {
  const edgeKey = `${edge.from}->${edge.to}`;
  const source = `<span class="mono text-xs">${value(edge.source?.refs?.join(' · '))}` +
    ` · ${esc(WORDS.labels.confirmedTime)}：${value(edge.source?.confirmed_at)}</span>`;
  const rows = [
    kv(WORDS.labels.edgeCategory, value(WORDS.category[edge.category] || edge.category)),
    kv(WORDS.labels.trigger, value(edge.trigger)),
    kv(WORDS.labels.carrier, value({
      file: '文件', bundle: '一份打包好的数据', prompt: '提示词', event: '事件', other: '别的',
    }[edge.carrier] || edge.carrier)),
  ];
  if (edge.screening !== undefined) rows.push(kv(WORDS.labels.screening, value(edge.screening)));
  rows.push(kv(WORDS.labels.concurrencyControl, value(edge.concurrency_control)));
  rows.push(kv(WORDS.labels.source, source));
  const payloads = (edge.payloads || []).map((payload) => `<div class="topo-payload"><dl class="kv">` +
    `${kv(WORDS.labels.payload, value(payload.content))}` +
    `${kv(WORDS.labels.producedAt, value(payload.produced_at))}` +
    `${kv(WORDS.labels.deliveredAt, value(payload.delivered_at))}</dl></div>`).join('');
  const body = `<details class="topo-acc-item" open><summary class="topo-acc-head">` +
    `${esc(WORDS.labels.payload)}<span class="topo-acc-mark">${(edge.payloads || []).length}</span>` +
    `</summary><div class="topo-acc-body">${payloads}</div></details>`;
  return `<section class="topo-detail topo-edge-detail" data-edge-detail="${esc(edge.from)}->${esc(edge.to)}">` +
    `<div class="topo-edge-detail-title"><span class="mono">${value(edge.from)} → ${value(edge.to)}</span></div>` +
    `<div class="topo-acc"><details class="topo-acc-item" open><summary class="topo-acc-head">` +
    `${esc(WORDS.labels.trigger)}</summary><div class="topo-acc-body"><dl class="kv">${rows.join('')}</dl>` +
    `</div></details>${body}</div></section>`;
}

function folded(data) {
  const summary = foldSummary(data);
  const foldedLayout = layoutFolded(data);
  const cards = [...foldedLayout.cards.values()].map((card) => {
    const badges = [
      card.agents ? `${card.agents} 个 AI` : '',
      card.programs ? `${card.programs} 个程序` : '',
      card.decisions ? `${card.decisions} 个岔路口` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="topo-fold" style="left:${card.x}px;top:${card.y}px;width:${card.w}px;height:${card.h}px">` +
      `<div class="topo-fold-name">${value(card.name)}</div>` +
      `<div class="topo-fold-count">${card.nodeCount} 个方块 · 里面 ${card.innerEdgeCount} 条线</div>` +
      `<div class="text-xs muted">${value(card.chain)}</div>` +
      `<div class="text-xs muted">${value(badges)}</div></div>`;
  }).join('');
  const lines = foldedLayout.edges.map((edge) => {
    const categoryClass = edge.category === 'pass_or_skip' ? 'is-ok' :
      edge.category === 'reject_or_halt' ? 'is-back' : 'is-main';
    const trustClass = edge.confidence === 'certain' ? '' : ` is-${edge.confidence}`;
    return `<path class="topo-edge ${categoryClass}${trustClass}" d="${esc(edge.d)}"/>` +
      `<text class="topo-elabel" x="${edge.labelX}" y="${edge.labelY}">${value(edge.label)}</text>`;
  }).join('');
  const innerCount = summary.cards.reduce((sum, card) => sum + card.innerEdgeKeys.length, 0);
  const stage = `<div class="topo-wrap"><div class="topo-stage" style="width:${foldedLayout.stage.w}px;` +
    `height:${foldedLayout.stage.h}px"><svg class="topo-edges" viewBox="0 0 ${foldedLayout.stage.w} ` +
    `${foldedLayout.stage.h}" aria-hidden="true">${lines}</svg>${cards}</div></div>`;
  return `<section id="view-folded" class="view"><div class="app-bar"><button class="btn btn-ghost btn-sm"` +
    ` data-back>${esc(WORDS.labels.back)}</button>` +
    `<span class="topo-crumb">${esc(WORDS.labels.overview)} · ` +
    `<span class="topo-crumb-now">${esc(WORDS.labels.folded)}</span></span><span class="grow"></span>` +
    `<button class="btn btn-outline btn-sm" data-expand>${esc(WORDS.labels.expand)}</button></div>` +
    `<div class="screen">${stage}` +
    `<p class="text-xs muted">收起来只是不显示堆里面那 ${innerCount} 条线，` +
    `一个方块一条线都没少</p></div></section>`;
}

/** 将拓扑数据、布局和富化结果渲染成单文件离线 HTML。 */
export function renderHtml({ data, layout: pageLayout, enriched = {} }) {
  const payload = {
    ...data,
    checklist: enriched.checklist || [],
    prompts: [...(enriched.prompts || new Map()).entries()],
  };
  const json = JSON.stringify(payload).replace(/<\/script/gi, '<\\/script');
  const details = (data.nodes || []).map((node) => detail(data, node, enriched)).join('');
  const edgeDetails = (data.edges || []).map((edge) => edgeDetail(edge)).join('');
  const body = `<div class="topo-views">${overview(payload, pageLayout, enriched.staleness)}` +
    `<section id="view-node-detail" class="view"><div class="app-bar"><button class="btn btn-ghost btn-sm"` +
    ` data-back>${esc(WORDS.labels.back)}</button><span class="topo-crumb">` +
    `${esc(WORDS.labels.overview)} · <span class="topo-crumb-now">${esc(WORDS.labels.detail)}</span></span></div>` +
    `<div class="screen">${details}${edgeDetails}</div></section>` +
    `${folded(data)}</div>`;
  return SHELL.replace('<!--SLOT:STYLE-->', `${THEME}\n${COMPONENTS}\n${TOPO}`)
    .replace('<!--SLOT:DATA-->', json).replace('<!--SLOT:BODY-->', body).replace('<!--SLOT:SCRIPT-->', APP);
}
