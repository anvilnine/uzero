// Catalog of Google services Lineup can route to an account.
// Host list started from authusher's sites catalog (MIT, zzjjaayy/authusher-default-google-account-extension).
import type { ServiceInfo } from './types';

/**
 * path:  the account goes in the path as /u/N/ right after `uAt` (Gmail /mail/u/1/).
 * query: the account goes in ?authuser=N.
 */
export type UrlStyle = 'path' | 'query';

export interface Service extends ServiceInfo {
  /** Exact hostnames (no wildcards, never a bare apex like google.com). */
  hosts: string[];
  /** Path prefix that identifies the service on a shared host ('' = whole host). */
  prefix: string;
  style: UrlStyle;
  /** Path style: path after which /u/N/ is inserted ('' = root). */
  uAt?: string;
  /** Path style: paths outside `uAt` on the same host still accept ?authuser. */
  queryElsewhere?: boolean;
  /** Path regexes (RE2 + JS compatible, matched from the start of the path) never to rewrite. */
  never?: string[];
  /** Shown in options next to the service. */
  caveat?: string;
}

const DOCS_NEVER = ['/[^/]+/create(?:[/?#]|$)', '/[^/]+/d/[^/]+/export'];

export const SERVICES: readonly Service[] = [
  // Workspace
  { id: 'gmail', name: 'Gmail', home: 'https://mail.google.com/mail/', hosts: ['mail.google.com'], prefix: '', style: 'path', uAt: '/mail', queryElsewhere: true },
  { id: 'drive', name: 'Drive', home: 'https://drive.google.com/drive/', hosts: ['drive.google.com'], prefix: '', style: 'path', uAt: '/drive', queryElsewhere: true, never: ['/uc(?:[/?#]|$)'] },
  { id: 'docs', name: 'Docs', home: 'https://docs.google.com/document/', hosts: ['docs.google.com'], prefix: '/document', style: 'path', uAt: '/document', never: DOCS_NEVER },
  { id: 'sheets', name: 'Sheets', home: 'https://docs.google.com/spreadsheets/', hosts: ['docs.google.com'], prefix: '/spreadsheets', style: 'path', uAt: '/spreadsheets', never: DOCS_NEVER },
  { id: 'slides', name: 'Slides', home: 'https://docs.google.com/presentation/', hosts: ['docs.google.com'], prefix: '/presentation', style: 'path', uAt: '/presentation', never: DOCS_NEVER },
  { id: 'forms', name: 'Forms', home: 'https://docs.google.com/forms/', hosts: ['docs.google.com'], prefix: '/forms', style: 'path', uAt: '/forms', never: DOCS_NEVER, caveat: 'Public forms open for anyone; the account only matters for forms that ask for sign-in.' },
  { id: 'calendar', name: 'Calendar', home: 'https://calendar.google.com/calendar/', hosts: ['calendar.google.com'], prefix: '', style: 'path', uAt: '/calendar', queryElsewhere: true },
  { id: 'meet', name: 'Meet', home: 'https://meet.google.com/', hosts: ['meet.google.com'], prefix: '', style: 'query', caveat: 'Meet keeps ?authuser in the address bar.' },
  { id: 'chat', name: 'Chat', home: 'https://chat.google.com/', hosts: ['chat.google.com'], prefix: '', style: 'query' },
  { id: 'keep', name: 'Keep', home: 'https://keep.google.com/', hosts: ['keep.google.com'], prefix: '', style: 'query' },
  { id: 'photos', name: 'Photos', home: 'https://photos.google.com/', hosts: ['photos.google.com'], prefix: '', style: 'path', uAt: '' },
  { id: 'contacts', name: 'Contacts', home: 'https://contacts.google.com/', hosts: ['contacts.google.com'], prefix: '', style: 'query' },
  { id: 'sites', name: 'Sites', home: 'https://sites.google.com/', hosts: ['sites.google.com'], prefix: '', style: 'query', caveat: 'Published sites look the same for every account.' },
  { id: 'classroom', name: 'Classroom', home: 'https://classroom.google.com/', hosts: ['classroom.google.com'], prefix: '', style: 'query' },
  { id: 'admin', name: 'Admin console', home: 'https://admin.google.com/', hosts: ['admin.google.com'], prefix: '', style: 'query', caveat: 'Only Workspace admin accounts can open it.' },
  // AI
  { id: 'gemini', name: 'Gemini', home: 'https://gemini.google.com/app', hosts: ['gemini.google.com'], prefix: '', style: 'query' },
  { id: 'notebooklm', name: 'NotebookLM', home: 'https://notebooklm.google.com/', hosts: ['notebooklm.google.com'], prefix: '', style: 'query' },
  // Media
  { id: 'youtube', name: 'YouTube', home: 'https://www.youtube.com/', hosts: ['www.youtube.com', 'm.youtube.com'], prefix: '', style: 'query', never: ['/(?:logout|signin|redirect)(?:[/?#]|$)'], caveat: 'Brand channels are picked inside YouTube, not by account number.' },
  { id: 'youtube-studio', name: 'YouTube Studio', home: 'https://studio.youtube.com/', hosts: ['studio.youtube.com'], prefix: '', style: 'query', caveat: 'Brand channels are picked inside YouTube, not by account number.' },
  // www.google.com is here only for Maps: Lineup routes and switches nothing else on it (not Search).
  { id: 'maps', name: 'Maps', home: 'https://www.google.com/maps', hosts: ['www.google.com'], prefix: '/maps', style: 'query', caveat: 'Only saved places and history depend on the account.' },
  // Developer and business
  { id: 'cloud', name: 'Cloud console', home: 'https://console.cloud.google.com/', hosts: ['console.cloud.google.com'], prefix: '', style: 'query' },
  { id: 'firebase', name: 'Firebase console', home: 'https://console.firebase.google.com/', hosts: ['console.firebase.google.com'], prefix: '', style: 'query', caveat: 'Firebase may turn ?authuser into /u/N/ itself.' },
  { id: 'analytics', name: 'Analytics', home: 'https://analytics.google.com/', hosts: ['analytics.google.com'], prefix: '', style: 'query' },
  { id: 'ads', name: 'Google Ads', home: 'https://ads.google.com/', hosts: ['ads.google.com'], prefix: '', style: 'query', caveat: 'Ads may still ask which customer ID to open.' },
  { id: 'adsense', name: 'AdSense', home: 'https://adsense.google.com/', hosts: ['adsense.google.com'], prefix: '', style: 'query', caveat: 'AdSense prefers /u/N/; ?authuser may not stick on every page.' },
  { id: 'search-console', name: 'Search Console', home: 'https://search.google.com/search-console', hosts: ['search.google.com'], prefix: '/search-console', style: 'query' },
  { id: 'tag-manager', name: 'Tag Manager', home: 'https://tagmanager.google.com/', hosts: ['tagmanager.google.com'], prefix: '', style: 'query' },
  { id: 'play-console', name: 'Play Console', home: 'https://play.google.com/console', hosts: ['play.google.com'], prefix: '/console', style: 'query', caveat: 'The Play Store itself is left alone.' },
  { id: 'looker-studio', name: 'Looker Studio', home: 'https://lookerstudio.google.com/', hosts: ['lookerstudio.google.com'], prefix: '', style: 'query' },
  { id: 'myaccount', name: 'Google Account', home: 'https://myaccount.google.com/', hosts: ['myaccount.google.com'], prefix: '', style: 'query' },
];

