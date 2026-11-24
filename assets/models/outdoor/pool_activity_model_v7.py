"""Build the square pool with a 48 cm turning landing and a wider ladder opening."""
from pool_activity_model_v4 import build as build_pool
import pool_activity_layout_v7 as layout


def build(root):
    return build_pool(root, layout, coping_bevel=.003)
