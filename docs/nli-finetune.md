# NLI fine-tuning (`conflict/nli-contradiction`)

The opt-in semantic-conflict tier uses a zero-shot NLI model
(`Xenova/nli-deberta-v3-base`). Its baseline precision is ~71% (`npm run bench:nli`):
rule files are **imperatives**, which are off-distribution for an MNLI-trained
model, so it over-predicts contradiction on same-topic-but-compatible rules.
Fine-tuning on rule-style pairs closes that gap. (This is why the tier ships
opt-in + `info` only.)

## 1. Generate training pairs

```bash
npm run nli:gen-data   # → corpus/nli-pairs.jsonl   {premise, hypothesis, label}
```

Pairs are synthesized from the settingKV ontology:

- same key, different value → `contradiction` ("Use tabs." ⟂ "Use spaces.")
- same value, different phrasing → `entailment`
- different key → `neutral`

Mix these with a general NLI corpus (SNLI + MNLI = "AllNLI") so the model keeps
its base NLI ability instead of overfitting to the templates.

## 2. Fine-tune (offline, Python)

```python
from sentence_transformers import CrossEncoder, InputExample
from torch.utils.data import DataLoader

label2id = {"contradiction": 0, "entailment": 1, "neutral": 2}
# load corpus/nli-pairs.jsonl + AllNLI → List[InputExample(texts=[premise, hypothesis], label=label2id[...])]
model = CrossEncoder("cross-encoder/nli-deberta-v3-base", num_labels=3)
model.fit(DataLoader(train, batch_size=16, shuffle=True), epochs=2, warmup_steps=...)
# evaluate on a held-out split; track precision on the compatible-but-same-topic pairs.
```

## 3. Export to ONNX and wire in

```bash
optimum-cli export onnx --model ./finetuned-nli ./onnx-nli   # 🤗 Optimum
```

Point ruleward at the exported model (the `MODEL` constant in
`src/semantic/nli.ts`, ideally promoted to a config option), then re-run
`npm run bench:nli` and the real-corpus eval. Only flip the tier from
"experimental" once precision is comfortably above the zero-shot baseline.
