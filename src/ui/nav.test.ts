import { describe, expect, it, vi } from 'vitest';
import { openPanelVia } from './nav';

describe('openPanelVia', () => {
  it('opens Chrome’s side panel for the window', async () => {
    const open = vi.fn(async () => undefined);
    expect(await openPanelVia({ sidePanel: { open } }, 3)).toBe(true);
    expect(open).toHaveBeenCalledWith({ windowId: 3 });
  });

  it('opens Firefox’s sidebar', async () => {
    const open = vi.fn(async () => undefined);
    expect(await openPanelVia({ sidebarAction: { open } }, undefined)).toBe(true);
    expect(open).toHaveBeenCalledOnce();
  });

  it('calls the browser right away, before the caller awaits anything', () => {
    const open = vi.fn(() => new Promise<void>(() => {}));
    void openPanelVia({ sidePanel: { open } }, 1);
    expect(open).toHaveBeenCalledOnce();
  });

  it('reports false when the browser refuses, so the caller can open a tab instead', async () => {
    expect(await openPanelVia({ sidePanel: { open: () => Promise.reject(new Error('no gesture')) } }, 1)).toBe(false);
    expect(
      await openPanelVia({
        sidebarAction: {
          open: () => {
            throw new Error('not allowed');
          },
        },
      }, undefined),
    ).toBe(false);
  });

  it('reports false without a panel API or (Chrome) a window id', async () => {
    expect(await openPanelVia(null, 1)).toBe(false);
    expect(await openPanelVia({}, 1)).toBe(false);
    expect(await openPanelVia({ sidePanel: { open: async () => undefined } }, undefined)).toBe(false);
  });
});
