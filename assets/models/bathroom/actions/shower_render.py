"""Action-local line selection: opaque steam occludes but never owns dark ink."""
import json

STROKE_COLLECTION = 'Shower outlined fixture and water'
BODY_PREFIX = 'Shower body strokes '
FIXTURE_PREFIX = 'Shower fixture and water strokes '
OWNERS = ('beauty', 'lines', 'sim', 'furniture', 'sim_lines', 'furniture_lines')


def source_receipt_equal(actual, saved):
    """Normalize only JSON container types; retain exact numeric and array equality."""
    return json.loads(json.dumps(actual, allow_nan=False)) == saved


def expected_strokes(owner, body_names, furniture_names, steam_names):
    if owner not in OWNERS or not set(steam_names) <= set(furniture_names):
        raise ValueError('Invalid shower stroke owner or steam inventory')
    body, fixture = set(body_names), set(furniture_names)-set(steam_names)
    if body & set(steam_names):
        raise ValueError('Steam cannot be body-owned geometry')
    if owner in ('sim', 'sim_lines'):
        return body
    if owner in ('furniture', 'furniture_lines'):
        return fixture
    return body | fixture


def validate_stroke_selection(actual, expected, steam_names):
    if set(actual) & set(steam_names):
        raise ValueError('Steam outline selection restored')
    if set(actual) != set(expected):
        raise ValueError('Shower stroke ownership changed')


def _copy_selection(source, target):
    ignored = {'rna_type', 'name', 'collection', 'linestyle', 'select_by_collection',
               'collection_negation', 'show_render'}
    copied = {}
    for prop in source.bl_rna.properties:
        name = prop.identifier
        if name in ignored or prop.is_readonly:
            continue
        if prop.type not in ('BOOLEAN', 'ENUM', 'INT', 'FLOAT', 'STRING'):
            raise ValueError(f'Unhandled source line-set setting: {name}/{prop.type}')
        value = getattr(source, name)
        setattr(target, name, value)
        copied[name] = value
    target.linestyle = source.linestyle
    return copied


def install(scene, body, furniture, steam_names):
    import bpy
    visible_before = {obj.name:bool(obj.hide_render) for c in (body, furniture) for obj in c.all_objects}
    members_before = {c.name:sorted(obj.name for obj in c.all_objects) for c in (body, furniture)}
    strokes = bpy.data.collections.new(STROKE_COLLECTION)
    furniture.children.link(strokes)
    outlined = set(furniture.all_objects)-{bpy.data.objects[name] for name in steam_names}
    for obj in outlined:
        if obj.type not in ('MESH', 'CURVE'):
            raise ValueError('Unhandled outlined fixture geometry')
        for collection in list(obj.users_collection):
            if collection != furniture:
                raise ValueError('Unexpected existing shower fixture collection ownership')
            collection.objects.unlink(obj)
        strokes.objects.link(obj)
    linesets = bpy.context.view_layer.freestyle_settings.linesets
    original = list(linesets)
    if not original:
        raise ValueError('Accepted source has no Freestyle line sets')
    copied = {}
    for i, source in enumerate(original, 1):
        fixture = linesets.new(FIXTURE_PREFIX+str(i).zfill(2))
        copied[source.name] = _copy_selection(source, fixture)
        source.name = BODY_PREFIX+str(i).zfill(2)
        source.collection = body
        fixture.collection = strokes
        for lines in (source, fixture):
            lines.select_by_collection = True
            lines.collection_negation = 'INCLUSIVE'
            lines.show_render = True
    bpy.context.view_layer.update()
    if visible_before != {obj.name:bool(obj.hide_render) for c in (body, furniture) for obj in c.all_objects}:
        raise ValueError('Stroke setup changed render visibility')
    if members_before != {c.name:sorted(obj.name for obj in c.all_objects) for c in (body, furniture)}:
        raise ValueError('Stroke setup changed reciprocal geometry ownership')
    return dict(excluded_steam=sorted(steam_names), outlined_body=sorted(obj.name for obj in body.all_objects if not obj.hide_render),
                outlined_fixture_water=sorted(obj.name for obj in strokes.all_objects if not obj.hide_render),
                copied_source_selection_settings=copied,
                source_line_styles=[dict(name=lines.linestyle.name, colour=list(lines.linestyle.color),
                                        thickness=lines.linestyle.thickness) for lines in original],
                ordinary_geometry_occlusion_preserved=True, hidden_render_ownership_preserved=True,
                stroke_collection_parent=furniture.name)


