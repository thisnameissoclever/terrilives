"""Render geometry-owned hand/tool masks for complementary surface-depth draws."""
import hashlib,json,sys,traceback
from pathlib import Path
import bpy

BASE=Path(__file__).resolve().parent
SIM=BASE.parent/'sims/sim-01'
sys.path.insert(0,str(SIM))
from render_job import apply_render_job


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    assert bpy.app.background
    raw=BASE/'raw';out=BASE/'contacts';out.mkdir(exist_ok=False)
    complete=json.loads((raw/'proof.json').read_text());assert complete['state']=='complete'
    proof={'state':'running','model_sha256':digest(raw/'cleaning.blend'),
           'producer_sha256':digest(Path(__file__)),'renders':[]}
    receipt=out/'proof.json'
    def save():receipt.write_text(json.dumps(proof,indent=2)+'\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(raw/'cleaning.blend'))
        scene=bpy.context.scene;rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
        body=bpy.data.collections['Cleaning body'];tools=bpy.data.collections['Cleaning tools']
        bpy.data.collections['Cleaning bin scene'].hide_render=True
        names={name+suffix for name in ('Relaxed palm','Resting thumb','Forearm with elbow and wrist sections','Turned sleeve cuff') for suffix in ('','.001')}
        proof['support_objects']=sorted(names)
        for name in names:
            obj=bpy.data.objects[name];body.objects.unlink(obj);tools.objects.link(obj)
        layer=bpy.context.view_layer
        layer.layer_collection.children[body.name].holdout=True
        layer.layer_collection.children[tools.name].holdout=False
        scene.render.use_freestyle=False;scene.use_nodes=False
        scene.render.threads_mode='FIXED';scene.render.threads=2
        registration=json.loads((raw/'green/manifest.json').read_text())['clips']
        for action in ['wipe_counter','wipe_table','empty_bin']:
            for facing in ['SE','NW','SW','NE']:
                for frame in range(registration[action]['frame_count']):
                    apply_render_job(scene,rig,registration,action,facing,frame)
                    scene.render.resolution_x=384;scene.render.resolution_y=512
                    path=out/f'{action}-{facing}-{frame}.png';scene.render.filepath=str(path)
                    bpy.ops.render.render(write_still=True)
                    proof['renders'].append({'action':action,'facing':facing,'frame':frame,'path':path.name,'sha256':digest(path)});save()
        assert len(proof['renders'])==80
        proof['state']='complete';save()
    except Exception:
        proof['state']='failed';proof['error']=traceback.format_exc();save();raise


if __name__=='__main__':main()
