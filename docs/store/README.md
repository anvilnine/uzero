# Store images

- `slide-1.png` … `slide-5.png`: store screenshots, 1280×800.
- `promo-440x280.png`: Chrome Web Store small promo tile.

To rebuild: `pnpm build:preview`, serve `.output/chrome-mv3-preview`, run `source/store-shots.mjs <url> source/assets` (Playwright), then serve `source/` and run `source/store-render.mjs <url> <out>`. Renders are made at 2× and downscaled to the exact store size.

Demo accounts use the maintainer's own domains (anvilnine.com, critalarm.app, namescout.app, zonilyjame.dev).
