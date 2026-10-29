"""Build public/fonts/app-sans-{jp,sc,tc,kr}.woff2 from Noto Sans JP, SC, TC and KR (variable).

Latin and CJK glyphs share one baseline, but they are drawn about a different height above it: Latin text,
Segoe UI, looks centred 0.300em above the baseline (half way between its cap height and x-height,
(1434 + 1024) / 4 / 2048), and Noto Sans CJK about 0.37em. Each copy here moves every outline down by its
own difference, measured on the interface text of its language (kanji, kana and hangul weighted by how often
they appear; punctuation sits low in its em box by design and is left out), so the two scripts share one
centre, and public/boot.css sets Segoe UI's metrics so that centre is the middle of the line box. The four
fonts share one design, so Japanese, Chinese and Korean text mixed in one line stay aligned too.

Each copy is subset to its language's legacy character set (Windows-31J, GB2312, Big5, and KS X 1001 with
every modern hangul syllable) and keeps the weight axis. Noto Sans CJK is licensed under the SIL Open Font
License 1.1 with the Reserved Font Name 'Source', so the modified copies are named App Sans JP, SC, TC and KR;
public/fonts/LICENSE-app-sans.txt carries the licence.

Usage: python scripts/build-fonts.py [directory with NotoSans{JP,SC,TC,KR}-VF.ttf]
The sources are the variable fonts of github.com/google/fonts (ofl/notosans{jp,sc,tc,kr}/NotoSans*[wght].ttf),
saved under those names. Needs fontTools and brotli (python -m pip install fonttools brotli). The output is
committed, so a build does not need them.
"""

import collections
import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
SOURCES = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'output' / 'fontsrc'
LATIN_CENTRE = (1434 + 1024) / 4 / 2048  # Segoe UI: (cap height + x-height) / 4, in em


def double_byte(codec, leads, trails):
    chars = set()
    for lead in leads:
        for trail in trails:
            try:
                chars.add(ord(bytes([lead, trail]).decode(codec)))
            except UnicodeDecodeError:
                pass
    return chars


COMMON = set(range(0x3000, 0x3040)) | set(range(0xFF00, 0xFFF0))
LANGUAGES = {
    'jp': ('ja', double_byte('cp932', list(range(0x81, 0xA0)) + list(range(0xE0, 0xFD)), list(range(0x40, 0x7F)) + list(range(0x80, 0xFD)))),
    'sc': ('zh-Hans', double_byte('gb2312', range(0xA1, 0xF8), range(0xA1, 0xFF))),
    'tc': ('zh-Hant', double_byte('big5', range(0xA1, 0xFA), list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)))),
    'kr': ('ko', double_byte('euc_kr', range(0xA1, 0xFF), range(0xA1, 0xFF)) | set(range(0xAC00, 0xD7A4)) | set(range(0x1100, 0x1200)) | set(range(0x3130, 0x3190))),
}


def interface_text(locale):
    texts = []

    def walk(value):
        if isinstance(value, str):
            texts.append(value)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)

    for path in sorted((ROOT / 'src' / 'i18n' / 'messages' / locale).glob('*.json')):
        walk(json.loads(path.read_text(encoding='utf-8')))
    return ''.join(texts)


def is_letter(char):
    code = ord(char)
    return 0x3040 <= code <= 0x30FF or 0x3400 <= code <= 0x4DBF or 0x4E00 <= code <= 0x9FFF or 0xAC00 <= code <= 0xD7A3


def centre(font, locale):
    """How high above the baseline the language's letters are centred, in units, at the regular weight."""
    regular = instancer.instantiateVariableFont(font, {'wght': 400})
    cmap, glyphs = regular.getBestCmap(), regular.getGlyphSet()
    total = weight = 0
    for char, count in collections.Counter(c for c in interface_text(locale) if is_letter(c)).items():
        name = cmap.get(ord(char))
        if not name:
            continue
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        if pen.bounds:
            total += (pen.bounds[1] + pen.bounds[3]) / 2 * count
            weight += count
    return total / weight


def shift_outlines(font, shift):
    glyf = font['glyf']
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        # A composite glyph places its components, which are moved themselves.
        if glyph.isComposite() or glyph.numberOfContours == 0:
            continue
        coordinates = glyph.coordinates
        for index in range(len(coordinates)):
            x, y = coordinates[index]
            coordinates[index] = (x, y + shift)
        glyph.recalcBounds(glyf)
    # gvar holds deltas from these coordinates, so the variations move with them.
    hhea, os2 = font['hhea'], font['OS/2']
    hhea.ascent += shift
    hhea.descent += shift
    os2.sTypoAscender += shift
    os2.sTypoDescender += shift
    os2.usWinAscent += shift
    os2.usWinDescent -= shift
    if 'BASE' in font:
        # The ideographic baselines move with the outlines; the alphabetic one stays at 0, where Latin text
        # sits. Chrome aligns fonts by it, so moving it too would put the outlines straight back.
        axis = font['BASE'].table.HorizAxis
        tags = list(axis.BaseTagList.BaselineTag)
        for record in axis.BaseScriptList.BaseScriptRecord:
            for tag, coord in zip(tags, record.BaseScript.BaseValues.BaseCoord):
                if tag != 'romn':
                    coord.Coordinate += shift
    font['head'].yMin += shift
    font['head'].yMax += shift


def rename(font, family):
    name = font['name']
    for name_id in (1, 3, 4, 6, 16, 17, 21, 22, 25):
        name.removeNames(nameID=name_id)
    postscript = family.replace(' ', '')
    for name_id, value in ((1, family), (4, family), (6, postscript), (3, f'{postscript};built from Noto Sans CJK')):
        name.setName(value, name_id, 3, 1, 0x409)
        name.setName(value, name_id, 1, 0, 0)


def build(key, locale, characters):
    source = SOURCES / f'NotoSans{key.upper()}-VF.ttf'
    font = TTFont(source)
    units = font['head'].unitsPerEm
    shift = round(LATIN_CENTRE * units - centre(TTFont(source), locale))
    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.hinting = False
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=characters | COMMON)
    subsetter.subset(font)
    shift_outlines(font, shift)
    rename(font, f'App Sans {key.upper()}')
    font.flavor = 'woff2'
    output = ROOT / 'public' / 'fonts' / f'app-sans-{key}.woff2'
    output.parent.mkdir(parents=True, exist_ok=True)
    font.save(output)
    print(f'{output.name}: moved {shift} units, {output.stat().st_size / 1024 / 1024:.2f} MB, {len(font.getGlyphOrder())} glyphs')


def main():
    for key, (locale, characters) in LANGUAGES.items():
        build(key, locale, characters)


if __name__ == '__main__':
    main()
