"""Model pixels retain coverage, thickness, registration and clean casing joins."""
import unittest
import door_assets


class DoorAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.images = {name: image for name, image, _, _ in door_assets.records()}

    def test_every_colour_sample_has_surface_depth(self):
        for name, colour in self.images.items():
            if name.endswith('Depth'):
                continue
            depth = self.images[name + 'Depth']
            covered = [(c, d) for c, d in zip(colour.getdata(), depth.getdata()) if c[3] >= 128]
            self.assertGreater(len(covered), 100, name)
            self.assertTrue(all(d[0] * 256 + d[1] > 0 for _, d in covered), name)
            if name.startswith('doorLeaf'):
                self.assertEqual(depth.getchannel('B').getextrema(), (0, 0), name)

    def test_threshold_is_a_floor_but_posts_and_header_are_not(self):
        for facing in range(4):
            name = f'doorFrame{facing}'
            colour, depth = self.images[name], self.images[name + 'Depth']
            covered = [(i, d) for i, (c, d) in enumerate(zip(colour.getdata(), depth.getdata())) if c[3] >= 128]
            floor = [i for i, d in covered if d[2] > 128]
            self.assertGreater(len(floor), 100)
            self.assertLess(len(floor), len(covered) / 4)
            self.assertTrue(all(i // colour.width > 220 for i in floor))

    def test_threshold_stays_between_casing_faces_and_posts(self):
        for facing in range(4):
            colour = self.images[f'doorFrame{facing}']
            depth = self.images[f'doorFrame{facing}Depth']
            checked = 0
            for i, (c, d) in enumerate(zip(colour.getdata(), depth.getdata())):
                if c[3] < 128 or d[2] < 128:
                    continue
                column = ((i % colour.width + .5) / 3 - 56) / 32
                total = (d[0] * 256 + d[1]) / 65535 * 4 - 2
                x, y = (total + column) / 2, (total - column) / 2
                x, y = [(x, y), (y, -x), (-x, -y), (-y, x)][facing]
                # One filtered contour texel may fall just outside the mesh.
                self.assertTrue(.408 <= x <= .592 and abs(y) <= .402, (facing, x, y))
                checked += 1
            self.assertGreater(checked, 100)

    def test_each_swing_has_nine_distinct_solid_silhouettes(self):
        for facing in range(4):
            masks = [self.images[f'doorLeaf{facing}_{phase}'].getchannel('A').point(lambda a: 255 if a >= 128 else 0) for phase in range(9)]
            self.assertEqual(len({mask.tobytes() for mask in masks}), 9)
            # Even edge-on poses contain a solid slab; they cannot disappear.
            for mask in masks:
                self.assertGreater(mask.histogram()[255], 500)

    def test_header_has_no_cross_lines_at_the_post_joints(self):
        image = self.images['doorFrame0']
        for y in (-.445, .445):
            for z in (1.78, 1.8, 1.82):
                col = round((56 + (.58 - y) * 32) * 3)
                row = round((99 + (.58 + y) * 21 - z * 38) * 3)
                self.assertGreater(min(image.getpixel((col, row))[:3]), 120, (y, z))


if __name__ == '__main__':
    unittest.main()
