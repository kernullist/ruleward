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

## Caveats / improving precision further

- 340 synthetic pairs alone overfit the templates — mix in SNLI + MNLI ("AllNLI").
- The residual FP ("unit tests" vs "integration tests") needs more testing-topic
  pairs in the generator (`src/semantic/finetune-data.ts`).
- Validate on the real corpus (`npm run bench:real`) before promoting the tier
  out of "experimental", and prefer a GPU for AllNLI-scale training.
