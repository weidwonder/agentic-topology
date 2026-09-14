import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutFolded, EDGE_LABEL } from './layout.mjs';
import { applyFilter, foldSummary } from './interactions.mjs';
import { FORM_MARK, LABEL_GAP } from './marks.mjs';
import { renderMarkdown } from './markdown.mjs';

const ASSET_DIR = fileURLToPath(new URL('../../assets/page-shell/', import.meta.url));
const SHELL = readFileSync(`${ASSET_DIR}/shell.html`, 'utf8');
const THEME = readFileSync(`${ASSET_DIR}/theme.css`, 'utf8');
const COMPONENTS = readFileSync(`${ASSET_DIR}/components.css`, 'utf8');
const TOPO = readFileSync(`${ASSET_DIR}/topo.css`, 'utf8');
const APP = readFileSync(`${ASSET_DIR}/app.js`, 'utf8').replace(
  '/*SLOT:APPLY_FILTER*/',
  applyFilter.toString(),
);

/**
 * 界面文案的唯一出处，按语言分两套。
 *
 * 描述文件里的正文（方块名、职责、信息说明……）**MUST NOT 翻译**——那是被分析项目
 * 自己的话，翻了就不是事实了。这里只管框架文案。
 *
 * 要插值的句子写成函数：中文「4 个方块」与英文「4 blocks」不只是换词，
 * 量词位置和单复数都不一样，用 `${n} ${WORDS.block}` 拼是拼不对的。
 */
const WORDS_ZH = {
  topology: {
    peer_loop: '大家轮着来',
    manager_worker: '一个总管派活',
    decentralized_handoff: '各自往下传',
    fixed_workflow: '一条固定流水线',
  },
  context: { full: '全都看得见', isolated: '各看各的', mixed: '一部分看得见' },
  kind: { agent: 'AI', program: '程序', decision: '岔路口' },
  exitKind: { normal: '正常收尾', abnormal: '出岔子', cancelled: '被叫停' },
  confidence: {
    certain: '已落地（查实）', inferred: '推测（只是猜的）', unread: '缺失（没查出来）', design: '设计中',
  },
  category: {
    normal: '正常往下走',
    pass_or_skip: '通过或跳过',
    reject_or_halt: '打回或叫停',
  },
  carrier: {
    file: '文件', bundle: '一份打包好的数据', prompt: '提示词', event: '事件', other: '别的',
    interface: '一个对外接口',
  },
  labels: {
    overview: '编排全貌', back: '回上一层', what: '干什么', inputs: '收到什么',
    outputs: '交出什么', purpose: '它夹在中间是为了解决什么', group: '属于哪一堆',
    concurrency: '同时跑几个', source: '从哪查到的', prompt: '它的提示词写在哪',
    abilities: '它能用哪些能力', spawn: '它会不会派别人干活', stop: '它什么时候会停下',
    links: '它跟谁连着', tools: '自带的工具', mcp: '外挂的能力（MCP）',
    skills: '装的技能（Skill）', none: '一个都没有', notSet: '没设',
    checklist: '这几处得你自己去核实', notFilled: '未填写',
    start: '从哪开始', end: '在哪结束', folded: '收起来看', expand: '全部展开', detail: '详情',
    close: '关闭', saveLayout: '把位置存回这个文件', resetLayout: '恢复自动摆放', nodeState: '方块情况',
    dragHint: '方块和分组都能拖；拖完点「把位置存回这个文件」，下次打开还是这个样子',
    concurrent: '同时干', items: '件', fan: '会派别人', noFan: '不会派别人',
    spawnYes: '会派别人干活', spawnNo: '不会派别人干活', in: '进', out: '出',
    line: '第', confirmed: '查证', inCount: '条进来', outCount: '条出去',
    foldedHint: '收起来只是不显示堆里面的线，一个方块一条线都没少',
    edgeCategory: '这是条什么线', trigger: '什么情况下走', carrier: '靠什么交过去',
    confirmedTime: '查证时间',
    screening: '收下之前先查什么', concurrencyControl: '同时来了好几份怎么办',
    payload: '这条线上传的信息', producedAt: '什么时候造出来的',
    deliveredAt: '什么时候交出去的',
    infoWhat: '这是什么', infoBlocks: '里面大致有什么', infoForm: '它本身是什么形态',
    infoOrigin: '从哪来', infoDestination: '到哪去', infoSameAs: '可能与哪份是同一份',
    infoList: '这张图里流转的信息', infoCount: '份', infoNameCol: '叫什么',
    infoEmpty: '这张图里还没有流转的信息', seeAllInfo: '看全部',
    edgesCarrying: '条线传它', infoFlow: '从哪来到哪去', infoLines: '流经哪几条线',
    backToCanvas: '回到图上', clearLit: '取消高亮',
    kindFilter: 'AI 还是程序', groupFilter: '分堆', noGroup: '没有分堆',
    incomplete: '还没分析完，这张图不全',
    emptyTitle: '还没有可画的东西', emptyHint: '打开写好的描述，填入方块和连线后再出图。',
    unreadable: '无法读取', savedOk: '位置已经写回文件了',
    saveFallback: '这个浏览器不支持直接写回文件，已经下载了一份带位置的新文件，覆盖原文件即可',
    limits: {
      steps: '走多少步', time: '花多长时间', cost: '花钱', consecutive_failures: '连着失败几次',
    },
  },
  phrases: {
    nodeCount: (n) => `${n} 个方块`,
    edgeCount: (n) => `${n} 条连线`,
    checkCount: (n) => `${n} 处`,
    confirmedAt: (date) => `查证时间 ${date}`,
    lineRange: (from, to) => `第 ${from}–${to} 行`,
    unreadableRange: (from, to, reason) => `读不到这个文件的第 ${from}–${to} 行：${reason}`,
    abilityCount: (tools, mcp, skills) => `工具 ${tools} · MCP ${mcp} · Skill ${skills}`,
    stale: (reason) => `这张图可能已经过期：${reason}`,
    foldCard: (nodes, inner) => `${nodes} 个方块 · 里面 ${inner} 条线`,
    foldKinds: (agents, programs, decisions) => [
      agents ? `${agents} 个 AI` : '', programs ? `${programs} 个程序` : '',
      decisions ? `${decisions} 个岔路口` : '',
    ].filter(Boolean).join(' · '),
    foldedHint: (inner) => `收起来只是不显示堆里面那 ${inner} 条线，一个方块一条线都没少`,
    carryingCount: (n) => `${n} 条线传它`,
    seeAll: (n) => `看全部 ${n} 份`,
    infoTotal: (n) => `${n} 份`,
  },
};

