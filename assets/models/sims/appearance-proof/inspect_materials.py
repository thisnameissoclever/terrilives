from pathlib import Path
import bpy,json
base=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(base.parent/'sim-01/sim-01-rigged.blend'))
rows={m.name:[dict(interpolation=n.color_ramp.interpolation,mode=n.color_ramp.color_mode) for n in m.node_tree.nodes if n.type=='VALTORGB'] for m in bpy.data.materials if m.use_nodes}
(base/'export-v2/material-ramp-source.json').write_text(json.dumps(rows,indent=2))
