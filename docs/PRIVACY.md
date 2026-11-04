# Lineup — Privacy Policy

Last updated: 2026-11-04

**Short version: Lineup keeps everything on your computer. It has no servers. It sends nothing to anyone except Google, and only to read your own account list.**

## What Lineup reads
- The list of Google accounts that are signed in to your browser: email, name, profile photo link, and sign-in position. It reads this from `accounts.google.com`, the same way Google's own account menu does.
- The address of your current tab, but only on Google sites, and only to switch that tab to another account.

## What Lineup stores
- Your account order, labels, colors and settings.
- A copy of the account list, so the popup opens fast.

All of it stays in your browser's extension storage on this device. Uninstalling Lineup deletes it.

## What Lineup never does
- It never sends your data to the developer or to any other party.
- It has no analytics, no ads, no tracking and no remote code.
- It never reads, types or stores your passwords. You type them on Google's own pages.
- It never sells or shares data.

## Permissions, and why
| Permission | Why |
|---|---|
| Access to Google sites | Read your account list. Open Google links in the account you pick. |
| `declarativeNetRequestWithHostAccess` | Add the account to Google links ("Pin" mode), inside the browser. |
| `storage` | Save your order and labels on this device. |
| `alarms` | Refresh the account list every 15 minutes while Pin is on. |
| Firefox only: `webRequest` | Let Lineup's own account-list request reach Google. |

## Contact
Open an issue on the project's GitHub page.

Lineup's use of information received from Google follows the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/), including the Limited Use requirements.
