const VIBE_JAM_PORTAL_URL = 'https://vibej.am/portal/2026';

const FORWARDED_PARAM_DENY_LIST = new Set(['portal', 'ref']);

export function hasVibeJamPortalEntry(location: Location = window.location): boolean {
  return new URLSearchParams(location.search).get('portal') === 'true';
}

export function buildVibeJamExitPortalUrl(speed: number, location: Location = window.location): string {
  const url = new URL(VIBE_JAM_PORTAL_URL);
  copyForwardedParams(url.searchParams, location);
  url.searchParams.set('ref', location.host);

  if (speed > 0.1) {
    url.searchParams.set('speed', speed.toFixed(1));
  }

  return url.toString();
}

export function buildVibeJamReturnPortalUrl(location: Location = window.location): string | null {
  const returnRef = new URLSearchParams(location.search).get('ref');

  if (!returnRef) {
    return null;
  }

  const url = createReturnUrl(returnRef);

  if (!url) {
    return null;
  }

  copyForwardedParams(url.searchParams, location);
  url.searchParams.set('portal', 'true');
  url.searchParams.set('ref', location.host);
  return url.toString();
}

function copyForwardedParams(target: URLSearchParams, location: Location): void {
  const source = new URLSearchParams(location.search);

  for (const [key, value] of source.entries()) {
    if (FORWARDED_PARAM_DENY_LIST.has(key)) {
      continue;
    }

    target.append(key, value);
  }
}

function createReturnUrl(ref: string): URL | null {
  try {
    if (ref.startsWith('http://') || ref.startsWith('https://')) {
      return new URL(ref);
    }

    return new URL(`https://${ref}`);
  } catch {
    return null;
  }
}
