"""Reproduce the approved exporter into a separate creator authoring directory."""
import json
from pathlib import Path
import sys
import traceback

BASE=Path(__file__).resolve().parent
sys.dont_write_bytecode=True
sys.path.insert(0,str(BASE.parent/'appearance-proof'))
import export_bundle

export_bundle.OUT=BASE/'baseline'
export_bundle.OUT.mkdir(parents=True,exist_ok=True)
try:
    (export_bundle.OUT/'status.json').write_text(json.dumps({'state':'running'}))
    export_bundle.run()
except Exception:
    (export_bundle.OUT/'status.json').write_text(json.dumps({'state':'failed','error':traceback.format_exc()}))
    raise
