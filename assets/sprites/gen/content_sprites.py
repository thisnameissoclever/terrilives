"""Project the required sprite scalar for art imports; Rust validates full content."""


def indexed(rows, kind):
    result = {}
    for row in rows:
        identity = row.get('id')
        if not isinstance(identity, str) or not identity or identity in result:
            raise ValueError(f'Missing or duplicate {kind} identity: {identity}')
        result[identity] = row
    return result


def sprite_layer(inherited, row):
    operation = row.get('properties', {}).get('sprite', {})
    # Match hierarchy.rs Operation<String>::scalar for this required field.
    # Replacement is a collection operation; a sprite can only be set or inherited.
    if not isinstance(operation, dict) or set(operation) - {'set'}:
        raise ValueError(f'Invalid required sprite operation on {row["id"]}')
    value = operation.get('set', inherited)
    if value is not None and not isinstance(value, str):
        raise ValueError(f'Sprite must be a string on {row["id"]}')
    return value


def parent(rows, identity, context):
    if identity not in rows:
        raise ValueError(f'Unknown {context}: {identity}')
    return rows[identity]


def model_sprites(content):
    """Return stable model IDs mapped to their inherited sprite names."""
    result = {}
    for identity, row in indexed(content.get('object', []), 'object').items():
        if not isinstance(row.get('sprite'), str):
            raise ValueError(f'Missing required sprite on {identity}')
        result[identity] = row['sprite']
    categories = indexed(content.get('category', []), 'category')
    types = indexed(content.get('object_type', []), 'type')
    category_sprites = {identity: sprite_layer(None, row) for identity, row in categories.items()}
    type_sprites = {}
    for identity, row in types.items():
        category = parent(categories, row.get('category'), 'category')
        type_sprites[identity] = sprite_layer(category_sprites[category['id']], row)
    for identity, row in indexed(content.get('model', []), 'model').items():
        physical_type = parent(types, row.get('object_type'), 'type')
        sprite = sprite_layer(type_sprites[physical_type['id']], row)
        if identity in result:
            raise ValueError(f'Duplicate model identity: {identity}')
        if sprite is None:
            raise ValueError(f'Missing required sprite on {identity}')
        result[identity] = sprite
    return result
