<p align="center">
  <img src="public/icon/128.png" alt="Lineup icon" width="96" height="96">
</p>

<h1 align="center">Lineup</h1>

<p align="center">
  <b>Put your Google accounts in <i>your</i> order.</b><br>
  Pick which account is #1. Open Google links in the right account. Reorder Google's own <code>/u/0</code>, <code>/u/1</code>… for real.
</p>

<p align="center">
  <img alt="Chrome MV3" src="https://img.shields.io/badge/Chrome-MV3-0B57D0?style=flat-square&logo=googlechrome&logoColor=white">
  <img alt="Firefox 140+" src="https://img.shields.io/badge/Firefox-140%2B-FF7139?style=flat-square&logo=firefoxbrowser&logoColor=white">
  <img alt="Edge" src="https://img.shields.io/badge/Edge-supported-0C8484?style=flat-square">
  <img alt="No tracking" src="https://img.shields.io/badge/tracking-none-1F1F1F?style=flat-square">
  <img alt="Tests" src="https://img.shields.io/badge/tests-316%20passing-2E7D32?style=flat-square">
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#how-it-works">How it works</a> •
  <a href="#install">Install</a> •
  <a href="#privacy">Privacy</a> •
  <a href="#faq">FAQ</a> •
  <a href="#develop">Develop</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/popup-dark.png">
    <img src="docs/screenshots/popup-light.png" alt="Lineup popup with four Google accounts in a custom order" width="300">
  </picture>
  &nbsp;&nbsp;
  <img src="docs/screenshots/panel-signing-in.png" alt="Reorder steps in the side panel, next to Google's sign-in page" width="300">
</p>

---

## The problem

Google numbers your accounts by the order you signed in. Your work account is `/u/0` today and your personal one tomorrow. Links from Slack, email and bookmarks open in whichever account is first. To fix the order, you must sign out of everything and sign back in, in the right order, by hand.

**Lineup fixes that.**

## Features

- **Your order.** Drag accounts into the order you want. Give each one a label and a color.
- **Pin your #1.** Google links from outside Google (chat apps, bookmarks, the address bar) open in your #1 account. Or pick an account per service, for example Calendar in your work account.
- **Switch this tab.** Move the current Gmail, Drive, Docs or Calendar tab to another account in one click, or with <kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>4</kbd>.
- **Reorder for real.** A guide in the side panel signs you out, then helps you sign back in, one account at a time. Google's own numbers then match your order.
- **Password-manager friendly.** Each step shows the email to use, with a Copy button, in case your password manager fills in a different one.
- **Light and dark.** A calm, Google-style look that follows your system theme.
- **Light on your browser.** Lineup adds nothing to the pages you visit, and only checks in the background while Pin is on.

## How it works

Lineup gives you two ways to get the order you want. Most people only need the first one.

| | **Pin mode** | **Reorder in Google** |
|---|---|---|
| What changes | Which account Google links open in | Google's real order (`/u/0`, `/u/1`…) |
| Signs you out? | No | Yes, once |
| Passwords needed? | No | Yes. You type each one on Google's page. |
| Best for | Daily use | A clean start |

<details>
<summary><b>Why can't an extension just reorder the accounts?</b></summary>
<br>

Google keeps the account order on its servers. Only Chrome itself can change it, with private tokens that extensions cannot get. The only public way is to sign out of all accounts and sign back in, in order. Lineup's guide makes that fast, and it never touches your passwords.

</details>

### Compared with other tools

| | Lineup | Default-account extensions | Firefox Containers |
|---|:---:|:---:|:---:|
| Open links in a chosen account | ✅ | ✅ | ➖ |
| Default account per service | ✅ | Some | ➖ |
| Switch the current tab | ✅ | Some | ➖ |
| Real reorder of `/u/0`, `/u/1`… | ✅ | ❌ | ❌ |
| Chrome and Firefox | ✅ | Some | Firefox only |

## Install

| Browser | Store |
|---|---|
| Chrome | Chrome Web Store (coming soon) |
| Firefox | Firefox Add-ons (coming soon) |
| Edge | Edge Add-ons (coming soon) |

### From source

```bash
pnpm install
```

```bash
pnpm build
```

Then load it in Chrome:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick `.output/chrome-mv3`.

> [!TIP]
> On macOS the `.output` folder is hidden. In the file picker, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> and paste the full path.

