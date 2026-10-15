"""Export all published aquarium frames with their original color registration."""
from pathlib import Path
import sys

BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE))
import export_static_depth as exporter

exporter.OUT=BASE/'aquarium-depth'
exporter.CATALOGS=['static-props-05.json','static-props-06.json']
exporter.INCLUDE_CORE=False
exporter.main()
