# Releasing Uzero

A `vX.Y.Z` tag on `main` builds the zips, publishes a GitHub release and submits the new version to three stores. This page covers the store keys and how to resend a submission. The release steps are in the README under "Versions and releases".

## What runs

1. `release.yml` runs CI, checks the tag against `package.json`, zips Chrome, Edge and Firefox (plus the Firefox sources zip) and publishes the GitHub release.
2. `submit.yml` downloads those zips, checks them against `SHA256SUMS.txt` and runs `wxt submit` once per store.

Each store runs as its own job, so one failure does not stop the others. A store with no keys is skipped with a warning.

Safari is not part of this. It ships through Xcode and App Store Connect.

## Store keys

Put every value in the `stores` environment (Settings > Environments > stores). Values marked "variable" are not secret and go under Variables. The rest go under Secrets. To approve each submission by hand, add yourself as a required reviewer on that environment.

### Chrome Web Store (API v2)

| Name | Kind | Value |
|---|---|---|
| `CHROME_EXTENSION_ID` | variable | `fcgcjgjmhpccbklbpgjnainbkebfleac` |
| `CHROME_PUBLISHER_ID` | variable | Publisher ID from the developer dashboard account page |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | secret | Service account email |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | secret | Service account private key (the PEM text from the JSON key file) |

Create a service account in a Google Cloud project, turn on the Chrome Web Store API, then add the service account email to the publisher in the Chrome Web Store developer dashboard.

The workflow sets `CHROME_CANCEL_PENDING`, so a new tag replaces a version that is still in review.

### Firefox Add-ons

| Name | Kind | Value |
|---|---|---|
| `FIREFOX_JWT_ISSUER` | secret | JWT issuer from addons.mozilla.org/developers/addon/api/key |
| `FIREFOX_JWT_SECRET` | secret | JWT secret from the same page |

The add-on ID (`uzero@anvilnine`) is in the workflow. Release notes come from the CHANGELOG section for the version. Reviewer notes carry the build steps.

### Edge Add-ons

| Name | Kind | Value |
|---|---|---|
| `EDGE_PRODUCT_ID` | variable | `459083e0-1a52-4379-82f6-6dc0a8b9e3a8` |
| `EDGE_CLIENT_ID` | secret | Client ID from Partner Center > Edge > Publish API |
| `EDGE_API_KEY` | secret | API key from the same page |

Edge rejects an upload while an earlier version is still in review. Cancel that submission in Partner Center first, then rerun the Edge job.

## Resend or dry-run

Actions > Submit to stores > Run workflow. Pick the tag, one store or all, and tick "Check the keys only" to test the keys without uploading.

## Check a sources zip

AMO reviewers rebuild the Firefox zip from the sources zip. To check it yourself:

```
unzip uzero-X.Y.Z-sources.zip -d /tmp/uzero-src && cd /tmp/uzero-src
pnpm install --frozen-lockfile && pnpm zip:firefox
```

The new `.output/uzero-X.Y.Z-firefox.zip` should hold the same files as the release zip.
