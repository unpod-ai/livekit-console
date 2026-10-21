export type Capabilities = { transcripts: boolean; recordings: boolean; logs: boolean };
export type Project = { id: string; name: string; role: 'admin' | 'viewer'; capabilities: Capabilities; globalAdmin: boolean; backend: { state: string } };
let legacyDefault = false;
export const selectedProject = () => new URLSearchParams(window.location.search).get('project') || 'default';
export const setLegacyDefault = (enabled: boolean) => { legacyDefault = enabled; };
export const isLegacyDefault = () => legacyDefault && selectedProject() === 'default';

/** Scope raw console resource paths, including native media and downloads. */
export function projectResource(path: string): string {
  if (!path.startsWith('/api/')) throw new Error('Expected a console API resource');
  if (/^\/api\/(auth\/(login|logout)(?:[/?]|$)|users(?:[/?]|$)|projects(?:[/?]|$))/.test(path)) return path;
  return isLegacyDefault() ? path : `/p/${encodeURIComponent(selectedProject())}${path}`;
}

/** Keep copied links and all history-based navigation in the selected project. */
export function projectHref(value: string): string {
  if (/^(?:[a-z]+:|\/\/)/i.test(value)) return value;
  const url = new URL(value, window.location.href);
  if (!url.searchParams.has('project')) url.searchParams.set('project', selectedProject());
  return `${url.pathname}${url.search}${url.hash}`;
}

export function installProjectHistory() {
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (data, unused, url) => original(data, unused, url == null ? url : projectHref(String(url)));
  }
}