const WORDS_EN = {
  topology: {
    peer_loop: 'everyone takes turns',
    manager_worker: 'one manager hands out the work',
    decentralized_handoff: 'each one passes it along',
    fixed_workflow: 'one fixed assembly line',
  },
  context: { full: 'everyone sees everything', isolated: 'each sees only its own', mixed: 'some of it is shared' },
  kind: { agent: 'AI', program: 'program', decision: 'fork in the road' },
  exitKind: { normal: 'finished normally', abnormal: 'went wrong', cancelled: 'called off' },
  confidence: {
    certain: 'in place (checked)', inferred: 'a guess (not verified)',
    unread: 'missing (could not find out)', design: 'still on paper',
  },
  category: {
    normal: 'carries on',
    pass_or_skip: 'passed or skipped',
    reject_or_halt: 'sent back or stopped',
  },
  carrier: {
    file: 'a file', bundle: 'a packed-up set of data', prompt: 'a prompt', event: 'an event',
    other: 'something else', interface: 'an interface others call',
  },
  labels: {
    overview: 'the whole picture', back: 'back up one level', what: 'what it does',
    inputs: 'what it gets', outputs: 'what it hands over',
    purpose: 'why it sits in the middle', group: 'which pile it is in',
    concurrency: 'how many run at once', source: 'where this was found',
    prompt: 'where its prompt is written',
    abilities: 'what it is allowed to use', spawn: 'whether it hands work to others',
    stop: 'when it stops', links: 'what it is connected to', tools: 'built-in tools',
    mcp: 'plugged-in abilities (MCP)', skills: 'installed skills', none: 'none at all',
    notSet: 'not set',
    checklist: 'you need to check these yourself', notFilled: 'not filled in',
    start: 'where it starts', end: 'where it ends', folded: 'fold it up', expand: 'open it all up',
    detail: 'details', close: 'close', saveLayout: 'save these positions back into this file',
    resetLayout: 'put them back where they were', nodeState: 'how sure we are',
    dragHint: 'blocks and piles can be dragged; when you are done click'
      + ' "save these positions back into this file" and it will look the same next time',
    concurrent: 'runs', items: 'at a time', fan: 'hands work to others',
    noFan: 'does not hand work to others',
    spawnYes: 'hands work to others', spawnNo: 'does not hand work to others', in: 'in', out: 'out',
    line: 'lines', confirmed: 'checked', inCount: 'coming in', outCount: 'going out',
    foldedHint: 'folding only hides the lines inside a pile; nothing is left out',
    edgeCategory: 'what kind of line this is', trigger: 'when this line is taken',
    carrier: 'how it is handed over', confirmedTime: 'checked on',
    screening: 'what gets checked before it is accepted',
    concurrencyControl: 'what happens when several arrive at once',
    payload: 'what this line carries', producedAt: 'when it was made',
    deliveredAt: 'when it is handed over',
    infoWhat: 'what it is', infoBlocks: 'roughly what is inside', infoForm: 'what form it takes',
    infoOrigin: 'where it comes from', infoDestination: 'where it ends up',
    infoSameAs: 'might be the same as',
    infoList: 'what moves around in this picture', infoCount: 'pieces', infoNameCol: 'name',
    infoEmpty: 'nothing moves around in this picture yet', seeAllInfo: 'see all',
    edgesCarrying: 'lines carry it', infoFlow: 'from where to where',
    infoLines: 'which lines carry it',
    backToCanvas: 'back to the picture', clearLit: 'stop highlighting',
    kindFilter: 'AI or program', groupFilter: 'piles', noGroup: 'no piles',
    incomplete: 'not finished reading yet — this picture is incomplete',
    emptyTitle: 'nothing to draw yet',
    emptyHint: 'open a written description, fill in blocks and lines, then draw it again.',
    unreadable: 'could not read it', savedOk: 'the positions are back in the file',
    saveFallback: 'this browser cannot write the file directly; a new file with the positions'
      + ' has been downloaded — replace the original with it',
    limits: {
      steps: 'how many steps', time: 'how long', cost: 'how much it costs',
      consecutive_failures: 'how many failures in a row',
    },
  },
  phrases: {
    nodeCount: (n) => `${n} block${n === 1 ? '' : 's'}`,
    edgeCount: (n) => `${n} line${n === 1 ? '' : 's'}`,
    checkCount: (n) => `${n} spot${n === 1 ? '' : 's'}`,
    confirmedAt: (date) => `checked on ${date}`,
    lineRange: (from, to) => `lines ${from}–${to}`,
    unreadableRange: (from, to, reason) => `cannot read lines ${from}–${to} of this file: ${reason}`,
    abilityCount: (tools, mcp, skills) =>
      `${tools} tool${tools === 1 ? '' : 's'} · ${mcp} MCP · ${skills} skill${skills === 1 ? '' : 's'}`,
    stale: (reason) => `this picture may be out of date: ${reason}`,
    foldCard: (nodes, inner) => `${nodes} block${nodes === 1 ? '' : 's'} · `
      + `${inner} line${inner === 1 ? '' : 's'} inside`,
    foldKinds: (agents, programs, decisions) => [
      agents ? `${agents} AI` : '', programs ? `${programs} program${programs === 1 ? '' : 's'}` : '',
      decisions ? `${decisions} fork${decisions === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' · '),
    foldedHint: (inner) => `folding only hides the ${inner} line${inner === 1 ? '' : 's'} inside the piles;`
      + ' nothing is left out',
    carryingCount: (n) => `${n} line${n === 1 ? '' : 's'} carry it`,
    seeAll: (n) => `see all ${n}`,
    infoTotal: (n) => `${n} piece${n === 1 ? '' : 's'}`,
  },
};

export const LANGS = { zh: WORDS_ZH, en: WORDS_EN };

// 出图是一次性的 CLI 进程，一次只出一张图、一种语言，所以文案表用模块级变量切换，
// 不必把 lang 穿过每一个渲染函数。renderHtml 是唯一的写入点。
let WORDS = WORDS_ZH;

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
  return value(item, WORDS.labels.notFilled);
}

const FLAG_CLASS = {
  certain: 'is-sure', inferred: 'is-guess', unread: 'is-unknown', design: 'is-design',
};

// 卡片顶栏就那么宽，「推测（只是猜的）」这种全称会把徽章挤成两行、顶掉正文的位置。
// 卡片上只写括号前那半截，全称留给筛选器和详情弹层——两处说的是同一件事，MUST 保持同源。
// 方块上那枚小徽章只放得下短的一半，括号里的解释挪进 title。
// MUST 按当前语言现算：模块加载时算一次会把中文那套焊死在英文页面上。
function shortConfidence(key) {
  return String(WORDS.confidence[key] ?? key).replace(/[（(][^）)]*[）)]\s*$/, '').trim();
}

function flag(confidence, short = false) {
  const cls = FLAG_CLASS[confidence] || 'is-unknown';
  const text = short ? shortConfidence(confidence) : (WORDS.confidence[confidence] || confidence);
  return `<span class="topo-flag ${cls}" title="${esc(WORDS.confidence[confidence] || confidence)}">` +
    `${value(text)}</span>`;
}

/** 正文字段一律走 Markdown：描述里常有分段、列表、行内代码，纯文本会糊成一坨。 */
function prose(text, fallback = WORDS.labels.notSet) {
  const raw = text === undefined || text === null || text === '' || text === 'not_set'
    ? (text === 'not_set' ? WORDS.labels.notSet : fallback)
    : text;
  return `<div class="topo-md">${renderMarkdown(String(raw))}</div>`;
}

/** 某个对象名下的核实条目收成一枚角标，鼠标停上去看全文。方块与信息清单共用。 */
function warnBadge(checklist, ref) {
  const mine = (checklist || []).filter((item) => item.ref === ref);
  if (!mine.length) return '';
  return `<span class="topo-warn" title="${esc(mine.map((item) => item.text).join('\n'))}"` +
    ` aria-label="${esc(WORDS.labels.checklist)}">⚠ ${mine.length}</span>`;
}

function nodeHtml(node, box, checklist = []) {
  const confidence = node.confidence || 'unread';
  // 底色只表示「这是 AI 还是程序还是岔路口」，可信度改用虚线边框 + 徽章表示。
  // 两个维度都塞进底色的话，一份全是「推测」的设计稿会整张图一个颜色，等于没分类。
  const kindClass = { agent: 'is-agent', program: 'is-program', decision: 'is-decision' }[node.kind] || '';
  const classes = ['topo-node', kindClass, confidence === 'certain' ? '' : 'is-unsure'];
  const marks = [];
  if (Number(node.concurrency?.default) > 1) {
    marks.push(`<span class="topo-mark is-conc">${WORDS.labels.concurrent} ` +
      `${value(node.concurrency.default)} ${WORDS.labels.items}</span>`);
  }
  if (node.spawns_subagents === true) {
    marks.push(`<span class="topo-mark is-fan">${WORDS.labels.fan}</span>`);
  }
  const labels = WORDS.kind;
  // 核对清单不再单列一块：本节点该核实的条目收成右上角一枚角标，鼠标停上去就看得到。
  const warn = warnBadge(checklist, node.id);
  const top = `<div class="topo-node-top"><span class="topo-node-kind">${value(labels[node.kind])}</span>` +
    `<span class="topo-node-id">${value(node.id)}</span>${flag(confidence, true)}${warn}</div>`;
  // data-x / data-y 留着「恢复自动摆放」时用：拖过之后要能退回程序算出来的原位。
  const head = `<div class="${classes.filter(Boolean).join(' ')}" data-node-id="${value(node.id)}"` +
    ` data-goto="${value(node.id)}" data-group="${value(node.group, '')}"` +
    ` data-x="${box.x}" data-y="${box.y}"` +
    // 用 min-height 而不是 height：高度是程序按字数估出来的，卡片正文又走 Markdown（列表、分段都会
    // 多占几行），估少了就又会溢出到别的元素上。min-height 让浏览器按真实内容兜底，宁可比连线锚点
    // 略高一点，也 MUST NOT 让文字漏出卡片。
    ` style="left:${box.x}px;top:${box.y}px;width:${box.w}px;min-height:${box.h}px">`;
  return `${head}${top}<div class="topo-node-name">${value(node.name)}</div>` +
    `<div class="topo-node-desc">${prose(node.responsibility)}</div>` +
    (marks.length ? `<div class="topo-marks">${marks.join('')}</div>` : '') + '</div>';
}

function overview(data, pageLayout, staleness) {
  const frames = [...pageLayout.groups.entries()].map(([groupId, group]) =>
    `<div class="topo-frame" data-group-id="${value(groupId)}" data-x="${group.x}" data-y="${group.y}"` +
    ` data-w="${group.w}" data-h="${group.h}"` +
    ` style="left:${group.x}px;top:${group.y}px;width:${group.w}px;height:${group.h}px">` +
    `<span class="topo-frame-label">${value(group.name)}</span></div>`).join('');
  const edges = pageLayout.edges.map((edge) => {
    const cls = edge.category === 'pass_or_skip' ? 'is-ok' :
      edge.category === 'reject_or_halt' ? 'is-back' : 'is-main';
    const trust = edge.confidence === 'certain' ? '' : ` is-${edge.confidence}`;
    const edgeId = `${edge.from}->${edge.to}`;
    // 连线的核实条目挂在加宽的点击区上：SVG 里 <title> 就是原生悬浮提示，不用另写脚本。
    const mine = (data.checklist || []).filter((item) => item.ref === edgeId);
    const tip = mine.length
      ? `<title>${esc(mine.map((item) => item.text).join('\n'))}</title>` : '';
    return `<path class="topo-edge ${cls}${trust}" data-edge-id="${value(edgeId)}"` +
      ` d="${esc(edge.d)}" marker-end="url(#ah-${cls.slice(3)})"/>` +
      `<path class="topo-edge-hit" data-edge-id="${value(edgeId)}" d="${esc(edge.d)}">${tip}</path>` +
      // data-label-for 只用来定位：拖动之后 app.js 靠它找到这行字、跟着线一起挪。
      // MUST NOT 改回 data-edge-id——点击派发按那个属性认「连线浮层的入口」，
      // 而这行字现在是信息高亮的触发点，一次点击不能同时干两件事。
      `<text class="topo-elabel" data-label-for="${value(edgeId)}"` +
      ` x="${edge.labelX}" y="${edge.labelY}">` +
      `${(edge.labelParts || [{ info: null, text: edge.label }]).map((part, index) =>
        `${index ? esc(LABEL_GAP) : ''}<tspan${part.info
          ? ` class="topo-elabel-name" data-info-id="${value(part.info)}"` : ''}>` +
        `${value(part.text)}</tspan>`).join('')}</text>`;
  }).join('');
  const checklist = data.checklist || [];
  const nodes = [...pageLayout.nodes.entries()].map(([id, box]) =>
    nodeHtml(data.nodes.find((node) => node.id === id), box, checklist)).join('');
  // 「在哪结束」与「从哪开始」同一套渲染：一个小标题 + Markdown 正文，两块看起来 MUST 一致。
  const exits = (data.graph?.exits || []).map((exit) =>
    `<div class="topo-exit"><div class="topo-exit-name">${value(exit.name)}` +
    `<span class="topo-exit-kind">${value(WORDS.exitKind[exit.kind] || exit.kind, '')}</span></div>` +
    `${prose(exit.condition)}</div>`).join('');
  const incompleteNotice = data.analysis_complete === false
    ? `<div class="alert alert-warning">${esc(WORDS.labels.incomplete)}</div>` : '';
  const staleNotice = staleness?.stale
    ? `<div class="alert alert-warning">${esc(WORDS.phrases.stale(String(staleness.reason ?? '')))}</div>`
    : '';
  const emptyNotice = (data.nodes || []).length === 0
    ? `<div class="alert"><strong>${esc(WORDS.labels.emptyTitle)}</strong>` +
      `<span class="text-sm muted">${esc(WORDS.labels.emptyHint)}</span></div>` : '';
  const marker = (id, color) => `<marker id="${id}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">` +
    `<path d="M0,0 L6,3 L0,6 z" fill="${color}"/></marker>`;
  const markers = `<defs>${marker('ah-main', 'var(--primary)')}${marker('ah-ok', 'var(--success)')}` +
    `${marker('ah-back', 'var(--destructive)')}</defs>`;
  const head = `<section id="view-overview" class="view"><div class="app-bar">` +
    `<span class="topo-title">${value(data.source_project, WORDS.labels.overview)}</span>` +
    `<span class="topo-crumb">${WORDS.labels.overview}</span><span class="grow"></span>` +
    `<button class="btn btn-outline btn-sm" data-goto-folded>${esc(WORDS.labels.folded)}</button>` +
    `</div><div class="screen">` +
    `<div class="row"><span class="badge badge-secondary">${value(WORDS.topology[data.graph?.topology])}</span>` +
    `<span class="badge badge-outline">${value(WORDS.context[data.graph?.context_sharing])}</span>` +
    `<span class="topo-flag is-sure">${esc(WORDS.phrases.nodeCount((data.nodes || []).length))}</span>` +
    `<span class="topo-flag is-sure">${esc(WORDS.phrases.edgeCount((data.edges || []).length))}</span>` +
    `<span class="topo-flag is-sure">${esc(WORDS.labels.checklist)} ` +
    `${esc(WORDS.phrases.checkCount(data.checklist?.length || 0))}</span>` +
    `<span class="text-xs muted">${esc(WORDS.phrases.confirmedAt(String(data.generated_at ?? '')))}</span>` +
    `</div>` +
    incompleteNotice + staleNotice + emptyNotice +
    filterControls(data) +
    `<div class="topo-legend"><span class="topo-legend-item"><span class="topo-swatch"></span>` +
    `${esc(WORDS.category.normal)}</span>` +
    `<span class="topo-legend-item"><span class="topo-swatch is-ok"></span>${esc(WORDS.category.pass_or_skip)}</span>` +
    `<span class="topo-legend-item"><span class="topo-swatch is-back"></span>` +
    `${esc(WORDS.category.reject_or_halt)}</span></div>`;
  // 发起标记以前是 .topo-stage 内部绝对定位在 (0,0) 的一枚小胶囊，隐含假设 entry 只有一行。
  // entry 一旦是几百字的长段落（真实项目常见），它会盖住第一行的分组框与节点——这不是布局算法的锅，
  // 它压根没被算进 layout.mjs 的坐标系。改成图前面的正常文档流整条色块，让浏览器按实际内容自己撑高度，
  // 不用再猜一个像素数字；正文走 Markdown，因为 entry 常写成带小标题与列表的一段说明。
  const pill = `<div class="topo-pill"><div class="topo-pill-head">${esc(WORDS.labels.start)}</div>` +
    `<div class="topo-md">${renderMarkdown(data.graph?.entry)}</div></div>`;
  // 高亮状态栏：亮着的时候才显示，说清亮的是哪一份、它是什么、流经几条线，
  // 并给一个不用去猜的退出按钮。
  const infoBar = '<div class="topo-infobar" data-infobar></div>';
  const canvasBar = `<div class="topo-canvas-bar" data-canvas-bar data-dirty="0">` +
    `<button class="btn btn-outline btn-sm" data-save-layout>${esc(WORDS.labels.saveLayout)}</button>` +
    `<button class="btn btn-ghost btn-sm" data-reset-layout>${esc(WORDS.labels.resetLayout)}</button>` +
    `<span class="topo-canvas-hint" data-canvas-hint>${esc(WORDS.labels.dragHint)}</span></div>`;
  // 发起说明与收尾说明 MUST 都待在画布外面：它们是这张图的前言和后记，不是图上的元素。
  const diagram = `${pill}${infoBar}<div class="topo-wrap">${canvasBar}` +
    `<div class="topo-stage" style="width:${pageLayout.stage.w}px;` +
    `height:${pageLayout.stage.h}px"><svg class="topo-edges"` +
    ` viewBox="0 0 ${pageLayout.stage.w} ${pageLayout.stage.h}"` +
    ` aria-hidden="true">${markers}${edges}</svg>${frames}${nodes}</div></div>`;
  // 收尾块与发起块共用 .topo-pill 这一套外观，两头 MUST 看起来是一对。
  const ending = `${infoCard(data)}<div class="topo-pill"><div class="topo-pill-head">` +
    `${esc(WORDS.labels.end)}</div>${exits}</div></div></section>`;
  // 核对清单不再单开一块：条目已经挂到各自的方块与连线上（右上角角标 / 线上的悬浮提示），
  // 顶部只留一个总数，省得同一份信息在页面上出现两遍。
  return `${head}${diagram}${ending}`;
}

function filterControls(data) {
  const checkbox = (dimension, key, label) => `<label class="topo-filter-option">` +
    `<input type="checkbox" data-filter-dimension="${esc(dimension)}" value="${esc(key)}">` +
    `<span>${value(label)}</span></label>`;
  const confidence = Object.entries(WORDS.confidence)
    .map(([key, label]) => checkbox('confidence', key, label)).join('');
  const kinds = Object.entries(WORDS.kind).map(([key, label]) => checkbox('kind', key, label)).join('');
  const groups = (data.groups || []).map((group) => checkbox('group', group.id, group.name)).join('');
  return `<div class="topo-filters"><fieldset><legend>${esc(WORDS.labels.nodeState)}</legend>` +
    `${confidence}</fieldset>` +
    `<fieldset><legend>${esc(WORDS.labels.kindFilter)}</legend>${kinds}</fieldset>` +
    `<fieldset><legend>${esc(WORDS.labels.groupFilter)}</legend>` +
    `${groups || `<span class="muted text-xs">${esc(WORDS.labels.noGroup)}</span>`}</fieldset></div>`;
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
      `${esc(WORDS.phrases.lineRange(from, to))}</span></div>` +
      `<div class="topo-src-body"><span class="text-sm muted">` +
      `${esc(WORDS.phrases.unreadableRange(from, to, source.reason || WORDS.labels.unreadable))}` +
      `</span></div></div>`;
  } else if (file) {
    const lines = Array.isArray(source.lines) ? source.lines : [];
    const renderedLines = lines.map((line, index) => `<div class="topo-line is-hit">` +
      `<span>${Number(from) + index}</span><span class="mono">${value(line)}</span></div>`).join('');
    body = `<div class="topo-src"><div class="topo-src-head"><span class="mono">${value(file)} ` +
      `${esc(WORDS.phrases.lineRange(from, to))}</span></div>` +
      `<div class="topo-src-body">${renderedLines}</div></div>`;
  }
  const mark = file
    ? esc(WORDS.phrases.lineRange(from, to))
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
    `<span class="topo-acc-mark">${esc(WORDS.phrases.abilityCount(node.tools?.length || 0,
      node.mcp?.length || 0, node.skills?.length || 0))}</span></summary>` +
    `<div class="topo-acc-body"><div class="stack-sm">${section(WORDS.labels.tools, node.tools)}` +
    `<div class="separator"></div>` +
    `${section(WORDS.labels.mcp, node.mcp)}<div class="separator"></div>` +
    `${section(WORDS.labels.skills, node.skills)}</div></div></details>`;
}

function stopSection(node) {
  if (node.kind !== 'agent') return '';
  const conditions = (node.stop?.conditions || []).map((condition) =>
    `<li class="list-item">${prose(condition)}</li>`).join('');
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
    // 与线上同一套说法：这条线传的是哪几份信息。
    const infoById = new Map((data.information || []).map((info) => [info.id, info]));
    const payloads = (edge.payloads || [])
      .map((payload) => value(infoById.get(payload.info)?.name || payload.info)).join('、');
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
    kv(WORDS.labels.what, prose(node.responsibility)),
    kv(WORDS.labels.inputs, prose(node.inputs)),
    kv(WORDS.labels.outputs, prose(node.outputs)),
  ];
  if (node.kind !== 'agent') rows.push(kv(WORDS.labels.purpose, prose(node.purpose)));
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
    `${node.spawns_subagents ? WORDS.labels.fan : WORDS.labels.noFan}</span></summary>` +
    `<div class="topo-acc-body"><div class="stack-sm"><div class="text-sm">` +
    `${esc(node.spawns_subagents ? WORDS.labels.spawnYes : WORDS.labels.spawnNo)}</div>` +
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

function edgeDetail(edge, infoIndex) {
  const edgeKey = `${edge.from}->${edge.to}`;
  const source = `<span class="mono text-xs">${value(edge.source?.refs?.join(' · '))}` +
    ` · ${esc(WORDS.labels.confirmedTime)}：${value(edge.source?.confirmed_at)}</span>`;
  const rows = [
    kv(WORDS.labels.edgeCategory, value(WORDS.category[edge.category] || edge.category)),
    kv(WORDS.labels.trigger, prose(edge.trigger)),
  ];
  if (edge.screening !== undefined) rows.push(kv(WORDS.labels.screening, prose(edge.screening)));
  rows.push(kv(WORDS.labels.concurrencyControl, prose(edge.concurrency_control)));
  rows.push(kv(WORDS.labels.source, source));
  const payloads = (edge.payloads || []).map((payload) => {
    const info = infoIndex.get(payload.info) || {};
    const blocks = Array.isArray(info.blocks) && info.blocks.length
      ? `<ul class="topo-blocks">${info.blocks.map((b) => `<li>${prose(b)}</li>`).join('')}</ul>`
      : value(undefined);
    const sameAs = info.same_as
      ? kv(WORDS.labels.infoSameAs, value(infoIndex.get(info.same_as)?.name || info.same_as))
      : '';
    return `<div class="topo-payload">` +
      `<div class="topo-payload-head">${flag(info.confidence)}${value(info.name)}</div>` +
      `<dl class="kv">${kv(WORDS.labels.infoWhat, prose(info.what))}` +
      `${kv(WORDS.labels.infoBlocks, blocks)}` +
      `${kv(WORDS.labels.infoForm, value(WORDS.carrier[info.form] || info.form))}` +
      `${kv(WORDS.labels.infoOrigin, value(info.origin))}` +
      `${kv(WORDS.labels.infoDestination, value(info.destination))}` +
      `${sameAs}` +
      `${kv(WORDS.labels.carrier, value(WORDS.carrier[payload.carrier] || payload.carrier))}` +
      `${kv(WORDS.labels.producedAt, value(info.produced_at))}` +
      `${kv(WORDS.labels.deliveredAt, value(payload.delivered_at))}</dl></div>`;
  }).join('');
  const body = `<details class="topo-acc-item" open><summary class="topo-acc-head">` +
    `${esc(WORDS.labels.payload)}<span class="topo-acc-mark">${(edge.payloads || []).length}</span>` +
    `</summary><div class="topo-acc-body">${payloads}</div></details>`;
  return `<section id="detail-edge-${value(edgeKey)}" class="topo-detail topo-edge-detail"`
    + ` data-edge-detail="${esc(edge.from)}->${esc(edge.to)}">` +
    `<div class="topo-edge-detail-title"><span class="mono">${value(edge.from)} → ${value(edge.to)}</span></div>` +
    `<div class="topo-acc"><details class="topo-acc-item" open><summary class="topo-acc-head">` +
    `${esc(WORDS.labels.trigger)}</summary><div class="topo-acc-body"><dl class="kv">${rows.join('')}</dl>` +
    `</div></details>${body}</div></section>`;
}


/** 一份信息流经哪几条线：按引用它的边算，图上与清单里说的 MUST 是同一个数。 */
function edgesCarrying(data, infoId) {
  return (data.edges || []).filter((edge) =>
    (edge.payloads || []).some((payload) => payload.info === infoId));
}

/** 信息名上的可信度标记：MUST NOT 占用连线的虚实通道，所以走文字后缀 + 徽章。 */
function infoName(item) {
  return `<span class="topo-info-name" data-info-id="${value(item.id)}" role="button" tabindex="0">` +
    `${value(FORM_MARK[item.form] || FORM_MARK.other)} ${value(item.name)}` +
    `${item.confidence === 'certain' || item.confidence === undefined ? '' : flag(item.confidence)}</span>`;
}

/** 画布下方的概览卡：只列前 3 份，其余进全量视图。 */
function infoCard(data) {
  const list = data.information || [];
  if (!list.length) {
    return `<div class="topo-pill"><div class="topo-pill-head">${esc(WORDS.labels.infoList)}</div>` +
      `<div class="text-sm muted">${esc(WORDS.labels.infoEmpty)}</div></div>`;
  }
  const rows = list.slice(0, 3).map((item) => {
    const count = edgesCarrying(data, item.id).length;
    return `<li class="topo-info-row">${infoName(item)}` +
      `${warnBadge(data.checklist, item.name || item.id)}` +
      `<span class="text-xs muted grow">${value(item.what)}</span>` +
      `<span class="text-xs muted">${esc(WORDS.phrases.carryingCount(count))}</span></li>`;
  }).join('');
  const more = `<button class="btn btn-outline btn-sm" data-goto-info>` +
    `${esc(WORDS.phrases.seeAll(list.length))}</button>`;
  return `<div class="topo-pill"><div class="topo-pill-head">${esc(WORDS.labels.infoList)}` +
    `<span class="topo-acc-mark">${esc(WORDS.phrases.infoTotal(list.length))}</span></div>` +
    `<ul class="topo-info-list">${rows}</ul>${more}</div>`;
}

/** 全量视图：七列列全。MUST 有自己的返回入口，不能只靠点某一份退出。 */
function infoView(data) {
  const list = data.information || [];
  const head = `<section id="view-info" class="view" hidden><div class="app-bar">` +
    `<button class="btn btn-outline btn-sm" data-back>${esc(WORDS.labels.backToCanvas)}</button>` +
    `<span class="topo-crumb">${esc(WORDS.labels.infoList)}</span><span class="grow"></span>` +
    `<span class="topo-flag is-sure">${esc(WORDS.phrases.infoTotal(list.length))}</span></div>` +
    `<div class="screen">`;
  if (!list.length) {
    return `${head}<div class="alert"><strong>${esc(WORDS.labels.infoEmpty)}</strong></div></div></section>`;
  }
  const rows = list.map((item) => {
    const blocks = Array.isArray(item.blocks) && item.blocks.length
      ? `<ul class="topo-blocks">${item.blocks.map((b) => `<li>${prose(b)}</li>`).join('')}</ul>`
      : value(undefined);
    const carrying = edgesCarrying(data, item.id);
    const lines = carrying.map((edge) => `${value(edge.from)}→${value(edge.to)}`).join('、');
    const same = item.same_as
      ? `<div class="text-xs muted">${esc(WORDS.labels.infoSameAs)}：` +
        `${value(list.find((x) => x.id === item.same_as)?.name || item.same_as)}</div>` : '';
    return `<tr data-info-row="${value(item.id)}">` +
      `<td>${infoName(item)}${warnBadge(data.checklist, item.name || item.id)}${same}</td>` +
      `<td>${prose(item.what)}</td>` +
      `<td>${blocks}</td>` +
      `<td>${value(WORDS.carrier[item.form] || item.form)}</td>` +
      `<td class="mono text-xs">${value(item.origin)} → ${value(item.destination)}</td>` +
      `<td class="text-xs">${esc(WORDS.phrases.carryingCount(carrying.length))}<br>` +
      `<span class="mono muted">${lines}</span></td>` +
      `<td class="mono text-xs">${value(item.source?.refs?.join(' · '))}<br>` +
      `<span class="muted">${value(item.source?.confirmed_at)}</span></td></tr>`;
  }).join('');
  const header = [WORDS.labels.infoNameCol, WORDS.labels.infoWhat, WORDS.labels.infoBlocks,
    WORDS.labels.infoForm, WORDS.labels.infoFlow, WORDS.labels.infoLines, WORDS.labels.source]
    .map((h) => `<th>${esc(h)}</th>`).join('');
  return `${head}<div class="topo-table-wrap"><table class="topo-table">` +
    `<thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
}

function folded(data, warnings, lang) {
  const summary = foldSummary(data);
  const foldedLayout = layoutFolded(data, { lang });
  const cards = [...foldedLayout.cards.values()].map((card) => {
    const badges = WORDS.phrases.foldKinds(card.agents, card.programs, card.decisions);
    return `<div class="topo-fold" style="left:${card.x}px;top:${card.y}px;width:${card.w}px;height:${card.h}px">` +
      `<div class="topo-fold-name">${value(card.name)}</div>` +
      `<div class="topo-fold-count">${esc(WORDS.phrases.foldCard(card.nodeCount,
        card.innerEdgeCount))}</div>` +
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
  for (const warning of foldedLayout.warnings) warnings.push(warning);
  const innerCount = summary.cards.reduce((sum, card) => sum + card.innerEdgeKeys.length, 0);
  const stage = `<div class="topo-wrap"><div class="topo-stage" style="width:${foldedLayout.stage.w}px;` +
    `height:${foldedLayout.stage.h}px"><svg class="topo-edges" viewBox="0 0 ${foldedLayout.stage.w} ` +
    `${foldedLayout.stage.h}" aria-hidden="true">${lines}</svg>${cards}</div></div>`;
  return `<section id="view-folded" class="view" hidden><div class="app-bar"><button class="btn btn-ghost btn-sm"` +
    ` data-back>${esc(WORDS.labels.back)}</button>` +
    `<span class="topo-crumb">${esc(WORDS.labels.overview)} · ` +
    `<span class="topo-crumb-now">${esc(WORDS.labels.folded)}</span></span><span class="grow"></span>` +
    `<button class="btn btn-outline btn-sm" data-expand>${esc(WORDS.labels.expand)}</button></div>` +
    `<div class="screen">${stage}` +
    `<p class="text-xs muted">${esc(WORDS.phrases.foldedHint(innerCount))}</p></div></section>`;
}

/** 将拓扑数据、布局和富化结果渲染成单文件离线 HTML。 */
export function renderHtml({ data, layout: pageLayout, enriched = {}, warnings = [], lang = 'zh' }) {
  // 这里是 WORDS 的唯一写入点，MUST 在任何渲染函数跑起来之前设好。
  WORDS = LANGS[lang] || LANGS.zh;
  const payload = {
    ...data,
    // 拖动之后 app.js 要重新给标注退让，它需要两样东西：退让参数（唯一真相在
    // layout.mjs，MUST NOT 在 app.js 里另写一套）与每条线上那行字占多大。
    // 尺寸优先在浏览器里用 getBBox() 现量，量不到才退回这里出图时估的值。
    labelLayout: {
      // 只注入数字，函数不进 JSON（app.js 那边有自己的同名实现）。
      T_VALUES: EDGE_LABEL.T_VALUES,
      STEP: EDGE_LABEL.STEP,
      STEPS: EDGE_LABEL.STEPS,
      COST_T_WEIGHT: EDGE_LABEL.COST_T_WEIGHT,
      NORMAL_DELTA: EDGE_LABEL.NORMAL_DELTA,
      sizes: Object.fromEntries((pageLayout.edges || [])
        .map((edge) => [`${edge.from}->${edge.to}`, { w: edge.labelW, h: edge.labelH }])),
    },
    checklist: enriched.checklist || [],
    prompts: [...(enriched.prompts || new Map()).entries()],
    // 页面脚本自己要说的那几句话也从这里取——app.js 是原样内联进页面的，
    // 里面写死中文就没法英文化了。
    ui: {
      clearLit: WORDS.labels.clearLit,
      detail: WORDS.labels.detail,
      savedOk: WORDS.labels.savedOk,
      saveFallback: WORDS.labels.saveFallback,
      carrying: Object.fromEntries((data.information || []).map((item) =>
        [item.id, WORDS.phrases.carryingCount(edgesCarrying(data, item.id).length)])),
    },
  };
  const json = JSON.stringify(payload).replace(/<\/script/gi, '<\\/script');
  const details = (data.nodes || []).map((node) => detail(data, node, enriched)).join('');
  const infoIndex = new Map((data.information || []).map((item) => [item.id, item]));
  const edgeDetails = (data.edges || []).map((edge) => edgeDetail(edge, infoIndex)).join('');
  // 详情不再平铺成一条长页面靠滚动定位：全部收进隐藏仓库，点方块或连线时复制进弹层。
  // 折叠视图同理，默认藏起来，由「收起来看」切换——一屏只呈现一件事。
  const modal = `<div class="topo-modal" id="topo-modal" hidden>` +
    `<div class="topo-modal-backdrop" data-modal-close></div>` +
    `<div class="topo-modal-panel" role="dialog" aria-modal="true" aria-labelledby="topo-modal-title">` +
    `<div class="topo-modal-bar"><span class="topo-crumb" id="topo-modal-title">` +
    `${esc(WORDS.labels.detail)}</span>` +
    `<button class="btn btn-ghost btn-sm topo-modal-close" data-modal-close>` +
    `${esc(WORDS.labels.close)}</button></div>` +
    `<div class="topo-modal-body" id="topo-modal-body"></div></div></div>`;
  const body = `<div class="topo-views">${overview(payload, pageLayout, enriched.staleness)}` +
    `${folded(data, warnings, lang)}${infoView(payload)}` +
    `<div id="detail-store" hidden>${details}${edgeDetails}</div>${modal}</div>`;
  return SHELL.replace('<!--SLOT:STYLE-->', `${THEME}\n${COMPONENTS}\n${TOPO}`)
    .replace('<!--SLOT:DATA-->', json).replace('<!--SLOT:BODY-->', body).replace('<!--SLOT:SCRIPT-->', APP);
}
