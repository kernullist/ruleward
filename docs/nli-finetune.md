# NLI fine-tuning (`conflict/nli-contradiction`)

The opt-in semantic-conflict tier uses an NLI cross-encoder. Zero-shot
`Xenova/nli-deberta-v3-base` scores ~71% precision on the labeled eval
(`npm run bench:nli`): rule files are imperatives, off-distribution for an
MNLI-trained model, so it over-predicts contradiction on same-topic-but-
compatible rules. A light fine-tune on rule-style pairs improves this.

**Measured here** (CPU, 4 epochs, 340 synthetic pairs, dev accuracy 0.97):
**precision 71% → 83%, recall 100%** — notably the "document X" vs
"document Y" false positive dropped 0.982 → 0.025. Small-scale; see caveats.

## 1. Generate training pairs

```bash
npm run nli:gen-data        # → corpus/nli-pairs.jsonl  {premise, hypothesis, label}
```

Synthesized from the settingKV ontology: same key / different value →
`contradiction`, same value / different phrasing → `entailment`, cross-key →
`neutral`.

## 2. Fine-tune (offline, Python; ~5 min on CPU here)

```bash
pip install --user torch --index-url https://download.pytorch.org/whl/cpu
pip install --user -r training/requirements.txt
python training/finetune_nli.py     # CrossEncoder from cross-encoder/nli-deberta-v3-base → training/finetuned-nli
```

## 3. Export to ONNX (for transformers.js)

```bash
pip install --user "optimum[onnxruntime]"
python training/export_onnx.py      # → training/finetuned-nli-onnx/  (config + tokenizer + onnx/model.onnx)
```

## 4. Use it in ruleward

Point the env var at the exported directory (absolute path); the tier loads it
locally instead of the default Xenova model:

```bash
RULEWARD_NLI_MODEL=/abs/path/training/finetuned-nli-onnx npm run bench:nli
```

The fine-tuned model is **not committed** (large; gitignored) — regenerate via
the steps above. The shipped default remains the zero-shot Xenova model.

## Real-corpus validation (2026-06): the fine-tune did **not** generalize

We did exactly what the caveat below says — ran the fine-tuned model over the
real corpus before promoting — and the result is a clear **no-go**:

```bash
RULEWARD_NLI_MODEL=/abs/path/training/finetuned-nli-onnx npm run bench:real -- --semantic
```

**326 `nli-contradiction` findings across 60 real files** (mean 5.5/file, max
176 in one file). Hand-inspecting the sample (`corpus/review.jsonl`), nearly all
are false positives, in three classes:

1. **Non-rule content mis-classified as a directive.** A Markdown table cell
   like `| Env var | required |` trips the `required` modality trigger → graded
   `MUST` → fed to NLI → compared against other table rows at 1.00 "contradiction".
2. **Complementary steps read as opposites.** *"Create `FooService` with
   `PrismaService`"* ⟂ *"Create `FooController` with `@ApiTags()`"* scored 0.98 —
   they are sequential setup steps, not a contradiction.
3. **Topic gate too permissive.** Two unrelated sentences sharing one jargon
   token (*"Type `/armature` to load the guide"* vs any other `armature` line)
   pass the gate and the model confidently calls them contradictory.

**Why the labeled eval (83%) lied:** it used ~10 clean, curated, declarative
pairs. Real rule files are messy — tables, multi-clause prose, ordered steps —
and pairwise NLI over *atomized* rule content is fundamentally ill-posed. The
83% precision did not survive contact with real data.

**Mitigation shipped** (`semanticConflict.ts` candidate gate): skip table rows
(`|`) and long prose (> 30 tokens). Measured effect: **326 → 149 findings**
(mean 5.5 → 2.55/file, max 176 → 73) — it removes FP class (1) but **not**
(2)/(3), which are inherent to pairwise NLI. The post-gate sample is still
dominated by FPs, including a fourth pattern worth naming:

