import { defineConfig } from 'wxt';
import { permissionHosts } from './src/lib/services';

const switchCommand = (n: number) => ({
  suggested_key: { default: `Alt+${n}` },
  description: `Switch this tab to account #${n} in your order`,
});

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: ({ browser }) => {
    const firefox = browser === 'firefox';
    return {
      name: 'Uzero — default account & order for Google',
      short_name: 'Uzero',
      description:
        'Choose your default Google account. Open Gmail, Drive and Calendar links in the right account, or truly reorder /u/0, /u/1.',
      homepage_url: 'https://github.com/anvilnine/uzero',
      // Never runs in private windows, so it never sees or changes their Google sessions.
      incognito: 'not_allowed',
      permissions: [
        'storage',
        'declarativeNetRequestWithHostAccess',
        'alarms',
        // Firefox: DNR can't match our moz-extension:// initiator, so Origin is set via webRequest.
        ...(firefox ? ['webRequest', 'webRequestBlocking'] : []),
        ...(browser === 'safari' ? ['scripting', 'tabs'] : []),
      ],
      // Exactly the hosts Uzero routes or reads, https only (see permissionHosts in services.ts).
      host_permissions: permissionHosts().map((h) => `https://${h}/*`),
      // Chrome allows at most 4 suggested shortcuts.
      commands: {
        'switch-1': switchCommand(1),
        'switch-2': switchCommand(2),
        'switch-3': switchCommand(3),
        'switch-4': switchCommand(4),
      },
      ...(firefox && {
        browser_specific_settings: {
          gecko: {
            id: 'uzero@anvilnine',
            // data_collection_permissions needs Firefox 140+.
            strict_min_version: '140.0',
            data_collection_permissions: { required: ['none'] },
          },
          // Firefox for Android only supports data_collection_permissions from 142.
          gecko_android: { strict_min_version: '142.0' },
        },
      }),
    };
  },
});