/** Other Google hosts that accept ?authuser. Used by "switch this tab", never by pin mode. */
export const EXTRA_QUERY_HOSTS: readonly string[] = [
  'groups.google.com', 'voice.google.com', 'script.google.com', 'colab.research.google.com',
  'aistudio.google.com', 'one.google.com', 'merchants.google.com', 'business.google.com',
  'admanager.google.com', 'tasks.google.com', 'shell.cloud.google.com', 'issuetracker.google.com',
  'workspace.google.com', 'news.google.com', 'music.youtube.com',
];

/** Hosts (and their subdomains) that are never rewritten. */
export const NEVER_HOST_SUFFIXES: readonly string[] = [
  'accounts.google.com', 'accounts.youtube.com', 'ogs.google.com',
  'gstatic.com', 'googleapis.com', 'googleusercontent.com',
];

/** Sign-in, sign-out and OAuth paths on any service host. */
export const GLOBAL_NEVER_PATHS: readonly string[] = [
  // Any path segment, e.g. /logout and /mail/logout.
  '/(?:[^?#]*/)?(?:ServiceLogin|ServiceLogout|signin|signout|logout|AccountChooser|AddSession)(?:[/?#]|$)',
  '/o/oauth2/',
  '/accounts/',
];

/** Hosts the wizard and ListAccounts need besides the catalog. */
export const ACCOUNT_HOSTS: readonly string[] = ['accounts.google.com', 'myaccount.google.com'];

/**
 * Every host Lineup needs access to: catalog hosts, EXTRA_QUERY_HOSTS and the account pages.
 * wxt.config.ts turns these into https-only host_permissions, so tab.url is only visible here.
 */
export function permissionHosts(): string[] {
  return [...new Set([...SERVICES.flatMap((s) => s.hosts), ...EXTRA_QUERY_HOSTS, ...ACCOUNT_HOSTS])].sort();
}

export const SERVICE_IDS: ReadonlySet<string> = new Set(SERVICES.map((s) => s.id));

export function serviceById(id: string): Service | undefined {
  return SERVICES.find((s) => s.id === id);
}

export function toServiceInfo(s: Service): ServiceInfo {
  return { id: s.id, name: s.name, home: s.home };
}

/** `path` equals `prefix` or continues it with a '/'. */
export function underSegment(path: string, prefix: string): boolean {
  if (prefix === '') return true;
  if (!path.startsWith(prefix)) return false;
  const next = path.charAt(prefix.length);
  return next === '' || next === '/';
}

/** Service for a URL: matching host, longest matching prefix. */
export function findService(url: URL): Service | undefined {
  const host = url.hostname.toLowerCase();
  let best: Service | undefined;
  for (const s of SERVICES) {
    if (!s.hosts.includes(host) || !underSegment(url.pathname, s.prefix)) continue;
    if (!best || s.prefix.length > best.prefix.length) best = s;
  }
  return best;
}

export function isNeverHost(host: string): boolean {
  const h = host.toLowerCase();
  return NEVER_HOST_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

const compiled = new Map<string, RegExp>();
function pathMatches(pattern: string, pathAndQuery: string): boolean {
  let re = compiled.get(pattern);
  if (!re) {
    re = new RegExp(`^(?:${pattern})`, 'i');
    compiled.set(pattern, re);
  }
  return re.test(pathAndQuery);
}

/** True for URLs Lineup must never touch (sign-in flows, downloads, static hosts, ...). */
export function isNeverRewrite(url: URL, service = findService(url)): boolean {
  if (isNeverHost(url.hostname)) return true;
  const path = url.pathname + url.search;
  if (GLOBAL_NEVER_PATHS.some((p) => pathMatches(p, path))) return true;
  return (service?.never ?? []).some((p) => pathMatches(p, path));
}