4. **Compatible prohibit/require pairs.** *"NEVER use Tower CLI commands"* ⟂
   *"ALWAYS use `tower-mcp` instead"* scores 1.00 — but they intentionally
   reinforce each other. `ALWAYS`/`NEVER` + a shared subject reads as a
   contradiction lexically while being complementary in intent. (The
   deterministic `prohibit-vs-require` engine handles the *genuine* version of
   this via settingKV; pairwise NLI cannot tell the two apart.)

At mean 2.55 findings/file of mostly-FP `info`, this is still far too noisy to
default on.

**Verdict: the semantic tier stays opt-in / experimental. Default is unchanged
(off).** Promotion is blocked on two things, in order:

- **Stronger candidate selection, not more training.** Only compare *opposing-
  polarity directives about the same subject* (e.g. require-vs-prohibit on one
  settingKV-like target) — most of the 326 are pairs that should never have been
  scored. This is the real fix.
- **Then** AllNLI-scale training on a GPU (below) for the residual genuine pairs.

## v2 candidate selection: subject + polarity gating (the fix)

The 326 → 149 gate above only removed non-rule *content*; the real problem was
*which pairs we score at all*. v2 replaces the loose lexical topic-gate with a
**shared-subject** requirement and drops permissions:

- **Shared concrete subject.** A pair is scored only when both rules constrain
  the *same* code referent (a backtick object: `` `fetch` ``, `` `ParamSet` ``, a
  command, a path). Rules with no reliable referent are not compared at all —
  referent-less prose was the entire FP surface. This kills the
  complementary-step, unrelated-pair, and *different-object* prohibit/require
  classes at once (e.g. "never use `tower run`" vs "always use `tower-mcp`" —
  different objects, so never compared).
- **Polarity awareness.** Shared subject + opposing polarity (require ⟂ prohibit)
  is reported as `반대극성`; same-polarity antonymic pairs ("make `Foo` small" vs
  "make `Foo` large") as `값 대립`. Both still confirmed by NLI.
- **No permissions.** `MAY` ("a `ParamSet` *can* take any `SystemParam`") is
  excluded — a permission cannot contradict anything, and descriptive "X can be Y"
  prose was the main residual FP.
- **Referent hygiene.** `extractReferents` no longer mistakes English
  slash-phrases ("and/or", "input/output") for paths — they had created fake
  shared subjects between unrelated rules.

**Result on the same 60 real files** (`bench:real --semantic`):

| candidate gate | nli findings | mean/file |
|---|---|---|
| topic-token (v1) | 326 | 5.50 |
| + table / long-prose skip | 149 | 2.55 |
| + shared-subject + polarity | 8 | 0.13 |
| + drop `MAY` permissions | 1 | 0.02 |
| + referent hygiene (and/or) | **0** (zero-shot) · **1** (fine-tuned) | ~0 |

The shipped **zero-shot default now produces zero false positives across the 60
files**. The more aggressive fine-tuned model leaves a single FP: two
documentation sentences about `ParamSet` in a tutorial-style `CLAUDE.md` that is
*already* flagged by `bloat/token-budget`, where the purpose-clauses "to ensure" /
"to avoid" are mis-read as directives (an upstream modality limit, not the gate).

**Trade-off & status.** The tier now only flags **referent-anchored**
contradictions; pure-prose value-opposition ("keep functions small" vs "prefer
large functions") is no longer detected — that was precisely the FP surface, so
the narrower scope is deliberate. Precision on the real corpus is now strong, but
**recall is uncharacterized** (these 60 files contain few if any genuine
contradictions), so the tier stays **opt-in (`--semantic`), `info` severity, off
by default** — now a *precision-defensible* feature rather than a noise source.
Promoting it to default-on awaits a labeled recall corpus.

## Caveats / improving precision further

- 340 synthetic pairs alone overfit the templates — mix in SNLI + MNLI ("AllNLI").
- The residual labeled FP ("unit tests" vs "integration tests") needs more
  testing-topic pairs in the generator (`src/semantic/finetune-data.ts`).
- Validate on the real corpus (`npm run bench:real -- --semantic`) before
  promoting the tier — as the section above shows, the labeled eval is not
  enough — and prefer a GPU for AllNLI-scale training.
