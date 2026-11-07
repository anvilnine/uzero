# branding

Source art for the Uzero mark, plus the raster sets exported from it.
Nothing here is imported at build time. Files are copied into the extension and
the sites by hand, and this folder is the record of where those copies came from.

The mark is a row of four split-flap cards reading `/u/0`, set in a recessed
window on an orange leather plate. The last card is lit, because it is the one
you picked. There is one variant. The art it comes from is
`../design/icon/final/uzero.svg` (full detail) and
`../design/icon/final/uzero-small.svg` (one `0` card, drawn for 16 and 32 px).

Upstream copy of record is `../../../brand/icons/uzero/`. Change the art there
first, then re-copy into this folder. Never edit only one side.

## The masters

Seven SVGs plus one PNG. `-light` is the pale art and `-dark` is the dark art.
Read the suffix as the colour of the ink, not the colour of the surface: the
pale art goes **on** a dark background.

| File | Shape | Where it is used |
|---|---|---|
| `uzero-glyph-light.svg` | the four flaps only, transparent, pale cards | in-page mark on a dark surface |
| `uzero-glyph-dark.svg` | flaps inside the dark window recess, transparent | in-page mark on a light surface |
| `uzero-icon-light.svg` | rounded squircle plate (the `tile-shape` path), orange | app icon, light scheme |
| `uzero-icon-dark.svg` | rounded squircle plate, orange | app icon, dark scheme |
| `uzero-square-light.svg` | full-bleed square, no radius, orange | stores and sites that mask their own corners |
| `uzero-square-dark.svg` | full-bleed square, no radius, orange | stores and sites that mask their own corners |
| `uzero-icon-theme.svg` | small mark, flat colours from CSS vars | `favicon.svg` |
| `uzero-square-512.png` | full-bleed square, 512x512, opaque RGB | the app icon on anvilnine.com |

The orange leather plate is the brand, so both icon tones keep it. Crit Alarm
does the same with its orange plate. The `-light` and `-dark` icon and square
files are identical apart from their `<title>`, and so is every raster set in
the `-light` and `-dark` folders. The folder pairs exist because the layout is
fixed across every Anvil Nine app.

The plated `icon` and `square` files carry the tile with them. The transparent
`glyph` files have no tile, so their suffix picks how the art reads against
whatever is behind it. Both glyphs are the master with layers removed. Nothing
was redrawn.

How the square differs from the rounded icon:

- The `tile-shape` path is the full 1024 box (`M0,0H1024V1024H0Z`), so there are
  no transparent corners.
- The two rim strokes (the blurred `tile-rim` glow and the `tile-edge` hairline)
  are gone. They trace the plate edge, and a mask applied later would cut them
  off at the corners and leave a pale line along the straight edges.
- Everything else (gradient, vignette, grain, sheen, window, flaps) is the same.

anvilnine.com draws its app icons with `.app-icon { border-radius: 22.5% }` on a
white page, so an icon with its own transparent corners shows white slivers
there. Use `uzero-square-512.png` for that. Every pixel on its outer two rows
and columns is alpha 255 and plate orange (red 173 or more, blue 47 or less).

`uzero-icon-theme.svg` is the small mark (one `0` card) because its job is the
favicon. It reads `--orange`, `--cream` and `--ink-c` from the uzero.app site
tokens and falls back to the brand hexes below.

Colours, pulled from the art:

| Part | Value |
|---|---|
| Plate gradient, top to bottom | `#DA5C12`, `#D5590F`, `#CC530B` |
| Plate vignette | `#7A2400` at 0 to 22% |
| Window recess | `#5A2104`, `#7A2E05`, `#9A3D08` |
| Flap paper | `#F7E7C6` to `#D3B788` (lit card `#FFF7E2` to `#E0C89C`) |
| Flap letters | `#2A2520` |
| Split line between flap halves | `#2B1D12` |
| Small mark plate (`uzero-small.svg`) | `#E0631A` to `#CC520B` |
| Brand tokens used by the theme file | orange `#D9541E`, cream `#F2E4C8`, ink `#231F1B` |

## Exported sets

`preview.html` shows every raster next to its size. Open it in a browser.

| Folder | Contents |
|---|---|
| `favicon-light/`, `favicon-dark/` | `favicon.ico`, PNGs 16 and 32, `icon-192`, `icon-512`, `apple-touch-icon.png`, `icons.html` |
| `pwa-light/`, `pwa-dark/` | manifest icons 48 to 512, maskable 192 and 512, `manifest.json`, `pwa.html` |
| `icons-light/`, `icons-dark/` | desktop sizes 16 to 1024, plus `icon.icns`, `icon.ico`, `icon.svg` |
| `ios-light/`, `ios-dark/` | Xcode `AppIcon.appiconset` with `Contents.json` |
| `android-light/`, `android-dark/` | `mipmap-*` launcher PNGs and `play-store-icon.png` |
| `macos-light/`, `macos-dark/` | `AppIcon.icns`, plus `AppIcon.appiconset/` with `Contents.json` and `icon_*.png` at 1x and 2x |
| `windows-light/`, `windows-dark/` | `app.ico`, tile PNGs, sizes 16 to 256 |

