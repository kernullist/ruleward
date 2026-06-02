"""
Export the fine-tuned model to ONNX laid out for transformers.js.
  python training/export_onnx.py
Uses optimum.onnxruntime (export-on-load), then arranges model.onnx under onnx/.
Point ruleward at it:  RULEWARD_NLI_MODEL=<abs path to training/finetuned-nli-onnx>
"""
import os
import shutil

from transformers import AutoTokenizer
from optimum.onnxruntime import ORTModelForSequenceClassification

SRC = os.environ.get("OUT_DIR", "training/finetuned-nli")
DST = os.environ.get("ONNX_DIR", "training/finetuned-nli-onnx")

model = ORTModelForSequenceClassification.from_pretrained(SRC, export=True)
model.save_pretrained(DST)
AutoTokenizer.from_pretrained(SRC).save_pretrained(DST)

# transformers.js looks for an onnx/ subdir
onnx_sub = os.path.join(DST, "onnx")
os.makedirs(onnx_sub, exist_ok=True)
for name in list(os.listdir(DST)):
    if name.endswith(".onnx") or name.endswith(".onnx_data"):
        shutil.move(os.path.join(DST, name), os.path.join(onnx_sub, name))

print("ONNX ready ->", os.path.abspath(DST))
print("onnx/ contents:", os.listdir(onnx_sub))
