"""
NLI fine-tune (FROZEN §5) — corpus/nli-pairs.jsonl로 cross-encoder를 가볍게 fine-tune.
base의 NLI 헤드를 이어 학습(라벨 순서 동일: 0=contradiction,1=entailment,2=neutral).
CPU에서 수분(데이터 작음). 산출물 = HF 모델 디렉토리(이후 optimum으로 ONNX export).

  python training/finetune_nli.py
환경변수: BASE_MODEL(기본 cross-encoder/nli-deberta-v3-base), OUT_DIR, EPOCHS
"""
import json
import os
import random

from torch.utils.data import DataLoader
from sentence_transformers import InputExample
from sentence_transformers.cross_encoder import CrossEncoder
from sentence_transformers.cross_encoder.evaluation import CESoftmaxAccuracyEvaluator

LABEL2ID = {"contradiction": 0, "entailment": 1, "neutral": 2}
BASE = os.environ.get("BASE_MODEL", "cross-encoder/nli-deberta-v3-base")
OUT = os.environ.get("OUT_DIR", "training/finetuned-nli")
EPOCHS = int(os.environ.get("EPOCHS", "4"))
DATA = "corpus/nli-pairs.jsonl"

examples = []
with open(DATA, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        o = json.loads(line)
        examples.append(InputExample(texts=[o["premise"], o["hypothesis"]], label=LABEL2ID[o["label"]]))

random.seed(0)
random.shuffle(examples)
n_dev = max(20, len(examples) // 10)
dev, train = examples[:n_dev], examples[n_dev:]
print(f"loaded {len(examples)} pairs → train {len(train)}, dev {len(dev)}; base={BASE}")

model = CrossEncoder(BASE, num_labels=3)  # base의 3-class NLI 헤드 이어 학습
loader = DataLoader(train, shuffle=True, batch_size=16)
evaluator = CESoftmaxAccuracyEvaluator.from_input_examples(dev, name="dev")

print(f"dev accuracy (before): {evaluator(model):.3f}")
model.fit(
    train_dataloader=loader,
    evaluator=evaluator,
    epochs=EPOCHS,
    warmup_steps=20,
    output_path=OUT,
    show_progress_bar=True,
)
print(f"dev accuracy (after):  {evaluator(model):.3f}")
print(f"saved → {OUT}")
