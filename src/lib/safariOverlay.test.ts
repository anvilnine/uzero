import { expect, it, vi } from 'vitest';
import { overlayLifecycle } from './safariOverlay';
it('mounts once after authorization, removes when authorization expires and can reopen', async () => {
  const authorize = vi.fn(async () => true); const mount = vi.fn(); const remove = vi.fn();
  const lifecycle = overlayLifecycle(authorize, mount, remove);
  await lifecycle.check(); await lifecycle.check();
  expect(mount).toHaveBeenCalledTimes(1);
  authorize.mockResolvedValue(false); await lifecycle.check();
  expect(remove).toHaveBeenCalledTimes(1);
  authorize.mockResolvedValue(true); await lifecycle.check();
  expect(mount).toHaveBeenCalledTimes(2);
  lifecycle.stop(); expect(remove).toHaveBeenCalledTimes(2);
});
it('fails closed when authorization rejects and never mounts after navigation cleanup', async () => {
  let resolve!: (value: boolean) => void;
  const mount = vi.fn(); const remove = vi.fn();
  const lifecycle = overlayLifecycle(() => new Promise(r => { resolve = r; }), mount, remove);
  const pending = lifecycle.check(); lifecycle.stop(); resolve(true); await pending;
  expect(mount).not.toHaveBeenCalled();
  const rejected = overlayLifecycle(async () => { throw new Error('worker unavailable'); }, mount, remove);
  await rejected.check(); expect(mount).not.toHaveBeenCalled();
});
