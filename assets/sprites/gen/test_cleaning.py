"""Cleaning export provenance, real motion and complete runtime registration."""
import hashlib
import json
from pathlib import Path
import unittest

from PIL import Image
from offline_cleaning import load_cleaning

ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'assets/models/cleaning'


class CleaningTests(unittest.TestCase):
    def test_mop_grips_enclose_the_actual_shaft_and_sleeve(self):
        proof=json.loads((BASE/'export/proof.json').read_text())
        self.assertTrue('grip_contracts' in proof,'Point alignment cannot prove a closed grip')
        for side,radius in [('L',.014),('R',.023)]:
            grip=proof['grip_contracts'][side]
            self.assertEqual(grip['covered_degrees'],360)
            self.assertEqual(grip['shaft_radius'],radius)
            self.assertGreaterEqual(grip['minimum_skin_radius'],radius-.001)
            self.assertLessEqual(grip['maximum_contact_gap'],.0025)

    def test_eyes_keep_visible_whites_and_approved_outline_width(self):
        proof=json.loads((BASE/'export/proof.json').read_text())
        self.assertTrue('appearance' in proof,'Cleaning rendered at quarter density without scaling the outline')
        appearance=proof['appearance']
        for row in appearance['outline_styles']:
            self.assertAlmostEqual(row['reference_thickness']/appearance['reference_density'],
                                   row['render_thickness']/appearance['render_density'])
        self.assertTrue(appearance['outline_groups']['Hair outline selection'])
        checked=0
        for variant in ('green','blue','red'):
            data=json.loads((BASE/f'export/{variant}/manifest.json').read_text())
            for row in data['frames']:
                if row['action']!='mop' or row['facing'] not in ('SE','SW'):continue
                image=Image.open(BASE/'export'/variant/row['path']).convert('RGBA')
                bright=0
                for box in row['eye_boxes']:
                    crop=image.crop(tuple(round(value*2) for value in box))
                    bright+=sum(min(r,g,b)>=170 and a>=220 for r,g,b,a in crop.get_flattened_data())
                self.assertGreaterEqual(bright,1,(variant,row['name'],'eye whites are covered by ink'))
                checked+=1
        self.assertEqual(checked,48)

    def test_complete_bake_keeps_rig_and_palette_geometry(self):
        proof=json.loads((BASE/'export/proof.json').read_text())
        self.assertEqual(proof['state'],'complete')
        self.assertEqual(len(proof['renders']),368)
        original=ROOT/'assets/models/sims/sim-01/sim-01-rigged.blend'
        self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(),
                         proof['inputs']['sims/sim-01/sim-01-rigged.blend'])
        geometry={}
        for row in proof['renders']:
            if row['variant']=='bin':continue
            key=(row['action'],row['facing'],row['frame'])
            geometry.setdefault(key,set()).add(row['geometry_sha256'])
        self.assertEqual(len(geometry),112)
        self.assertTrue(all(len(hashes)==1 for hashes in geometry.values()))

    def test_all_clips_have_distinct_pixels_and_registered_contacts(self):
        exports,extras,anchors,support=load_cleaning(BASE/'export/manifest.json')
        self.assertEqual(len(extras),112)
        self.assertEqual(len(support),240)
        for export in exports:
            for action,count in [('mop',8),('wipe_counter',6),('wipe_table',6),('empty_bin',8)]:
                for facing in ['SE','NW','SW','NE']:
                    rows=[(name,frame) for name,frame in export.frames.items()
                          if frame['action']==action and frame['facing']==facing]
                    self.assertEqual(len(rows),count)
                    hashes=set()
                    for name,row in rows:
                        image=Image.open(BASE/'export'/export.variant/row['path'])
                        hashes.add(hashlib.sha256(image.tobytes()).hexdigest())
                        bounds=image.getchannel('A').getbbox()
                        self.assertIsNotNone(bounds)
                        self.assertGreater(bounds[0],0);self.assertGreater(bounds[1],0)
                        self.assertLess(bounds[2],image.width);self.assertLess(bounds[3],image.height)
                        if action!='mop':self.assertIn(name,support)
                    self.assertEqual(len(hashes),count)
        for facing in ['SE','NW','SW','NE']:
            closed=Image.open(BASE/f'export/bin/bin-{facing}-0.png').tobytes()
            opened=Image.open(BASE/f'export/bin/bin-{facing}-3.png').tobytes()
            self.assertNotEqual(closed,opened)
            self.assertEqual(closed,Image.open(BASE/f'export/bin/bin-{facing}-7.png').tobytes())


if __name__=='__main__':unittest.main()
