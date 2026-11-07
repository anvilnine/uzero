import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { overlayLifecycle } from '@/lib/safariOverlay';

// Dynamically injected by the background only into the verified current normal wizard tab.
// No page fields, credentials, account state or page-world messages are read here.
export default defineContentScript({
  matches: ['https://accounts.google.com/*'],
  include: ['safari'],
  registration: 'runtime',
  noScriptStartedPostMessage: true,
  runAt: 'document_idle',
  main(ctx) {
    if (window.top !== window || location.origin !== 'https://accounts.google.com') return;
    const scope = globalThis as typeof globalThis & { __uzeroGuide?: { check(): Promise<void> } };
    if (scope.__uzeroGuide) { void scope.__uzeroGuide.check(); return; }
    let frame: HTMLIFrameElement | undefined;
    const lifecycle = overlayLifecycle(
      async () => {
        const res = await browser.runtime.sendMessage({ type: 'safariGuideAuthorize' });
        return res?.ok === true && res.data?.authorized === true;
      },
      () => {
        frame = document.createElement('iframe');
        frame.src = browser.runtime.getURL('/reorder.html') + '?guide=overlay';
        frame.title = 'Uzero reorder guide';
        frame.allow = 'clipboard-write';
        frame.style.cssText = 'position:fixed;right:12px;bottom:12px;width:min(340px,calc(100vw - 24px));height:min(560px,45vh);border:1px solid #747775;border-radius:12px;z-index:2147483647;box-shadow:0 4px 20px #0003;background:#fff;color-scheme:light dark;';
        document.documentElement.append(frame);
      },
      () => { frame?.remove(); frame = undefined; },
    );
    scope.__uzeroGuide = lifecycle;
    const timer = setInterval(() => void lifecycle.check(), 1000);
    const stop = () => {
      lifecycle.stop(); clearInterval(timer); delete scope.__uzeroGuide;
      browser.runtime.onMessage.removeListener(onMessage);
      window.removeEventListener('pagehide', stop);
    };
    const onMessage = (msg: unknown, sender: { id?: string; url?: string }) => {
      // Only extension-origin/background messages can tear down this presentation.
      if (sender.id === browser.runtime.id && (!sender.url || sender.url.startsWith(browser.runtime.getURL('/')))
        && (msg as { type?: unknown } | null)?.type === 'safariGuideRemove') stop();
    };
    browser.runtime.onMessage.addListener(onMessage);
    window.addEventListener('pagehide', stop, { once: true });
    ctx.onInvalidated(stop);
    void lifecycle.check();
  },
});
