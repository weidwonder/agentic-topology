/**
 * 诊断码 → 允许的修复手段，一张显式对照表。
 *
 * 为什么要有这张表：`supportedFixes` 是喂给 Agent 自己改描述文件用的，
 * 它 MUST 来自一处集中登记，MUST NOT 在校验器各个报错点就地手写自由文本，
 * 也 MUST NOT 靠拿 message 做关键词匹配去反推该给哪些修复手段——
 * 后一种做法换一句 message 就会静默失配，是这个仓库明确禁止的启发式。
 * 把对照表放在校验逻辑之外，改一条修复建议只用改这一处，且改的是谁都看得出来的数据，不是散落各处的字符串。
 *
 * 表里没登记的码，`fixesFor` 给空数组——不兜底、不瞎猜，逼着这张表本身保持诚实。
 */

const FIXES = {
  E_REQUIRED: ['补上这个必填字段'],
  E_TYPE: ['把值改成这个字段要求的类型或格式'],
  E_ENUM: ['把值改成 evidence.allowed 里列出的取值之一'],
  E_CONDITIONAL_REQUIRED: ['按 evidence.trigger 里写的触发条件，补上这个联动必填字段'],
  E_UNKNOWN_FIELD: ['删掉这个不支持的字段，或改成 schema 里已有的字段名'],
  E_SCHEMA_VERSION: ['把 schema_version 改成 1'],
  E_DANGLING_EDGE: ['把值改成 evidence.knownIds 里已存在的节点 id'],
  E_DANGLING_GROUP: ['把 group 改成 groups 里已存在的分组 id，或整个删掉这个字段'],
  E_DANGLING_SUBAGENT: ['把 subagents[].node 改成 nodes 里已存在的节点 id'],
  E_DANGLING_INFO: ['把引用改成 information 里已存在的信息 id'],
  E_DUP_ID: ['把 id 改成一个不与已有条目重复的值'],
  E_DUP_INFO_NAME: ['把信息的 name 改成一个不与已有信息重名的名字'],
  E_SELF_SAME_AS: ['把 same_as 改成指向另一份信息的 id，不能指向自己'],
  E_SELF_LOOP: ['把 to 改成另一个节点的 id，或删掉这条自环边'],
  E_BIDIRECTIONAL: ['删掉这个字段，把这条边拆成两条各自单向的边'],
  E_DUPLICATE_EDGE: ['把两条同向边合并成一条，用多个 payloads 表达差异'],
  E_DUPLICATE_INFO_REF: ['去掉这条线上重复的信息引用，一条线一份信息只引用一次'],
  E_ORPHAN_INFO: ['给这份信息补一条引用它的边（payloads 里加一条），或者把这份信息从 information 里删掉'],
  E_PROMPT_FORM: ['把 system_prompt 改成只给 inline 或只给 file，二选一'],
  E_PROMPT_RANGE: ['把 from/to 改成 from ≥ 1 且 to ≥ from 的合法行区间'],
  W_NO_SCREENING: ['补上 screening，写清收下这条线之前要满足什么条件；不需要筛查就留白说明为什么'],
  W_NO_GROUP: ['给这个节点补上 group，指向 groups 里的一个分组；确实不属于任何分组就明确留空而不是漏填'],
};

/** 查一个诊断码允许的修复手段；没登记的码给空数组，不兜底、不瞎猜。 */
export function fixesFor(code) {
  return FIXES[code] ? [...FIXES[code]] : [];
}
