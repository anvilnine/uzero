# Lineup — account order for Google

Signed in to several Google accounts? Google numbers them by sign-in order (`/u/0`, `/u/1`…). Lineup lets you choose that order.

- **Drag** your accounts into your own order. Add labels and colors.
- **Pin your #1.** Google links from outside Google (chat apps, bookmarks, typed URLs) open in your #1, or in the account you pick for each service.
- **Switch this tab** to another account in one click, or with Alt+1…4.
- **Make it real.** A wizard signs you out, then guides you to sign back in, one account at a time. Google's own order then matches yours.

Private: no servers, no analytics. See [docs/PRIVACY.md](docs/PRIVACY.md).

## Develop

```bash
pnpm install
```

```bash
pnpm dev
```

| Task | Command |
|---|---|
| Chrome build | `pnpm build` → `.output/chrome-mv3` |
| Firefox build | `pnpm build:firefox` → `.output/firefox-mv3` |
| Store zips | `pnpm zip` / `pnpm zip:firefox` |
| Tests | `pnpm test` |
| Type checks | `pnpm typecheck` and `pnpm check` |

## Load it in Chrome
1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**. Pick `.output/chrome-mv3`.

## Load it in Firefox
1. Run `pnpm build:firefox`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on**. Pick `.output/firefox-mv3/manifest.json`.

## Credits
Ideas and techniques from MIT/BSD projects: authusher, authpin, account-switcher-for-google (piro0919), default.wtf.
