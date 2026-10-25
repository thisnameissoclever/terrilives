"""Activity garments reuse the skin's rig and existing saved color channels."""
import bpy
from author_parts import copy_part,trim_at_height,warp,rules,curve

def author(rig):
    pieces=[]
    for side in ['L','R']:
        source=bpy.data.objects['Creator bare leg '+side]
        obj=copy_part(source,'Creator pool trunks '+side,bpy.data.materials['Slate cotton trousers'],region=3)
        trim_at_height(obj,.64,False)
        sign=-1 if side=='L' else 1
        warp(obj,lambda p:(sign*.124+(p.x-sign*.124)*1.06,p.y*1.06,p.z))
        rules(obj,{'swimwear':['trunks']});pieces.append(obj)
    for style,material,low in [('trunks','Slate cotton trousers',.76),('two_piece','Washed sage overshirt',.80)]:
        obj=copy_part(bpy.data.objects['Creator bare hips'],'Creator pool '+style+' waist',bpy.data.materials[material],region=3)
        warp(obj,lambda p:(p.x*1.04,p.y*1.04,p.z))
        trim_at_height(obj,low,False);rules(obj,{'swimwear':[style]});pieces.append(obj)
    obj=copy_part(bpy.data.objects['Creator bare torso'],'Creator pool two_piece top',bpy.data.materials['Washed sage overshirt'],region=2)
    warp(obj,lambda p:(p.x*1.025,p.y*1.04,p.z))
    trim_at_height(obj,1.10,False);trim_at_height(obj,1.30,True)
    rules(obj,{'swimwear':['two_piece']});pieces.append(obj)
    for sign in [-1,1]:
        obj=curve('Creator pool shoulder strap '+str(sign),[(sign*.15,-.12,1.25),(sign*.15,-.06,1.37),(sign*.15,.08,1.31),(sign*.15,.12,1.22)],
            .016,bpy.data.materials['Washed sage overshirt'],rig,bone='spine',region=2)
        rules(obj,{'swimwear':['two_piece']});pieces.append(obj)
    return pieces
