# Lineup — Privacy Policy

**Effective date:** 2026-11-05

> **Short version.** Lineup runs only in your browser. We have no servers, so we never receive your data. Lineup talks only to Google, and only to do what you ask. It never sees your passwords.

This policy covers the Lineup browser extension ("Lineup") for Chrome, Edge and Firefox. "We" and "us" mean the developer of Lineup. "You" means the person who uses it.

## 1. The data Lineup uses

Lineup uses only the data it needs to show and order your Google accounts.

| Data | Where it comes from | Why Lineup needs it |
|---|---|---|
| Email, name, profile photo link and sign-in position of each Google account that is signed in to your browser | Google, at `accounts.google.com` | To show your accounts and their order |
| The address of your current tab, **only on Google sites** | Your browser | To switch that tab to another account, when you ask |
| Your order, labels, colors and settings | You | To remember your choices |

Lineup does **not** use or collect:
- passwords, 2-Step Verification codes, or any other sign-in secret;
- the content of your email, files, calendar or any other Google service;
- your browsing history, or the address of any non-Google page;
- your location, contacts, or device identifiers.

## 2. Where your data is kept

All data stays **on your device**, in the browser's own extension storage:

- **Kept until you remove it:** your order, labels, colors, settings, and a copy of the account list, so the popup opens fast.
- **Deleted when the browser closes:** the progress of a reorder, and short-term status.

We have no servers, no database and no account system. **We never receive a copy of your data, so we cannot see, sell or share it.**

## 3. What Lineup sends over the network

Lineup sends requests **only to Google**, and only to do its job:

1. **Your account list.** Lineup asks `accounts.google.com` for the list of accounts that are signed in. Your browser adds your existing Google cookies to this request, the same as when Google's own account menu loads. Lineup does not read or store those cookies.
2. **Profile photos.** The popup shows each account's photo from Google's image servers. These requests send no referrer.
3. **Google pages you open.** When you switch accounts, use Pin mode or reorder, Lineup opens or changes Google pages in your browser. Google's own [Privacy Policy](https://policies.google.com/privacy) applies to those pages.

Lineup sends **nothing** to us or to any other party. It has no analytics, no ads, no tracking, no crash reports, and no remote code.

## 4. Things that happen only when you click

- **Copy:** the Copy button puts an email address on your clipboard.
- **Export settings:** saves a file to a place you choose. The file holds your order, labels, colors and settings.
- **Import settings:** reads a file you choose, on your device.

## 5. Passwords and signing in

Lineup **never** types, fills, reads or stores passwords. It does not add scripts to Google's sign-in pages. You type every password on Google's own page. During a reorder, Lineup only opens Google's own sign-out and sign-in pages and checks which accounts are signed in.

## 6. Permissions, and why

| Permission | Why |
|---|---|
| Access to listed Google sites | Read your account list. Open Google links in the account you pick. Nothing else. |
| `declarativeNetRequestWithHostAccess` | Add the account number to Google links (Pin mode). This happens inside your browser. |
| `storage` | Save your order, labels and settings on this device. |
| `alarms` | Refresh the account list every 15 minutes while Pin mode is on. |
| `sidePanel` (Chrome) | Show the reorder steps next to Google's sign-in page. |
| `webRequest`, `webRequestBlocking` (Firefox only) | Let Lineup's own account-list request reach Google. |

Lineup does not ask for access to all websites, your tabs list, cookies, or downloads.

## 7. How long data is kept, and how to delete it

Your data stays until you delete it. To delete all of it:
- **Remove one label or color:** change it in Lineup's settings.
- **Delete everything:** uninstall Lineup. The browser deletes all of Lineup's storage.

We hold no copy, so there is nothing for us to delete.

## 8. Your rights

Data protection laws (for example the GDPR in the EU and UK, the CCPA in California, and the Data Privacy Act in the Philippines) give you rights to access, correct, delete and move your data. Because all Lineup data is on your device and under your control, you can use these rights directly in Lineup or by uninstalling it. We do not sell or "share" personal information, as those words are used in the CCPA.

## 9. Children

Lineup is not for children under 13, or under the minimum age in your country. It collects no data from anyone, so it collects none from children.

## 10. Security

Lineup asks for as few permissions as it can. It checks every internal message, loads no remote code, and keeps your data out of web pages. No software is fully secure. Keep your browser and operating system up to date.

## 11. Google API data and store policies

Lineup's use of information received from Google follows the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/), including the Limited Use requirements. On Firefox, the extension tells Mozilla that it collects no data (`data_collection_permissions: none`).

Lineup is an independent project. It is not made, endorsed or supported by Google. Google, Gmail and Google Drive are trademarks of Google LLC.

## 12. Changes to this policy

If this policy changes, we update the effective date above and publish the new text with the extension's source. If a change gives Lineup new access to your data, we will tell you in the extension's release notes before it takes effect.

## 13. Contact

Questions or requests: open an issue on Lineup's GitHub page.
