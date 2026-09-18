"""Deliberately break a loaded sink scene; never save the mutated model."""
import hashlib
import json
from pathlib import Path
import sys

import bpy

sys.path.insert(0,str(Path(__file__).resolve().parent))
from check_counter_scene import check, validate_scene


def fill_opening():
    obj = bpy.data.objects['Cream worktop']
    vertices = [tuple(v.co) for v in obj.data.vertices]
    faces = [tuple(p.vertices) for p in obj.data.polygons]
    faces.append(tuple(range(72,108)))
    replacement = bpy.data.meshes.new('Deliberately capped worktop')
    replacement.from_pydata(vertices,[],faces)
    replacement.update()
    obj.data = replacement


def flatten_basin():
    for vertex in bpy.data.objects['Recessed steel basin'].data.vertices:
        vertex.co.z = .867
    bpy.data.objects['Recessed steel basin'].data.update()


def move_faucet():
    bpy.data.objects['Sink curved faucet'].location.x += .8


def detach_handle():
    bpy.data.objects['Cabinet handle'].location.y -= .2


def float_drain():
    bpy.data.objects['Sink drain'].location.z += .1


def float_flange():
    bpy.data.objects['Faucet mounting flange'].location.z += .1


def float_lever_base():
    bpy.data.objects['Faucet lever base'].location.z += .1


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2:
        raise ValueError('Pass a saved sink model and a new result JSON path after --')
    model,output = map(Path,args)
    if output.exists():
        raise ValueError('Probe result must use a new path')
    digest = hashlib.sha256(model.read_bytes()).hexdigest()
    rows = []
    try:
        for label,mutate,expected in (
            ('capped opening',fill_opening,'Sink opening is capped'),
            ('flat basin',flatten_basin,'Sink floor or outlet drainage changed'),
            ('displaced faucet',move_faucet,'Sink floor or outlet drainage changed'),
            ('detached handle',detach_handle,'Handle grip detached from mount'),
            ('floating drain',float_drain,'Drain is detached from bowl floor'),
            ('floating flange',float_flange,'Faucet mounting flange is detached from worktop'),
            ('floating lever base',float_lever_base,'Faucet lever base is detached from worktop'),
        ):
            check(model)
            mutate()
            try:
                validate_scene()
            except AssertionError as error:
                assert expected == str(error), f'{label}: unrelated assertion: {error}'
                rows.append({'mutation':label,'caught':str(error)})
            else:
                raise AssertionError(f'Mutation survived: {label}')
        clean = check(model)
        assert hashlib.sha256(model.read_bytes()).hexdigest() == digest, 'Saved model changed'
        output.write_text(json.dumps({'state':'passed','mutations':rows,
                                      'model_sha256':digest,'clean':clean},indent=2)+'\n')
    except Exception as error:
        output.write_text(json.dumps({'state':'failed','error':str(error),
                                      'completed':rows},indent=2)+'\n')
        raise
