"""Export the outdoor depth page used before the rectangular pool was added."""
from pathlib import Path
import sys

BASE=Path(__file__).resolve().parent
if (BASE.parents[1]/'static-props-08.json').exists():
    raise SystemExit('Use export_pool_depth_v9.py and pack_pool_depth_v9.py to update the current pool depth.')

sys.path.insert(0,str(BASE))
import export_static_depth as exporter

exporter.OUT=BASE/'outdoor-depth'
exporter.CATALOGS=['static-props-07.json']
exporter.INCLUDE_CORE=False
exporter.main()
