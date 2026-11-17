# Uzero Privacy Policy

**Effective date:** 2026-11-09

> **Short version.** Uzero runs only in your browser. We have no servers, so we never receive your data. Uzero talks only to Google, and only to do what you ask. It never sees your passwords.

This policy covers the Uzero browser extension ("Uzero") for Chrome, Edge, Firefox and Safari. "We" and "us" mean anvilnine, the developer of Uzero. "You" means the person who uses it.

## 1. The data Uzero uses

Uzero uses only the data it needs to show and order your Google accounts.

| Data | Where it comes from | Why Uzero needs it |
|---|---|---|
| Email, name, profile photo link and sign-in position of each Google account that is signed in to your browser | Google, at `accounts.google.com` | To show your accounts and their order |
| Google tab addresses | Your browser | Switch a tab when you ask. In Safari, find a normal Google tab for account-list requests and the reorder guide. |
| Your order, labels, colors and settings | You | To remember your choices |

Uzero does **not** use or collect:
- passwords, 2-Step Verification codes, or any other sign-in secret;
- the content of your email, files, calendar or any other Google service;
- your browsing history;
- your location, contacts, or device identifiers.

Safari exposes tab addresses through its `tabs` permission. Uzero checks them to find eligible Google tabs and detect when a reorder tab navigates away. It does not persist non-Google addresses.

## 2. Where your data is kept

All data stays **on your device**, in the browser's own extension storage:

- **Kept until you remove it:** your order, labels, colors, settings, and a copy of the account list. The Chrome, Edge and Firefox popup keeps one more copy of that list in its own page storage, so it opens fast. Safari does not use that popup cache.
- **Deleted when the browser closes:** the progress of a reorder, and short-term status.

We have no servers, no database and no account system. **We never receive a copy of your data, so we cannot see, sell or share it.**

## 3. What Uzero sends over the network

Uzero sends requests **only to Google**, and only to do its job:

1. **Your account list.** Uzero asks `accounts.google.com` for the list of accounts that are signed in. Your browser adds your existing Google cookies to this request, the same as when Google's own account menu loads. Uzero does not read or store those cookies.
2. **Profile photos.** The popup shows each account's photo from Google's image servers. These requests send no referrer.
3. **Google pages you open.** When you switch accounts, use Pin mode or reorder, Uzero opens or changes Google pages in your browser. Google's own [Privacy Policy](https://policies.google.com/privacy) applies to those pages.

Uzero sends **nothing** to us or to any other party. It has no analytics, no ads, no tracking, no crash reports, and no remote code.

## 4. Things that happen only when you click

- **Copy:** the Copy button puts an email address on your clipboard.
- **Export settings:** saves a file to a place you choose. The file holds your order, labels, colors and settings.
- **Import settings:** reads a file you choose, on your device.

## 5. Passwords and signing in

Uzero **never** types, fills, reads or stores passwords. You type every password on Google's own page. During a reorder, Uzero opens Google's own sign-out and sign-in pages and checks which accounts are signed in.

Chrome, Edge and Firefox do not add scripts to Google's sign-in pages. Safari uses a script in an existing normal Google tab to request the account list. When you choose the sign-in overlay in Safari settings and start a reorder, Uzero also injects a guide into that reorder's `accounts.google.com` tab. The guide uses an extension-origin iframe and does not read or fill Google's form fields. The content script receives only authorization to show the guide, never the account list. The overlay is removed when the reorder finishes, is cancelled or expires, or when the tab navigates away. The default Safari guide is a separate window.

## 6. Permissions, and why

| Permission | Why |
|---|---|
| Access to the Google sites listed in the appendix | Read your account list. Open Google links in the account you pick. Nothing else. |
| `declarativeNetRequestWithHostAccess` | Add the account number to Google links (Pin mode). This happens inside your browser. |
| `storage` | Save your order, labels and settings on this device. |
| `alarms` | Refresh the account list every 15 minutes while Pin mode is on. |
| `sidePanel` (Chrome) | Show the reorder steps next to Google's sign-in page. |
| `webRequest`, `webRequestBlocking` (Firefox only) | Let Uzero's own account-list request reach Google. |
| `tabs` (Safari only) | Find eligible normal Google tabs and verify that private tabs are excluded. |
| `scripting` (Safari only) | Request the account list through an existing normal Google tab. Show the optional reorder overlay on the current Google sign-in tab. |

Uzero does not ask for access to all websites, cookies, or downloads. Chrome, Edge and Firefox do not request the `tabs` permission. Safari does request it for the checks described above. Safari rejects private tabs and tabs whose privacy status it cannot verify for account discovery, messages, tab switching, page creation and the reorder guide. These checks remain in place even if you allow the extension in Private Browsing.