def configure(scene, body, furniture, owner, steam_names):
    import bpy
    if owner not in OWNERS:
        raise ValueError('Unknown shower render owner')
    layer = bpy.context.view_layer
    layer.layer_collection.children[body.name].holdout = owner == 'furniture'
    layer.layer_collection.children[furniture.name].holdout = owner == 'sim'
    for lines in layer.freestyle_settings.linesets:
        if lines.name.startswith(BODY_PREFIX):
            lines.collection = body
            lines.show_render = owner not in ('furniture', 'furniture_lines')
        elif lines.name.startswith(FIXTURE_PREFIX):
            lines.collection = bpy.data.collections[STROKE_COLLECTION]
            lines.show_render = owner not in ('sim', 'sim_lines')
        else:
            raise ValueError('Unmanaged shower line set could restore steam outlines')
        lines.select_by_collection = True
        lines.collection_negation = 'INCLUSIVE'
    ink = owner in ('lines', 'sim_lines', 'furniture_lines')
    scene.render.use_freestyle = ink or owner == 'beauty'
    layer.freestyle_settings.as_render_pass = ink
    scene.use_nodes = ink
    if ink:
        tree = scene.node_tree
        tree.nodes.clear()
        source = tree.nodes.new('CompositorNodeRLayers')
        output = tree.nodes.new('CompositorNodeComposite')
        tree.links.new(source.outputs['Freestyle'], output.inputs['Image'])
    return inventory(scene, body, furniture, owner, steam_names)


def inventory(scene, body, furniture, owner, steam_names):
    import bpy
    actual, settings = set(), []
    for lines in bpy.context.view_layer.freestyle_settings.linesets:
        if not lines.select_by_collection or lines.collection_negation != 'INCLUSIVE' or lines.collection is None:
            raise ValueError('Explicit shower line collection selection changed')
        selected = {obj.name for obj in lines.collection.all_objects if not obj.hide_render}
        if lines.show_render:
            actual |= selected
        settings.append(dict(name=lines.name, enabled=lines.show_render, select_by_collection=True,
                             collection=lines.collection.name, collection_negation=lines.collection_negation,
                             visible_selected_geometry=sorted(selected)))
    expected = expected_strokes(owner, {o.name for o in body.all_objects if not o.hide_render},
                                {o.name for o in furniture.all_objects if not o.hide_render}, steam_names)
    validate_stroke_selection(actual, expected, steam_names)
    return dict(owner=owner, enabled_stroke_geometry=sorted(actual), excluded_steam=sorted(steam_names),
                linesets=settings, use_freestyle=scene.render.use_freestyle,
                geometry_occlusion='All opaque geometry remains in the same body/furniture parent collections')


def negative_control(scene, body, furniture, steam_names):
    import bpy
    configure(scene, body, furniture, 'beauty', steam_names)
    lines = next(lines for lines in bpy.context.view_layer.freestyle_settings.linesets
                 if lines.name.startswith(FIXTURE_PREFIX))
    original = lines.collection
    try:
        lines.collection = furniture
        try:
            inventory(scene, body, furniture, 'beauty', steam_names)
        except ValueError as failure:
            if str(failure) != 'Steam outline selection restored':
                raise
            return dict(control='restored-steam-dark-outlines', caught=str(failure),
                        selected_steam=sorted(steam_names))
        raise ValueError('Steam-outline restoration negative control survived')
    finally:
        lines.collection = original
        configure(scene, body, furniture, 'beauty', steam_names)


def render_pass(scene, body, furniture, owner, path, steam_names):
    import bpy
    record = configure(scene, body, furniture, owner, steam_names)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    inventory(scene, body, furniture, owner, steam_names)
    return record