<details>
<summary><b>Firefox</b></summary>
<br>

```bash
pnpm build:firefox
```

Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and pick `.output/firefox-mv3/manifest.json`.

</details>

## Usage

1. Click the Lineup icon in your toolbar. Your signed-in accounts show up.
2. Drag them into your order, or focus one and press <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd>.
3. Turn on **Pin** so links open in your #1.
4. Optional: click **Reorder in Google…** to make Google's own order match.

> [!WARNING]
> **Reorder in Google** signs you out of every Google account in this browser. Save your work first, and have your passwords and 2-Step Verification ready.

| Shortcut | Action |
|---|---|
| <kbd>Alt</kbd>+<kbd>1</kbd> … <kbd>Alt</kbd>+<kbd>4</kbd> | Switch this tab to account 1–4 in your order |
| <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>↓</kbd> | Move the focused account up or down |

Change the shortcuts at `chrome://extensions/shortcuts`.

## Privacy

**Lineup runs only in your browser.** It has no servers, no analytics, no ads and no remote code. It talks only to Google, to read your own account list. It never sees your passwords.

| Lineup asks for | Lineup does **not** ask for |
|---|---|
| Access to listed Google sites only | Access to all websites |
| Storage on your device | Your tabs list or history |
| Link rules for Pin mode | Cookies or downloads |

Read the full [Privacy Policy](docs/PRIVACY.md) and [Terms of Use](docs/TERMS.md).

## FAQ

<details>
<summary><b>Will Lineup sign me out?</b></summary>
<br>
Only if you click <b>Reorder in Google</b> and confirm. Pin mode and tab switching never sign you out.
</details>

<details>
<summary><b>My password manager filled in the wrong email during a reorder.</b></summary>
<br>
Clear the email field on Google's page, then paste the email from Lineup's side panel (use the Copy button). If the wrong account already signed in, click <b>Try again</b>. Lineup signs out and starts over.
</details>

<details>
<summary><b>After a reorder, Chrome put a different account first.</b></summary>
<br>
If Chrome itself is signed in with sync, Chrome may move its own account back to #1. Pin mode still opens links in your #1.
</details>

<details>
<summary><b>Which Google services work?</b></summary>
<br>
30 of them: Gmail, Drive, Docs, Sheets, Slides, Forms, Calendar, Meet, Chat, Keep, Photos, Contacts, Sites, Classroom, Admin console, Gemini, NotebookLM, YouTube, YouTube Studio, Maps, Cloud console, Firebase console, Analytics, Google Ads, AdSense, Search Console, Tag Manager, Play Console, Looker Studio and Google Account. Google's own in-app links are left alone.
</details>

<details>
<summary><b>Is it safe?</b></summary>
<br>
Lineup never types, fills or stores passwords, and adds no scripts to Google's sign-in pages. It uses as few permissions as it can, checks every internal message, and loads no remote code.
</details>

## Develop

Built with [WXT](https://wxt.dev), [Svelte 5](https://svelte.dev) and TypeScript.

| Task | Command |
|---|---|
| Dev mode with live reload | `pnpm dev` |
| Chrome build | `pnpm build` → `.output/chrome-mv3` |
| Firefox build | `pnpm build:firefox` → `.output/firefox-mv3` |
| Design preview with fake data | `pnpm build:preview` |
| Store zips | `pnpm zip` / `pnpm zip:firefox` |
| Tests | `pnpm test` |
| Type checks | `pnpm typecheck` and `pnpm check` |

```
src/
  lib/          logic: accounts, link rules, URL rewrites, reorder state machine
  entrypoints/  background, popup, options, reorder page, side panel
  ui/           shared Svelte components and design tokens
```

## Contributing

Bug reports and ideas are welcome. For big changes, please open an issue first. Run `pnpm test && pnpm typecheck && pnpm check` before you send a pull request.

## Credits

Ideas and techniques from these MIT and BSD projects: [authusher](https://github.com/zzjjaayy/authusher-default-google-account-extension), [authpin](https://github.com/emretepedev/authpin-for-google), [account-switcher-for-google](https://github.com/piro0919/account-switcher-for-google) and [default.wtf](https://github.com/uptechteam/default.wtf).

---

<p align="center">
  <sub>Lineup is not affiliated with or endorsed by Google. Google and Gmail are trademarks of Google LLC.</sub>
</p>
