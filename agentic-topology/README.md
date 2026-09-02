# agentic-topology

Draw the orchestration of an agentic app as a diagram you can click into.

Point it at a repo and say "draw this project's orchestration." It reads the source and pulls out
**which AIs exist, what tools each one has, what the deterministic code between them does, who calls
whom, and what gets handed over** — then renders **a single HTML file that opens offline**.

![Orchestration overview](https://raw.githubusercontent.com/weidwonder/agentic-topology/main/assets/images/overview.png)

Every box and every connection carries a `file:line` citation, and anything the analysis only guessed
at is marked as a guess rather than dressed up as a fact. **It tells you what it found, not what it
thinks of it** — no architecture scoring, no improvement suggestions.

## 30 seconds

```bash
npx agentic-topology install
```

Then **say one sentence to your coding agent**:

> draw this project's orchestration

That's it. The diagram lands in your working directory; double-click to open. You never write a
description file and never run another command — the agent writes the intermediate
`<topic>.topology.yaml` itself, and a deterministic validator decides whether it is allowed to
become a diagram.

## CLI

```bash
npx agentic-topology install  [--agent claude|codex] [--dir <dir>]
npx agentic-topology render   <description-file> [-o <output.html>] [--force]
npx agentic-topology validate <description-file> [--format json]
```

Exit codes: `0` ok · `2` validation failed · `3` syntax error or file unreadable · `1` internal error

When validation fails **no HTML is produced at all** — instead it prints which box, which connection,
and which field is missing.

**Requires** Node ≥ 18. **Zero npm dependencies.** No network access, and your code is never uploaded.

## Full documentation

Everything else — what ends up on the diagram, the boundaries this tool holds and how they're
enforced, and what is still missing — lives in the repository README:

**https://github.com/weidwonder/agentic-topology** ([中文](https://github.com/weidwonder/agentic-topology/blob/main/README.zh-CN.md))

## License

MIT
