# agentic-topology

把一个 agentic 应用的编排画成一张能点开下钻的图。

指着一个仓库或组件，读源码抽出它有哪些 AI、各自能用什么工具、程序段夹在中间干什么、
谁调谁、传了什么，填成一份编排描述，再渲染成**可离线打开的单文件网页**。
也支持直接拿一份手写的描述出图。

> **它只陈述事实，不下判断**——不评价架构好坏、不给改进建议。
> 用途是让人**看清楚到能自己下判断**。

## 解决什么问题

多 agent 系统超过三四个 agent 之后，编排关系只存在于代码和各自的提示词里，没有全貌。
接手、排查、讲解都要重新通读一遍。

这个技能把那份全貌读出来、画出来、并且能点开下钻。

## 两条路径

| 路径 | 什么时候用 |
|---|---|
| **自动分析**（主路径） | 指着一个仓库说"画一下它的编排"，读源码产出描述再出图 |
| **手写描述**（兜底） | 已经有一份写好的描述；或分析整体失败 |

## 快速上手

需要 Node.js ≥ 18。**零 npm 依赖**，clone 下来直接能跑。

```bash
# 只校验，不出图
node scripts/validate.mjs <描述文件>

# 机器可读的校验结果
node scripts/validate.mjs <描述文件> --format json

# 出图（内部先校验，通过才产出）
node scripts/render.mjs <描述文件> -o <输出.html>
```

退出码：`0` 通过 · `2` 校验不通过 · `3` 语法错或文件读不了 · `1` 程序自身异常。

拿仓库里的样例试一把：

```bash
node scripts/render.mjs assets/templates/example.topology.yaml -o /tmp/demo.topology.html
open /tmp/demo.topology.html
```

产物是**一个单文件网页**——断网能看、能直接发给别人、不依赖任何服务。

> 出图时可能在 stderr 看到 `layout: label overlap at edge X->Y`。
> **这不是错误**（退出码仍是 0，HTML 已正常产出），是布局器在如实报告
> "这条连线的说明文字退让了几次仍与别的东西重叠"。设计上**不许静默**——
> 宁可吵一句，也不让使用者以为图上一切都摆得开。

## 描述长什么样

受限的 YAML 子集（不支持锚点、流式集合、多文档等），一份最小样例见
`assets/templates/example.topology.yaml`。骨架：

```yaml
schema_version: 1
source_project: "~/projects/your-app"
generated_at: "2026-08-27"
analysis_complete: true

graph:
  topology: fixed_workflow      # 或 peer_loop / manager_worker / decentralized_handoff
  context_sharing: isolated
  entry: "使用者点「开始」，经入口校验后进入"
  exits: [...]

groups: [...]                   # 分堆，用于折叠

nodes:
  - id: N1
    name: "规划师"
    kind: agent                 # agent / program / decision
    responsibility: "把要求落到具体的检查项上"
    group: g1
    system_prompt:
      file: "prompts/planner.v2.md"
      from: 1
      to: 6
    tools: [...]                # 工具 / MCP / Skill 三份清单 MUST 分列
    mcp: []
    skills: []
    stop: {...}                 # 什么时候会停：步数 / 时间 / 花费 / 连续失败
    spawns_subagents: false
    confidence: certain         # certain / inferred / unread
    source:
      refs: ["src/engine.ts:1169-1181"]
      confirmed_at: "2026-08-27"

edges:
  - from: N1
    to: N2
    category: normal            # normal / pass_or_skip / reject_or_halt
    trigger: "计划通过硬校验"
    carrier: file
    payloads: [...]             # 传了什么、什么时候造出来、什么时候交出去
    confidence: certain
    source: {...}
```

完整字段契约见 `references/编排描述格式.md`。

## 图上能看到什么

- **编排全貌**：方块按分堆分列，颜色管连线类别、线型管可信度
- **点开节点下钻**：干什么 / 收到什么 / 交出什么、三份能力清单、终止条件、提示词按行区间内嵌
- **点开连线下钻**：触发条件、载体、每个传递物的产生与传递时机
- **分堆折叠**：收起来只看堆与堆之间的关系，**折叠可完全还原，不丢任何节点或边**
- **筛选**：按可信度、执行者类型、分堆过滤
- **核对清单**：所有「只是猜的」和「没查出来」的条目单独列一份，带来源与确认时间

## 设计原则

**AI 信任边界**：模型只负责产出描述，**由确定性的校验器决定它能不能变成图**。
校验不通过就不产出任何 HTML，而是逐条打印哪个方块、哪条线、缺哪一项。

**三档可信度，不许含糊**：`certain`（查实了）/ `inferred`（只是猜的）/ `unread`（没查出来）。
后两档画成虚线并进核对清单。**分不清 certain 与 inferred 时取更保守的那档。**

**只读**：全程 MUST NOT 修改目标项目任何文件。

**确定性布局**：位置全部由程序算出，描述文件不提供任何位置字段；
同一份描述两次运行产出的 HTML **逐字节相同**。

## 仓库结构

```
SKILL.md                  技能入口：两条路径、加载点清单、三步流程、禁止行为
references/
  编排描述格式.md          字段契约、闭集取值、YAML 子集边界、校验规则
  节点粒度约定.md          一个节点算到哪、三类执行者怎么分
  抽取纪律.md              真相方向、允许与禁止、读不出来怎么办、自查清单
  界面用语表.md            契约用语 → 界面白话的对照
scripts/
  validate.mjs            校验 CLI
  render.mjs              出图 CLI
  lib/                    解析 / 校验 / 布局 / 富化 / 渲染
assets/
  page-shell/             页面外壳与样式
  templates/              最小完整样例
tests/                    155 个测试，node:test，零依赖
docs/
  spec/  plan/  report/   需求、实施计划、基准项目核对报告
```

## 开发

```bash
npm test          # 等价于 node --test
```

零运行时依赖、零构建步骤。测试用 Node 内置的 `node:test` 与 `node:assert/strict`。

## 现状与已知限制

- 三个真实基准项目的分析核对进行中，结论见 `docs/report/基准项目分析核对.md`。
  **报告如实记录未达标项，不用"基本符合"这类话糊过去。**
- 想做但本期没做的、待澄清的问题、已知风险与技术欠账，都记在 `docs/TODO.md`。

## 许可

未定。
