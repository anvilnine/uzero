// Links to the Uzero forms on forms.zonily.cloud. The contract (field names, values) is
// docs/feedback-forms.md at the Anvil Nine root. Opening a link is the only thing that leaves the
// browser, and only when the user clicks it. Uzero has no accounts, so no user fields are sent.

/** Feature request form. Set it to '' to hide the link. */
export const FEATURE_REQUEST_URL = 'https://forms.zonily.cloud/form/9T5PLe7c';

export interface FormContext {
  env: 'prod' | 'dev';
  /** The page or section holding the link, e.g. `options`. */
  source: string;
  version?: string;
  locale?: string;
}

/** `base` with the hidden field values added, or '' while `base` is empty. */
export function formLink(base: string, ctx: FormContext): string {
  if (!base) return '';
  const u = new URL(base);
  u.searchParams.set('app', 'uzero');
  u.searchParams.set('env', ctx.env);
  u.searchParams.set('source', ctx.source);
  if (ctx.version) u.searchParams.set('version', ctx.version);
  if (ctx.locale) u.searchParams.set('locale', ctx.locale);
  return u.toString();
}

/** Context for a link on an extension page. Safe to call outside the extension (design preview). */
export function pageContext(source: string): FormContext {
  const manifest = typeof browser !== 'undefined' && browser.runtime?.getManifest ? browser.runtime.getManifest() : undefined;
  return {
    env: import.meta.env.MODE === 'production' ? 'prod' : 'dev',
    source,
    version: manifest?.version,
    locale: typeof navigator === 'undefined' ? undefined : navigator.language,
  };
}
