/** Safari DNR has no normal-window condition. This is a permission snapshot, not a toggle lock. */
export const SAFARI_PRIVATE_LIMITATION = 'Private Browsing is unsupported. Leave Allow in Private Browsing off in Safari settings > Extensions > Uzero. Enabling it may apply existing Pin redirects privately before Uzero detects the change and pauses Pin.';

const RECOVERY = 'Your Pin choices are saved. In Safari settings > Extensions > Uzero, leave Allow in Private Browsing off, then reopen Uzero or refresh.';

/** Only an exact false verifies the supported configuration. Missing/failed APIs are unsafe. */
export async function safariPinError(extension: { isAllowedIncognitoAccess?: () => Promise<unknown> } | undefined): Promise<string | null> {
  try {
    const allowed = await extension?.isAllowedIncognitoAccess?.();
    if (allowed === false) return null;
    return allowed === true
      ? `Pin is paused because Allow in Private Browsing is on. ${RECOVERY}`
      : `Pin is paused: Uzero cannot verify that Allow in Private Browsing is off. ${RECOVERY} If this persists, keep Pin off.`;
  } catch {
    return `Pin is paused: Uzero cannot verify that Allow in Private Browsing is off. ${RECOVERY} If this persists, keep Pin off.`;
  }
}
