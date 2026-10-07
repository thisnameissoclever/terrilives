"""A narrow garment-join classification; skin folds and exterior patches still fail."""


def classify(part,materials,shirt_materials,join_valid,triangles,visibility):
    garment=(part in ('Relaxed shirt sleeve','Relaxed shirt sleeve.001') and materials==shirt_materials)
    buried=bool(triangles) and all(r['wholly_within_shirt_envelope'] and r['component_has_proximal_cap']
        and not r['component_has_distal_cap'] and not r['intersects_shirt_boundary'] for r in triangles)
    hidden=bool(visibility) and all(r['visible_projected_area']<=1e-14 for r in visibility)
    valid=garment and join_valid and buried and hidden
    return dict(valid=bool(valid),classification='buried garment surface in proved proximal attachment' if valid else 'true fold or unresolved attachment surface',
        garment_material=garment,proved_join=bool(join_valid),all_fold_triangles_buried=buried,all_required_views_hidden=hidden,
        scope='Only these indexed garment triangles in this evaluated join. No whole mesh, skin, source polygon name or invisible-camera exemption.')