The generators wrote every set. None was skipped. The `manifest.json` files had
the generator's placeholder name and colours, so they now say `Uzero` with theme
colour `#D9541E` and background `#F7F3EE`.

## Where the assets came from

Two generators, run 2026-11-07 against the masters above. Raw output went to
a scratch `icon-base/app-icons/` folder at the repo root. `icon-base/` is
ignored by git and was not kept, so rebuild it to change anything here.

| Tool | Input | Output folder | Maps to |
|---|---|---|---|
| [`catdad/svg-app-icon`](https://github.com/catdad/svg-app-icon) 2.0.0 | `uzero-icon-*.svg` (rounded) | `svg-app-icon/default-{light,dark}/` | `icons-light/`, `icons-dark/` |
| [`kynnyhsap/icons-cli`](https://github.com/kynnyhsap/icons-cli) 1.1.1 | `uzero-square-*.svg` (full bleed) | `icons-cli/default-{light,dark}/{web,pwa,ios,android,windows}/` | everything else |
| `kynnyhsap/icons-cli` 1.1.1 | `uzero-icon-*.svg` (rounded) | `icons-cli/default-{light,dark}/macos/` | `macos-light/`, `macos-dark/` |

macOS does not mask app icons, so its set is made from the rounded plate, the
same way Crit Alarm's was.

The `favicon-*` folders are `icons-cli`'s `web/` output with `pwa/favicon.ico`
dropped in, because `web/` ships no `.ico`.

Three things were changed after the generators ran:

1. **Grain below 256 px.** The master hides its leather grain under 256 px with
   a CSS media query, because the grain aliases into speckle at that size.
   `svg-app-icon` respects that. `icons-cli` renders through librsvg, which
   does not, so its small PNGs came out speckled. Every `icons-cli` PNG under
   256 px was replaced by the same file from a second `icons-cli` run against a
   copy of the master with the `tile-grain` rect deleted
   (`icon-base/app-icons/icons-cli-nograin/`).
2. **16 to 32 px.** The full art turns to mud at 16 px. Every PNG of 32 px or
   less (favicon 16 and 32, desktop 16 and 32, Windows 16 and 32, iOS 20 and
   29, macOS 16, 16@2x and 32) is `uzero-small.svg` rendered with sharp. The
   full-bleed sets use a copy of it with the plate path swapped for the full
   square. The `.ico` files (16/32/48, and 16 to 256 for `icon.ico`) and the
   `.icns` files were rebuilt around those PNGs with Pillow and `iconutil`.
3. **`uzero-square-512.png`** was rendered from `uzero-square-dark.svg` in
   Chromium (Playwright), saved as RGB with no alpha channel. Chromium matches
   the grain in the design renders under `../design/icon/final/`. librsvg draws
   it coarser, which is why the `icons-cli` PNGs at 256 px and up look a little
   rougher than this file.

To rebuild the whole folder from a fresh `icon-base/`, use the
`setup-branding-structure` skill, then repeat the three steps above.

## What ships today

Nothing is wired from this folder yet. The extension still ships
`public/icon/{16,32,48,96,128}.png` and uzero.app ships `assets/uzero-48.png`
and `assets/uzero-128.png`, all exported earlier from the same art.

| Destination | Source |
|---|---|
| anvilnine.com app icon | `uzero-square-512.png` |

When a site wants the standard trio:

| Destination | Source |
|---|---|
| `favicon.svg` | `uzero-icon-theme.svg` |
| `favicon.ico` | `favicon-dark/favicon.ico` |
| `apple-touch-icon.png` | `favicon-dark/apple-touch-icon.png` |

The `.ico` is the full-bleed plate. Safari ignores SVG favicons and falls back
to it, so it has to read on its own.

## Regenerating a single raster

`rsvg-convert` and ImageMagick are not installed on this machine. Use sharp
(it ships with `icons-cli`) or Chromium through Playwright. For an Apple touch
icon, flatten onto the plate colour so iOS has no alpha to composite on white:

```js
sharp('uzero-square-dark.svg').resize(180, 180)
  .flatten({ background: '#CC530B' }).removeAlpha().png().toFile('apple-touch-icon.png')
```

## Not covered

- The Safari app's icon set lives on the `safari` branch in
  `safari/Shared (App)/Assets.xcassets/AppIcon.appiconset/` and was not
  touched. When it next changes, copy from `ios-dark/` and `macos-dark/`.
- Store screenshots and promo tiles are not icons and live under `../docs/`.
