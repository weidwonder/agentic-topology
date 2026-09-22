# agentic-topology 基准套件

> 本文按 RFC 2119 解释 MUST / MUST NOT / SHOULD / MAY。

## 这套东西解决什么问题

agentic-topology 的上线准出线是：**在 3 个真实项目上，agent 节点与调用边的遗漏 = 0。**

`docs/report/基准项目分析核对.md` 如实记录过三轮实测，结论是**未达标**，欠了三笔账：

1. 已跑的第三个基准项目划范围时把判据要看的那个包排除在外，且本技能自己的一份强制加载文档拿它举过例、写着答案——盲测在设计上就不可能盲，整轮作废；
2. 前两个项目的产物里没有「粒度留账」——"调用边遗漏 = 0"这个口径唯一的防作弊位是"合并进节点内部的传递 MUST 留账"，没有留账，把切法调粗就能刷出假的 0；
3. 从没有任何一轮同时满足"范围正确 + 留账齐全 + 未泄题"。

这三笔账的共同问题是：**我们有一个验收口径，但没有一套让它变成证据的程序。** 光靠人读报告、凭印象判断"这轮算不算数"，账目还是会像上面这样越滚越乱。

本套件就是那套程序：给每个基准项目写一份**机器可核的答案卡**（case），配一套**能把候选描述判出「过 / 没过 / 没跑」的确定性校验器**（`benchmark.mjs`），加一份**写死怎么防作弊、怎么防泄题、什么才算数**的操作手册（就是这份文档）。

