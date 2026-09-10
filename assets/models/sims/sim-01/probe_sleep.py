import bpy,json,traceback
from pathlib import Path

BASE=Path(__file__).resolve().parent


def main():
    assert bpy.app.background
    (BASE/'sleep-contact-probe.json').write_text(json.dumps({'state':'running'}))
    bpy.ops.wm.open_mainfile(filepath=str(BASE/'sim-01-rigged.blend'))
    rig=bpy.data.objects['SIM_01_SHARED_RIG']
    rig.animation_data.action=bpy.data.actions['sleep']
    bpy.context.scene.frame_set(1)
    result={'state':'complete'}
    pillow=[]
    for name in ('Overshirt body','Sculpted head','HAIR_01_TRIPO_CURL','Tailored trouser leg','Tailored trouser leg.001','Fitted rounded shoe sole','Fitted rounded shoe sole.001'):
        obj=bpy.data.objects[name].evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh=obj.to_mesh()
        vertices=[obj.matrix_world@v.co for v in mesh.vertices]
        result[name]=[[min(v[i] for v in vertices) for i in range(3)],[max(v[i] for v in vertices) for i in range(3)]]
        if name in ('Sculpted head','HAIR_01_TRIPO_CURL'):
            pillow.extend(v.z for v in vertices if .02<abs(v.x)<.25 and 1.16<v.y<1.30)
        obj.to_mesh_clear()
    result['pillow_overlap_min_z']=min(pillow) if pillow else None
    result['pillow_top_z']=.52*1.112844
    result['mattress_top_z']=.42*1.112844
    (BASE/'sleep-contact-probe.json').write_text(json.dumps(result,indent=2))


if __name__=='__main__':
    try:
        main()
    except Exception:
        (BASE/'sleep-contact-probe.json').write_text(json.dumps({'state':'failed','traceback':traceback.format_exc()},indent=2))
        raise
