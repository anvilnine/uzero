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
      name: 'Lineup — account order for Google',
      short_name: 'Lineup',
      description: 'Put your Google accounts in your order. Open Google links in the account you pick, or truly reorder them.',
      permissions: [
        'storage',
        'declarativeNetRequestWithHostAccess',
        'alarms',
        // Firefox: DNR can't match our moz-extension:// initiator, so Origin is set via webRequest.
        ...(firefox ? ['webRequest', 'webRequestBlocking'] : []),
      ],
      // Exactly the hosts Lineup routes or reads, https only (see permissionHosts in services.ts).
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
            id: 'lineup@kuyazee',
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
