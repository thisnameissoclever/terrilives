"""Export the visible landing relief, actual top triangles and corresponding sole policy together."""
from argparse import ArgumentParser
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE),str(HERE.parent/'furniture')]
from export_pool_fixture_v5 import run
from pool_activity_model_v6 import build, landing_outline

if __name__ == '__main__':
    parser = ArgumentParser()
    for field in ('baseline-fixture','motion','output'):
        parser.add_argument('--'+field, type=Path, required=True)
    run(parser.parse_args(sys.argv[sys.argv.index('--')+1:]), builder=build,
        model_source='outdoor/pool_activity_model_v6.py', landing_outline=landing_outline, producer=__file__)
