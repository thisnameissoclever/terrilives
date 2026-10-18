"""Export the pool, pool lounger and patio umbrella with their original color registration."""
from pathlib import Path
import sys

BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE))
import export_static_depth as exporter

exporter.OUT=BASE/'outdoor-depth'
exporter.CATALOGS=['static-props-07.json']
exporter.INCLUDE_CORE=False
exporter.main()
