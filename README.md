# ruleward

> Lint your AI agent rule files (AGENTS.md, CLAUDE.md, Cursor rules) for conflicts, duplication, bloat — and rules that drift from your actual code.

AI coding agents read instruction files like `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules/*.mdc` on nearly every request. These files grow over time and quietly rot: rules start to contradict each other, repeat what's already in your config, balloon the context window, or point at code that no longer exists. Unlike your source, they have no compiler and no linter.

**ruleward is that missing linter.** It parses your rule files into a normalized model and runs checks across four areas:

- **Conflict** — contradictory rules (e.g. "use tabs" vs "use spaces").
- **Duplication** — rules that repeat each other, or restate what `package.json` / `tsconfig` / Prettier already enforce.
- **Bloat** — context-window waste: token-budget overruns and vague, unactionable rules.
- **Drift** — rules that no longer match your codebase — the part format-only linters miss.

ruleward is **code-aware**: it reads your actual source to catch rules that reference removed symbols, paths, scripts, or dependencies — and, the standout check, it flags code marked `@deprecated` that has *no rule guarding against it* and drafts the rule for you.

## What it checks

| Engine | Check | Severity | What it catches |
|---|---|---|---|
| conflict | `setting-collision` | error | Same-scope rules set one option to different values (tabs vs spaces) |
| conflict | `scoped-override` | info | A narrower scope overrides a broader one (intentional? worth a look) |
| conflict | `prohibit-vs-require` | error | The same import target is both forbidden and required |
| conflict | `nli-contradiction` | info · opt-in | Natural-language contradiction (needs `--semantic`; experimental) |
| duplication | `redundant-with-config` | warning | A rule restates what package.json / tsconfig / Prettier already enforces |
| duplication | `rule-rule` | warning · info | Exact or near-duplicate rules, across files |
| bloat | `token-budget` | warning | Always-on instructions exceed the token budget |
| bloat | `vague` | info | Unactionable filler ("write clean code") |
| drift | `dangling-path` | warning | Rule points at a path that doesn't exist |
| drift | `stale-command` | error | Rule runs a script that isn't in package.json |
| drift | `stale-dependency` | warning | Rule names a tool/framework that isn't installed |
| drift | `broken-alias` | warning | Import alias isn't configured in tsconfig paths |
| drift | `stale-symbol` | warning | Rule references a symbol that no longer exists in the code |
| drift | `missing-guard-rule` | info | Code is `@deprecated` but no rule warns against it (suggests the rule) |
| drift | `deprecated-symbol-recommended` | warning | A rule recommends a symbol that's deprecated in code |

## Supported rule files

`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc` (including `globs` / `alwaysApply` frontmatter), `.github/copilot-instructions.md`, `.windsurfrules`, and `.clinerules`. Nested files and their scopes are understood, so a more specific rule can legitimately override a broader one.

## Quick start

> Not yet published to npm — run from source.

```bash
git clone https://github.com/kernullist/ruleward
cd ruleward
npm install

npx tsx src/cli.ts check .             # run all checks on the current repo
npx tsx src/cli.ts check . --format sarif > ruleward.sarif
npx tsx src/cli.ts parse AGENTS.md     # inspect the parsed model for one file
npx tsx src/cli.ts discover .          # list the rule files it found
```

A `check` line looks like:

```
⚠ WARNING drift/dangling-path   AGENTS.md:14  (conf 0.85)
    Rule points at `src/legacy/*`, which does not exist.
```

## Usage

```
ruleward check <path> [options]
  --format <pretty|json|sarif>     output format (default: pretty)
  --max-level <error|warning|info> exit non-zero at/above this severity (default: error)
  --error-on <checks|engines>      escalate specific checks to error (e.g. drift/stale-command,conflict)
  --no-code-scan                   skip the code index (disables code-aware drift checks)
  --semantic                       enable the experimental NLI semantic-conflict tier

ruleward parse <path>              dump the parsed instruction model
ruleward discover <root>           list discovered rule files and their scopes
```

By default only **deterministic, high-confidence** findings reach `error` severity, so a normal `check` won't fail CI on advisory `warning`/`info` results. Use `--max-level` or `--error-on` to tighten the gate for the checks you care about.

## Output & CI

`pretty` (human), `json` (machine), and **SARIF 2.1.0** are supported. SARIF uploads to GitHub code scanning and includes `relatedLocations` (the other conflicting/duplicate rule, or the offending code location) and suggested fixes. An example workflow lives in [`.github/workflows/lint-rules.yml`](.github/workflows/lint-rules.yml).

## Configuration

Drop a `.rulewardrc.json` at your project root to tune thresholds, silence checks, or skip files:

```json
{
  "disable": ["bloat/vague", "conflict/scoped-override"],
  "errorOn": ["drift/stale-command"],
  "ignore": ["legacy/**/AGENTS.md"],
  "tokenBudget": 6000,
  "nearDupJaccard": 0.9,
  "nliThreshold": 0.92
}
```

- `disable` — checkIds or engine names to drop (`bloat`, `drift/stale-symbol`, …).
- `errorOn` — escalate matching checks to `error` (fail CI).
- `ignore` — globs of rule files to skip.
- `tokenBudget` (or `tokenBudgetFile` / `tokenBudgetAlways`), `nearDupJaccard`, `nliThreshold` — threshold overrides.

CLI flags (`--error-on`, `--max-level`, `--no-code-scan`, `--semantic`) layer on top.

## How it works

```
rule files → Instruction IR (remark/mdast) → check engines → diagnostics → pretty / JSON / SARIF
```

Each rule file is parsed into a normalized **Instruction IR** via a real Markdown AST. The check engines run over that IR; the drift checks additionally consult a **code index** built with [tree-sitter](https://tree-sitter.github.io/) (TypeScript, JavaScript, Python, Go — with a regex fallback for other languages). Everything runs locally and deterministically by default: no network, no model downloads. Severities are confidence-tiered so the default run stays low-noise.

### Semantic conflicts (optional)

`ruleward check --semantic` enables an experimental tier that uses a local NLI model (via [transformers.js](https://github.com/xenova/transformers.js), downloaded on first use) to flag natural-language contradictions that don't reduce to a settings collision — e.g. *"keep functions small"* vs *"prefer large, comprehensive functions"*. It is opt-in, reported at `info` severity, and never fails CI. Run `npm run bench:nli` to see its current precision/recall on the labeled set.

## Project layout

```
src/
  discovery/   find rule files (multi-format) and build RuleFiles
  parse/       Markdown AST → Instruction IR
  extract/     directive, settingKV, code referents, scope, category
  analyze/     analysis context + check engines (conflict/duplication/bloat/drift)
  codeindex/   tree-sitter + regex code/deprecation index (drift inputs)
  semantic/    optional NLI model wrapper
  report/      SARIF and pretty output
  bench/       planted-fault benchmark (precision/recall/FP)
```

Design notes and rationale live in [`DESIGN.md`](DESIGN.md) and [`docs/`](docs/).

## Limitations

- One `settingKV` value is extracted per rule (e.g. "2-space indentation" maps to `style.indent`, not also `indentSize`).
- Declaratively phrased settings ("Maximum line length is 100 characters.") may be classified as narrative, though the setting is still extracted.
- The `--semantic` tier is a zero-shot baseline; its precision is still being improved.

## Development

```bash
npm test            # unit tests + the planted-fault benchmark
npm run typecheck   # tsc --noEmit
npm run bench       # planted-fault benchmark report (precision/recall/FP)
npm run build       # bundle to dist/ via tsup → the `ruleward` bin (node dist/cli.js)
```

## License

MIT
