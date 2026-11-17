import { mount } from 'svelte';
import '../../ui/tokens.css';
import App from './App.svelte';

// A public iframe must pass tab/parent authorization before mounting or subscribing to state.
async function start() {
  const embedded = window.top !== window;
  const guide = new URLSearchParams(location.search).get('guide');
  if (embedded) {
    if (import.meta.env.BROWSER !== 'safari' || guide !== 'overlay') return;
    try {
      const res = await browser.runtime.sendMessage({ type: 'safariGuideAuthorize' });
      if (res?.ok !== true || res.data?.authorized !== true) return;
    } catch { return; }
  }
  mount(App, { target: document.getElementById('app')!, props: { panel: guide === 'window' || embedded, embedded, guideWindow: guide === 'window' } });
}
void start();