**Safari Private Browsing is unsupported.** Leave **Allow in Private Browsing** off in Safari settings > Extensions > Uzero. Pin and per-service Pin work in regular browsing only after Safari's `extension.isAllowedIncognitoAccess()` returns exactly `false`. If access is on, unknown, unavailable or fails to check, Uzero pauses Pin, tries to remove existing redirect and loop rules, and shows an instruction to turn private access off and reopen Uzero or refresh. Saved Pin preferences remain on your device. Rule-installation and removal errors are shown separately from account-list errors.

Safari's redirect rules cannot be limited to normal windows. Enabling private access can make Safari apply already-installed Pin redirects in private windows before Uzero detects the change and pauses Pin. Uzero rechecks on worker startup, rule updates, normal UI state/refresh/preference requests and supported permission/focus wakeups. These are permission snapshots, not an atomic guarantee against later changes. Uzero does not promise immediate detection or that private navigation is unaffected when private access is enabled.

The exact Google sites Uzero can access are listed in the appendix below.

## 7. How long data is kept, and how to delete it

Your data stays until you delete it. To delete all of it:
- **Remove one label or color:** change it in Uzero's settings.
- **Delete everything:** uninstall Uzero. The browser deletes all of Uzero's storage.

We hold no copy, so there is nothing for us to delete.

## 8. Your rights

Data protection laws (for example the GDPR in the EU and UK, the CCPA in California, and the Data Privacy Act in the Philippines) give you rights to access, correct, delete and move your data. Because all Uzero data is on your device and under your control, you can use these rights directly in Uzero or by uninstalling it. We do not sell or "share" personal information, as those words are used in the CCPA.

## 9. Children

Uzero is not for children under 13, or under the minimum age in your country. It collects no data from anyone, so it collects none from children.

## 10. Security

Uzero asks for as few permissions as it can. It checks every internal message, loads no remote code, and keeps your data out of web pages. No software is fully secure. Keep your browser and operating system up to date.

## 11. Google API data and store policies

Uzero's use of information received from Google follows the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/), including the Limited Use requirements. On Firefox, the extension tells Mozilla that it collects no data (`data_collection_permissions: none`).

Uzero is an independent project. It is not made, endorsed or supported by Google. Google, Gmail and Google Drive are trademarks of Google LLC.

## 12. Tips and purchases

Uzero itself collects nothing, whether you pay or not. If you choose to tip through Gumroad, Polar or Ko-fi, that service handles your payment under its own privacy policy, and we never see your card details. The service shares your name, email address, country and the amount with us. We keep them only for tax records and refunds, and we never sell them or give them to anyone else. To see or delete what we hold, email [hello@anvilnine.com](mailto:hello@anvilnine.com).

If you buy the Safari version on Apple's App Store, Apple handles the purchase under its own privacy policy and does not give us your name or email address.

## 13. Changes to this policy

If this policy changes, we update the effective date above and publish the new text with the extension's source. If a change gives Uzero new access to your data, we will tell you in the extension's release notes before it takes effect.

## 14. Contact

Questions or requests: email [hello@anvilnine.com](mailto:hello@anvilnine.com).

## Appendix: Google sites Uzero can access

Uzero asks for access to these 44 sites only, over HTTPS. It uses them to read your account list (`accounts.google.com`) and to open Google links in the account you pick. `www.google.com` also supports account-list requests through an existing normal Safari tab and sign-out landing-page detection.

- `accounts.google.com`
- `admanager.google.com`
- `admin.google.com`
- `ads.google.com`
- `adsense.google.com`
- `aistudio.google.com`
- `analytics.google.com`
- `business.google.com`
- `calendar.google.com`
- `chat.google.com`
- `classroom.google.com`
- `colab.research.google.com`
- `console.cloud.google.com`
- `console.firebase.google.com`
- `contacts.google.com`
- `docs.google.com`
- `drive.google.com`
- `gemini.google.com`
- `groups.google.com`
- `issuetracker.google.com`
- `keep.google.com`
- `lookerstudio.google.com`
- `m.youtube.com`
- `mail.google.com`
- `meet.google.com`
- `merchants.google.com`
- `music.youtube.com`
- `myaccount.google.com`
- `news.google.com`
- `notebooklm.google.com`
- `one.google.com`
- `photos.google.com`
- `play.google.com`
- `script.google.com`
- `search.google.com`
- `shell.cloud.google.com`
- `sites.google.com`
- `studio.youtube.com`
- `tagmanager.google.com`
- `tasks.google.com`
- `voice.google.com`
- `workspace.google.com`
- `www.google.com`
- `www.youtube.com`
