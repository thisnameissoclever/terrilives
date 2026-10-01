"""Bookcase geometry must rotate around its own tile, with its back on an edge."""
import unittest
from unittest.mock import patch
import bookcase
from iso import canvas, emit, facing_aabb

class BookcaseTests(unittest.TestCase):
    def test_back_touches_each_tile_edge(self):
        expected = {"se": (0, -.5), "sw": (1, -.5), "nw": (2, .5), "ne": (3, .5)}
        for facing, (axis, edge) in expected.items():
            parts = []
            image, drawing = canvas()
            original = bookcase.box
            def record(d, *args, **kwargs):
                parts.append((args, kwargs["facing"]))
                return original(d, *args, **kwargs)
            with patch.object(bookcase, "box", side_effect=record):
                bookcase.draw(drawing, facing)
            back, actual = next(p for p in parts if p[0][:4] == (-.5, -.43, -.44, .43))
            self.assertEqual(actual, facing)
            bounds = facing_aabb(*back[:4], actual)
            self.assertAlmostEqual(bounds[axis], edge)
            for part, actual in parts:
                self.assertEqual(actual, facing)
                self.assertTrue(all(-.5 <= x <= .5 for x in facing_aabb(*part[:4], actual)))
            self.assertIsNotNone(emit(image)[0].getbbox())

    def test_four_distinct_facings(self):
        pictures = []
        for facing in ("se", "sw", "nw", "ne"):
            image, drawing = canvas()
            bookcase.draw(drawing, facing)
            pictures.append(image.tobytes())
        self.assertEqual(len(set(pictures)), 4)

if __name__ == "__main__":
    unittest.main()
