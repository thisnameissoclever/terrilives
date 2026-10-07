# Reading artwork authoring tests

These tests exercise the stock coefficient authoring code. Run them with the existing artist Python environment, which includes NumPy through Blender's toolchain:

```sh
python -m unittest discover -s assets/models/reading/tests -p 'test_*.py'
```

The shipped atlas importer uses Pillow and the Python standard library. Its importer, coverage, scene and reconstruction tests remain in `assets/sprites/gen` and run in the normal asset checks. Authoring and import tests both verify the signed coefficient format; no authoring package is required to build the game from its checked-in exports.
