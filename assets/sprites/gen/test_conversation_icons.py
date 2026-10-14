"""Conversation glyphs keep speech, topic and reaction in distinct regions."""
import unittest
import json
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from conversation_icons import conversation_image, render_icons, load_reviewed_icons


class ConversationIconTests(unittest.TestCase):
    def test_speech_topic_and_reaction_change_independently(self):
        reading = conversation_image('read', True)
        exercise = conversation_image('exercise', True)
        disliked = conversation_image('read', False)
        self.assertEqual(reading.size, (84, 84))
        self.assertEqual(reading.getpixel((4, 4))[3], 0)
        speech = (6, 12, 42, 48)
        topic = (42, 12, 78, 48)
        reaction = (28, 48, 56, 76)
        self.assertEqual(reading.crop(speech).tobytes(), exercise.crop(speech).tobytes())
        self.assertNotEqual(reading.crop(topic).tobytes(), exercise.crop(topic).tobytes())
        self.assertEqual(reading.crop(topic).tobytes(), disliked.crop(topic).tobytes())
        self.assertNotEqual(reading.crop(reaction).tobytes(), disliked.crop(reaction).tobytes())
        for box in (speech, topic, reaction):
            region = reading.crop(box)
            ink = sum(1 for r, g, b, a in
                      (region.getpixel((x, y)) for y in range(region.height) for x in range(region.width))
                      if a > 200 and max(r, g, b) < 100)
            self.assertGreater(ink, 15)
        self.assertEqual(reading.getpixel((42, 46)), (242, 238, 230, 255))

    def test_each_supported_topic_has_both_reactions(self):
        sprites = render_icons()
        self.assertEqual(len(sprites), 40)
        self.assertEqual(len({name for name, *_ in sprites}), 40)
        self.assertEqual(len({image.tobytes() for _, image, *_ in sprites}), 40)

    def test_reviewed_extension_is_registered_and_rejects_pixel_changes(self):
        from offline_architecture import load_historical_extensions
        root = Path(__file__).resolve().parents[3]
        config = json.loads((root / 'assets/models/architecture/architecture.json').read_text())
        extension = [row for row in config['historicalExtensions'] if row.get('kind') == 'conversation-icons']
        self.assertEqual(len(extension), 1)
        sprites = load_historical_extensions({'historicalExtensions': extension})
        self.assertEqual(len(sprites), 40)
        name, image, width, height = sprites[0]
        image.putpixel((42, 42), (0, 0, 0, 255))
        changed = [(name, image, width, height), *sprites[1:]]
        with patch('conversation_icons.render_icons', return_value=changed):
            with self.assertRaisesRegex(ValueError, 'pixels changed'):
                load_reviewed_icons(root / extension[0]['catalog'])
        sprites = render_icons()
        name, image, width, height = sprites[0]
        reshaped = Image.frombytes('RGBA', (42, 168), image.tobytes())
        with patch('conversation_icons.render_icons', return_value=[(name, reshaped, width, height), *sprites[1:]]):
            with self.assertRaisesRegex(ValueError, 'dimensions changed'):
                load_reviewed_icons(root / extension[0]['catalog'])


if __name__ == '__main__':
    unittest.main()
