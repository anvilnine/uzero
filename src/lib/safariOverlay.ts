/** Serial authorization checks; a late worker response must never resurrect a removed frame. */
export function overlayLifecycle(authorize: () => Promise<boolean>, mount: () => void, remove: () => void) {
  let stopped = false;
  let mounted = false;
  let pending = false;
  return {
    async check() {
      if (stopped || pending) return;
      pending = true;
      const allowed = await authorize().catch(() => false);
      pending = false;
      if (stopped) return;
      if (allowed && !mounted) { mount(); mounted = true; }
      if (!allowed && mounted) { remove(); mounted = false; }
    },
    stop() {
      stopped = true;
      if (mounted) remove();
      mounted = false;
    },
  };
}