参照物是 [github.com/tt-a1i/archify](https://github.com/tt-a1i/archify) 的 `benchmarks/ordinary-model-floor/`——同类问题的同类解法。下文很多机制（语义键 + 等价说法、公平运行协议、attempt 1 冻结、`record-failure`、三闸分记、`evidenceEligible`）都是照它的思路搬过来的，按 agentic-topology 自己的验收口径（节点/边遗漏、粒度留账）重新设计过判据。

## 三道闸

一次 `verify` 对一份候选描述判三道闸，外加一道**不算闸、但能让整次运行直接作废的协议前提**。四者分开记，互不覆盖：

```
协议前提（硬性，不达标就是这次运行本身无效，不出收据）
  └─ 范围闸  scope     ── 候选有没有读到判据必须看的地方（如系统提示词装配处）
  └─ 覆盖闸  coverage  ── 必需的 agent 节点、必需的调用边，遗漏 = 0 吗（含粒度留账兜底）
  └─ 机械校验闸 validate ── 候选这份 .topology.yaml 本身过不过 agentic-topology 自己的 validate.mjs
```

**只有协议前提成立、且三道闸都真的跑过且都 `pass`，这次候选才算 `first_pass_usable`。** 任何一道是 `not_run`（没条件跑）或 `fail`，整次就不算通过——**`not_run`/`skipped` 永远不能升级成 `pass`**，这是抄自 archify 的核心防作弊设计，本套件原样继承。

### 协议前提：公平运行协议

`run.json` 必须带一段 `protocol`，三个布尔字段全部为 `true` 才算数：

| 字段 | 不满足意味着什么 |
|---|---|
| `benchmarks_dir_excluded` | 跑分时 `benchmarks/` 整个目录进入了被测 Agent 可见的工作树——防泄题协议本身被破坏 |
| `harness_outside_worktree` | harness / cases / prompts / 参考 fixture 没有被放在模型可见工作树之外 |
| `packaged_skill_root` | 候选不是从**打包后的技能根目录**生成的，而是从开发仓库根目录生成的——不构成公平对比，也可能意外读到了 `agentic-topology/tests/` 这类不随 npm 包分发、但在开发仓库里能看到的内容 |

外加 `repo_commit`（被分析项目的 commit，供复核只读约束）与 `skill_sha256`（打包技能的哈希，保证同一批比较用的是同一份技能）两个字符串字段。

这四五项任何一项结构性缺失（整个 `protocol` 键都没有），`verify` 判定为**输入不合规**，退出码 2，**不出收据**——这类调用方式错误不该留下一条看似正常的失败记录。但字段齐全、值却是 `false`（比如老老实实填了 `benchmarks_dir_excluded: false`），`verify` 照常判、照常出收据，把协议闸标成 `fail`，退出码 1——**如实记录这次运行违反了协议，而不是让它从证据链里悄悄消失**。

**为什么这条要单独拎出来、且比另外三道闸更硬**：另外三道闸问的是"这份候选好不好"，协议前提问的是"这次测量本身站不站得住"。候选再完美，如果模型分析的时候能看见答案卡，这次测量就没有意义——不是候选的分要打折，是这次测量整个作废。

### 范围闸（scope）

case 里的 `required_scope_refs` 列出判据必须看到的路径（比如系统提示词的装配处）。`verify` 深度扫描候选描述里出现过的**全部字符串**（主要落在各处 `source.refs` 里），逐条检查要求的路径子串有没有出现过。缺一条就是 `fail`，并把缺的是哪条、为什么必须看到列出来。

这条闸直接对应 `docs/TODO.md`〈选基准项目的规矩〉那句话：**划范围 MUST 覆盖系统提示词的装配处**——第三个基准项目当初整轮作废，原因之一就是把 `execenv/` 排除在范围外，而那正是装配系统提示词的地方。这条闸把"别重蹈覆辙"从人工提醒变成机械检查。

### 覆盖闸（coverage）：本套件的核心

这道闸回答的是 PRD 的验收问题本身：**agent 节点遗漏 = 0、调用边遗漏 = 0，是"测出来是 0"还是"认定为 0"？**

判定分两层，**结构层是机械的，语义层是人工的**——这个分层是设计上刻意的，见下一节〈为什么这样设计〉：

**结构层（`verify` 自己算）**：

1. case 的每个 `required_agent_nodes` 项（语义键 + 一组可接受的等价说法），必须在候选里绑定到**恰好一个 `kind: agent` 的节点**。绑定方式二选一：候选节点的 `name` 精确命中 case 声明的某个等价说法（大小写、空白归一化后比较）；或者 `run.json` 里有一条带**姓名与理由**的 `node_bindings` 记录，人工把它绑到某个候选节点上。**没有第三种方式**——自动匹配不到、也没人签字负责的绑定，一律判 `unbound`，`verify` 不会自己去猜"哪个候选节点看起来更像"。**agent 节点没有合并逃逸阀**：判据是"装配了一套系统提示词"，不存在"把两个 Agent 合并进一个节点、留个账就算数"这回事，绑不上就是绑不上。
2. case 的每条 `required_edges`（带方向），按同样的规则把两端解析到候选节点：
   - 两端解析到**不同**候选节点、候选描述里也确实有这条边（`from`/`to` 精确匹配）→ `explicit_edge`，过。
   - 两端解析到**同一个**候选节点（这条传递被合并进了节点内部）→ 必须在 `run.json` 的 `ledger_review` 里有一条对应记录，`verdict: "accounted"`，带姓名，且那个候选节点的 `responsibility`/`purpose` 不是空的 → `accounted_merge`，过；没有这条记录 → `unledgered_merge`，不过。**这正是 PRD 口径里"合并进节点内部的传递 MUST 留账"那句话的机械实现**，也是"调用边遗漏 = 0"这条防作弊线唯一的落地位置。
   - 两端**没能**自动绑定（标签对不上任何候选节点，也没人工绑定）→ 只认 `ledger_review` 里带姓名、`verdict: "accounted"` 的人工裁决；没有就是 `unresolved_edge`，不过。这条路径专门用来处理"候选把粒度切得比 case 预期的更细或更粗、结构对不上"的情况——比如把 case 里当一个节点处理的 MinerU 云端转换，候选实际切成了申请上传/轮询/下载三个节点：这时机械匹配天然对不上，只能靠人来判"这套更细的结构算不算满足了这条要求"。

**语义层（人只能自己签，程序不代劳）**：`run.json` 的 `coverage_review` 必须是 `{status, reviewer, defects}`，`status` 只有 `passed` 时、且 `reviewer` 非空，覆盖闸才可能是 `pass`。**结构层全过 ≠ 覆盖闸过**——如果 `coverage_review.status` 是 `skipped`（没有够格的评审人看过），覆盖闸照样判 `fail`，理由写清楚"skipped 不能升级成 pass"。反过来，**结构层没过时，`coverage_review: passed` 也救不回来**——不能靠一句"我看过了，没问题"绕开机械检查。

### 机械校验闸（validate）

候选描述本身要能过 agentic-topology 自己的 `scripts/validate.mjs`——这条不是本套件重新发明的规则，是直接 `spawn` 调用那份真实脚本（`node <skill-root>/scripts/validate.mjs <候选> --format json`），拿它的 `ok` 字段判过没过。`--skill-root` 默认指向本仓的 `agentic-topology/` 目录（方便开发时自测），**真跑基准时 MUST 显式传 `--skill-root` 指向那次生成候选所用的、打包后的技能根目录**——用哪份技能生成的候选，就该用同一份技能的校验器去核，不然"候选到底合不合这份技能自己的契约"这个问题答案就不唯一。

候选不是 `.yaml`/`.yml`（比如只有中间结构、没有落成源文件）时这道闸判 `not_run`，如实说明原因，**不算通过**。

## 为什么这样设计：程序管结构，人管语义

这套判定刻意避免了一类常见但脆弱的做法：**靠子串、关键词或相似度去猜"候选里这段文字说的是不是同一件事"**。原因很直接——这种启发式一旦换一种措辞、换一种切法就会静默失效，而且失效的时候不会报错，只会悄悄给出一个错的判定。

所以本套件把判定拆成两半：

- **凡是能变成"检查一个显式声明存不存在"的，交给程序**：候选节点名是不是等于 case 里预先枚举好的某个等价说法（不是"像不像"，是"等不等于"）；`ledger_review`/`node_bindings` 这条记录存不存在、字段填没填、指向的候选节点在不在。这些都是机械的**存在性检查**，不涉及"这句话说得对不对"。
- **凡是要读一段自由文字、判断"这算不算说清楚了"的，交给人**：`responsibility` 里那句话有没有真的点名被合并的几步、`ledger_review.note` 写的理由站不站得住、`coverage_review` 整体签不签得过——这些是语义判断，程序不读心，只检查"有没有一个具名的人对这件事负责地表过态"。

**这条分界线也是 `check` 自己在检查的东西**：case 文件的自洽性（key 有没有重复、标签有没有在同一个 case 内部撞车、边的两端在不在声明过的节点集合里）全是结构性的，`check` 能穷举；但"这个 case 描述的必需节点/边是不是这个项目里真实存在的"这件事，`check` 不检查，也检查不了——那是写 case 的人对着源码核实过的责任，见下文〈case 文件怎么写〉。

## 什么才算证据：`evidenceEligible`

单次 `verify` 的收据只回答"这一次跑得怎么样"。`report` 把一批收据（JSONL，一行一条）汇总，回答的是"这批结果够不够格被当成证据"：

- 只统计 `attempt === 1` **且** `evidence_eligible === true` 的收据（后者见下面〈attempt 1 为什么要冻结〉与〈已知泄题面〉两节——落在已判定 `blind_test_eligible: false` 的 case 上的收据，无论闸过没过，一律不计入证据矩阵）；
- 对每一个出现过的 `agent::model` 配置，检查它对 manifest 里**每一个 `status: ready` 且 `blind_test_eligible: true`** 的 case，是不是**恰好有一条**这样的收据——0 条是缺失，2 条以上是矩阵重复（比如把 attempt 1 跑了两次都当正式收据交上来），两种情况都会让 `evidenceEligible` 判 `false`；
- 失败按闸分簇（`protocol` / `scope` / `coverage` / `validate` / `operational:<原因>`），方便一眼看出"这批结果大部分栽在哪一步"。

**`evidenceEligible: true` 不代表结果好看**——它只代表"矩阵是齐的，可以拿这批数据说话"，不代表 `first_pass_usable_count` 高。反过来，矩阵不齐时，哪怕跑出来的那几条全部 `pass`，也不能拿来当"3 个项目遗漏为 0"的证据——**证据的第一个条件是齐全，不是好看**。这句话直接对应 `docs/report/基准项目分析核对.md` 里反复强调的那条：单个项目上的 0，在另外两个项目没跑齐之前，不能单独当准出凭据。

每一份 `report` 输出的结果都是**固定诊断样本，不是排行榜**——它只回答"这几个配置在这几个 case 上跑成什么样"，不构成任何跨配置、跨时间的排名主张。

## attempt 1 为什么要冻结

一次完整的 Agent 调用是 attempt 1；这次调用一结束，产出的候选描述**必须原样保留，不接受任何事后编辑，包括人改**。

原因是：如果允许"跑完看不满意再改一改再交"，"遗漏 = 0"这句话就从"这套流程本来就不漏"退化成"改到不漏为止"——两者观测上可能长得一样，但前者是关于**方法**的证据，后者只是关于**这一份文档**的证据，且后者对下一次真实使用毫无预测力。

Agent 在那一次调用**内部**可以自己调用真实的 `validate.mjs` 反复修、反复改，那属于流程本身的一部分（`SKILL.md` 第 4 步本来就写了"校验不通过时逐条打印、照着改、最多改 3 轮"）；但调用一结束，`benchmark-candidate`（那份 `.topology.yaml`）就定格了，后续任何"再顺一遍"都只能作为诊断留档，不能替换 attempt 1 进证据矩阵。

Agent 调用没能产出候选时（超时、没跑出候选、供应商错误），MUST NOT 假装没这回事，直接丢弃这次尝试——用 `record-failure` 记一条失败收据。失败收据同样进 `evidenceEligible` 的矩阵计数（占住这个 config × case 的位置）与失败分簇统计，只是三道闸的状态都诚实地写 `not_run`（无候选，未产出），不伪造一份"格式非法"的候选文件去凑数。

## 防泄题

这是这套东西存在的主要理由之一。分两层：**机制上怎么防**、**这次复核实际查出了什么**。

### 机制

- **`benchmarks/` 整个目录（包括这份 README、`manifest.json`、`cases/`、`prompts/`、`benchmark.mjs` 本身）MUST NOT 进入被测 Agent 可见的工作树**。被测 Agent 只应该看到：技能本体（打包后的，不是开发仓库）+ 被分析项目的源码。
- harness、cases、prompts、参考 fixture 一律放在模型可见工作树之外，**由外部 runner 投递 prompt**——runner 负责鉴权、选模型、控制超时、投递 `prompts/*.md` 的内容、留存原始 transcript；本套件的脚本**从不启动任何模型供应商调用**，这条边界写死在设计里，不是"当前没做"。这样做的另一个好处：供应商代码与密钥不会进入这个技能的代码库。
- 候选描述 MUST 从**打包后的技能根目录**生成，不是开发仓库根目录——开发仓库里能看到 `agentic-topology/tests/`（不随 npm 包分发），也能看到这份 `benchmarks/`；只有从打包产物出发，"被测 Agent 能看到什么"才等于"真实用户装了这个技能之后能看到什么"。这条由 `run.json.protocol.packaged_skill_root` 显式声明，`verify` 机械核对。
- 三份 prompt（`prompts/*.md`）贴着真实用法写——就是使用者会说的那句"画一下这个项目的编排"，外加一句指向被测项目的定位信息，**不包含任何 case 里的节点名、边名、数字**。

### 已知泄题面（2026-09-21 复核，方法：对 `agentic-topology/SKILL.md`、`agentic-topology/references/*.md`、`agentic-topology/assets/templates/example.topology.yaml` 逐份 grep 各基准项目的专属名词）

这是本次复核**实际查出**的结果，如实记录，不是"设计上应该没有"：

**`aiudit-internal-control`：已判定 `blind_test_eligible: false`，泄题程度比 multica 更重**：

| 位置 | 泄的是什么 |
|---|---|
| `references/节点粒度约定.md` 第 169–176 行〈事实基准〉 | 逐字给出这个项目"10 个节点（8 程序 + 2 Agent）、15 条单向边（同向合并后 14 条）"，并点名三个具体节点（"材料清册与指纹""台账复用查找""材料分组与规划提示词构建"）与两条传递物的合并方式（"补交提醒"与"取消信号"同向合并）——**这就是这个 case 的答案本身** |
| `references/编排描述格式.md` 第 51 行 | 顶层字段示例直接写 `source_project: "~/projects/aiudit_platform"` |
| `references/编排描述格式.md` 第 174 行 | `system_prompt` 示例写"你是内控审计判定师" |
| `references/编排描述格式.md` 第 264 行 | `exits` 示例写"这一项内控点是什么" |
| `references/抽取纪律.md` 第 60 行 | 拿"补交提醒"当带外信号边的例子 |
| `assets/templates/example.topology.yaml` | SKILL.md 加载点清单里"想看一份能直接改的样例"指向的那份模板，节点名与结构几乎是这个项目的改写版（"材料清册与两个指纹""规划师""调度分发"等） |

`SKILL.md` 的加载点清单要求：填字段前必读 `编排描述格式.md`、判粒度前必读 `节点粒度约定.md`、读源码前必读 `抽取纪律.md`、想看样例就读 `example.topology.yaml`——**这四份文档覆盖了正常分析流程几乎全部会读到的参考材料**，而其中四份都带着这个项目的痕迹。按 `docs/TODO.md`〈选基准项目的规矩〉"MUST NOT 是本技能任何一份强制加载文档拿来举例的项目"这条，`aiudit-internal-control` 目前的状态与 `multica` 相同：**不能用于正式盲测取证轮**。

这几份文档在 `agentic-topology/references/`、`agentic-topology/assets/` 之下，**不属于本次交付范围**（其他子代理在改这些文件）——本套件只如实记录发现、把 `aiudit-internal-control.case.json` 标成 `blind_test_eligible: false` 并写清依据，不去改那几份文档。等它们被改到不再举这个项目的例子之后，需要重新 grep 一遍、把这个字段翻回 `true`。

**`cpah-docs-pipeline`：同一次复核，`blind_test_eligible: true`**——对这个项目专属的词（`cpah` / `tauri` / `mineru` / "分类 Agent" / `tool_calling_probe` / "连通性探针"）在同样的检索范围里零命中。**这个结论只在这些文档没有变化的前提下成立**，下一次真的要跑之前 MUST 重新 grep 一遍，不能假设结论一直有效——`benchmark.mjs` 不会替你查这件事，查过之后把 `blind_test_note` 更新成这一次查证的时间与方法。

**`third-project-pending`：待定**。选定后 MUST 先做同样的 grep 复核（见 `docs/TODO.md`〈选基准项目的规矩〉），确认零命中再补数据；`multica` 与 `aiudit_platform` 都已经因为这条规矩永久或暂时失去资格，不能再选。

### 机制怎么接住这次复核的发现

`benchmark.mjs` 的 `verify`/`record-failure` 默认拒绝对 `blind_test_eligible: false` 的 case 出任何收据（退出码 2）。只有显式加 `--allow-compromised-case` 才会放行——这种情况下收据的 `evidence_eligible` 会被强制标 `false`，`report` 的证据矩阵永远不会把它算进去。这条口子只留给"明确知道自己在做什么"的场景，比如拿 `aiudit-internal-control` 这份真实、已交叉核实过的数据去自测 `benchmark.mjs` 自身的判定逻辑对不对（`benchmarks/tests/` 目前没有用它，用的是不对应任何真实项目的最小夹具，但这条口子是留出来给以后需要更贴近真实结构的回归测试用的）。

## 目录结构

```
benchmarks/
  README.md                    本文件
  manifest.json                套件清单：哪些 case、对应哪份 prompt、status 是 ready 还是 pending
  cases/
    aiudit-internal-control.case.json     ready，但 blind_test_eligible: false（见上）
    cpah-docs-pipeline.case.json          ready，blind_test_eligible: true
    third-project-pending.case.json       pending，等待选定第三个基准项目
  prompts/
    <case-id>.md                投递给被测 Agent 的 prompt；对 pending case 只有一份写清楚待补的占位文件
  benchmark.mjs                 唯一的命令行入口：check / verify / report / record-failure
  tests/                        benchmark.mjs 自己的测试，node:test，零依赖
    *.test.mjs
    fixtures/                   测试夹具（不对应任何真实项目，是专门为测 benchmark.mjs 判定逻辑造的最小例子）
```

## 使用方法

### `check`——自检套件本身

```bash
node benchmarks/benchmark.mjs check [--manifest benchmarks/manifest.json]
```

检查 manifest 引用的 case/prompt 文件都在、每份 `status: ready` 的 case 自己结构自洽（`required_agent_nodes`/`endpoint_aliases` 的 key 不重复、标签在同一个 case 内不撞车、`required_edges` 的两端都在声明过的节点集合里、`merge_accounting_required` 引用的边确实存在于 `required_edges`、`blind_test_eligible`/`blind_test_note` 都填了）。通过打印一行 OK、退出码 0；不通过逐条列出哪个文件哪一处、退出码 2。

**`check` 检查的是套件本身自洽，不检查 case 描述的内容是不是真实项目的真相**——那件事没有程序能替你做，见下一节。

### `verify`——拿一份候选核三道闸

```bash
node benchmarks/benchmark.mjs verify \
  --case benchmarks/cases/cpah-docs-pipeline.case.json \
  --candidate /path/to/cpah-docs.topology.yaml \
  --run /path/to/run.json \
  [--skill-root /path/to/packaged/agentic-topology] \
  [--allow-compromised-case]
```

输出一行 JSON 收据到 stdout（append 进一个 `.jsonl` 文件就是 `report` 要读的格式），诊断信息走 stderr。退出码：`0` = 三道闸全过（`first_pass_usable`）；`1` = 至少一道闸 `fail`（协议前提值为 `false` 也算在内，只要收据出得来）；`2` = 输入或调用本身有问题（文件缺失、JSON 非法、case/run 结构不自洽、case 是 `pending`、`case_id` 对不上、`blind_test_eligible: false` 且没加 `--allow-compromised-case`）——这类情况**不出收据**。

### `record-failure`——候选没跑出来时补一条收据

```bash
node benchmarks/benchmark.mjs record-failure \
  --case benchmarks/cases/cpah-docs-pipeline.case.json \
  --run /path/to/run.json \
  --failure timeout   # 只认 timeout / no_candidate / provider_error
```

### `report`——把一批收据汇总成证据

```bash
node benchmarks/benchmark.mjs report \
  --results /path/to/results.jsonl \
  --manifest benchmarks/manifest.json
```

输出一份 JSON：`ready_case_ids`、`blind_test_ineligible_case_ids`、`pending_case_ids`、每个配置 × 每个 case 的收据数矩阵、`evidence_eligible`、按闸分簇的失败统计、`first_pass_usable_count`。

## case 文件怎么写

一份 case（`cases/<id>.case.json`）描述的是"这个项目里，一份及格的编排描述必须至少覆盖什么"，不规定候选怎么切、怎么起 ID、怎么布局——这是照抄 archify 的设计：**模型自由选内部 ID 和布局，只有语义键与关系是硬性的**。字段：

| 字段 | 说明 |
|---|---|
| `status` | `ready`（数据齐全，可以真跑）或 `pending`（还没选定/还没补齐，留白） |
| `blind_test_eligible` / `blind_test_note` | 这个项目有没有被本技能任何一份强制加载文档举过例子——`ready` 状态下必填，判断依据与查证时间写进 `note` |
| `required_scope_refs` | `[{path_contains, why}]`，划范围时必须覆盖的路径（尤其是系统提示词装配处） |
| `required_agent_nodes` | `[{key, labels[], evidence_refs[], why}]`，必须存在的 agent 节点，`labels` 是这个节点可能被叫的所有等价说法 |
| `endpoint_aliases` | `{key: {labels[], kind_hint, evidence_refs[]}}`，`required_edges` 用得到、但本身不是"必须单独成节点"的端点（一般是 program/decision） |
| `required_edges` | `[{from, to, why, evidence_refs[]}]`，`from`/`to` 引用上面两处任一个 key，方向硬性 |
| `merge_accounting_required` | `[{cluster_key, applies_to_edges[], artifacts[], rule_ref, note}]`，点名"已知很可能被合并、合并时该在 responsibility 里写清楚哪几步/哪几个产物"的位置，供人工评审参考，本身不是机械检查项 |

**写 case 时 MUST 只写在源码或已核实的分析报告里真读到的东西，读不出来的就留白或标"待补"，MUST NOT 编造一个项目里不存在的节点或边。** `aiudit-internal-control.case.json` 与 `cpah-docs-pipeline.case.json` 的数据全部来自 `docs/report/基准项目分析核对.md` 与 `agentic-topology/tests/fixtures/benchmarks/` 下已经交叉核实过的产物（独立验证方 + 分析方两轮），每条 `required_edges`/`required_agent_nodes` 都带着 `evidence_refs` 指回真实文件行号；两份 case 的 `provenance.caveat` 字段各自写清了这份数据本身的局限（比如 aiudit 的 fixture 产出于粒度留账规则补齐之前，本身不含逐项留账）。

## `run.json` 怎么写

```jsonc
{
  "schema_version": 1,
  "case_id": "cpah-docs-pipeline",        // 必须等于 case.id
  "agent": "claude-code",                 // 被测 Agent/CLI 名称
  "model": "claude-sonnet-5",
  "attempt": 1,                           // 只有 attempt 1 进 evidenceEligible 矩阵，其余仅供诊断
  "generated_at": "2026-09-21T12:00:00Z",
  "protocol": {
    "benchmarks_dir_excluded": true,
    "harness_outside_worktree": true,
    "packaged_skill_root": true,
    "repo_commit": "<被分析项目的 commit>",
    "skill_sha256": "<打包技能的哈希>"
  },
  "node_bindings": [
    // 自动标签匹配失败时，人工签字的节点绑定
    { "required_key": "classifier_agent", "candidate_node_id": "N7", "reviewer": "张三", "rationale": "候选叫「文档分类会话」，措辞不同但确实是这个" }
  ],
  "ledger_review": [
    // 某条必需边被合并进候选节点内部、或结构对不上时，人工签字的裁决
    { "edge": { "from": "engine_choice", "to": "mineru_converter" }, "candidate_node_id": "N5",
      "verdict": "accounted", "reviewer": "张三", "note": "N5.responsibility 里点名了申请上传/轮询/下载三步" }
  ],
  "coverage_review": { "status": "passed", "reviewer": "张三", "defects": [] }
}
```

`node_bindings`/`ledger_review` 没有需要人工介入的项时写 `[]`，不能整段省略——这两个字段结构性必填，`verify` 靠它们的存在与否区分"这次运行诚实地没有需要人工兜底的地方"和"这次运行的 `run.json` 本身不完整"。

## 现在的状态：跑第一轮正式基准还差什么

**没有跑过任何一轮真实基准**——本次交付的是让它可以被跑起来的那套东西，不是跑出来的结果。逐条列缺口：

1. **第三个基准项目还没选定**（`third-project-pending`）。选定后需要：确认满足 `docs/TODO.md`〈选基准项目的规矩〉两条前提（不是强制加载文档举过例的项目、划范围覆盖系统提示词装配处）；对它做一次和 `aiudit`/`cpah-docs` 同样的复核 grep；读源码补齐 `required_agent_nodes`/`required_edges`/`required_scope_refs`。
2. **`aiudit-internal-control` 当前不可用于盲测**，泄题面比 multica 更广（见上）。要么等 `agentic-topology/references/`、`agentic-topology/assets/` 里举例的四处被改掉再复核翻正，要么放弃这个项目、另选一个替补。**这意味着当前唯一可以立刻拿去跑的 case 只有 `cpah-docs-pipeline` 一个**——离"3 个项目"还差两个。
3. **没有外部 runner**。本套件明确不启动任何模型供应商调用（见〈防泄题〉），需要另外一套东西：拿包装好的技能 + `prompts/*.md` 的内容去实际驱动一个被测 Agent，留存 transcript，产出 `benchmark-candidate.topology.yaml` 与 `run.json` 的骨架（`agent`/`model`/`attempt`/`generated_at`/`protocol` 这几项它填得了，`node_bindings`/`ledger_review`/`coverage_review` 需要人工核对后补）。
4. **没有指定的人工评审人**。`coverage_review` 与 `ledger_review` 需要一个"知道怎么读 `.topology.yaml`、愿意具名负责"的人（或明确被赋予这项语义判断职责的 Agent），照着候选与 case 逐条核对、签字。这个人选没有定。
5. **`--skill-root` 需要指向真实打包产物**。本仓开发状态下默认指向 `agentic-topology/`（开发仓库根的子目录），真跑基准时 MUST 先 `npx agentic-topology install` 到一个干净目录，把 `--skill-root` 指过去，并把那次安装的哈希填进 `run.json.protocol.skill_sha256`——这一步当前没有自动化，需要手动做。
6. **`benchmark.mjs` 自身只用不对应真实项目的最小夹具做过测试**（`benchmarks/tests/fixtures/mini-*`），`check` 通过、40 条测试全过，但从没有拿一份真实候选（比如真的重跑一次 `aiudit_platform` 或 `cpah-docs` 产出的新鲜候选）灌给它验证过端到端行为——这件事等第一轮真实基准跑起来时会自然发生。
