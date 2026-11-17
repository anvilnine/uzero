#!/usr/bin/env python3
"""Resize the approved icon; requires local Pillow. No network or new artwork."""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
source = Image.open(ROOT / 'design/icon/final/uzero-1024.png').convert('RGBA')
icons = ROOT / 'safari/Shared (App)/Assets.xcassets/AppIcon.appiconset'
for slot in json.loads((icons / 'Contents.json').read_text())['images']:
    pixels = round(float(slot['size'].split('x')[0]) * float(slot.get('scale', '1x')[:-1]))
    image = source.resize((pixels, pixels), Image.Resampling.LANCZOS)
    if slot['idiom'] == 'universal':
        paper = Image.new('RGBA', image.size, '#F7F3EE')
        paper.alpha_composite(image)
        image = paper.convert('RGB')
    image.save(icons / slot['filename'])
source.resize((192, 192), Image.Resampling.LANCZOS).save(ROOT / 'safari/Shared (App)/Resources/Icon.png')
