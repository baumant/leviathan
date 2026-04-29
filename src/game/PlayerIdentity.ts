const LEADERBOARD_USERNAME_KEY = 'leviathan.leaderboard.username.v1';
const MAX_USERNAME_LENGTH = 24;

export type LeaderboardUsernameSource = 'portal' | 'stored';

export interface LeaderboardUsername {
  source: LeaderboardUsernameSource;
  username: string;
}

export function getPreferredLeaderboardUsername(location: Location = window.location): LeaderboardUsername | null {
  const portalUsername = sanitizeLeaderboardUsername(new URLSearchParams(location.search).get('username') ?? '');

  if (portalUsername) {
    return {
      source: 'portal',
      username: portalUsername,
    };
  }

  const storedUsername = readStoredLeaderboardUsername();

  if (!storedUsername) {
    return null;
  }

  return {
    source: 'stored',
    username: storedUsername,
  };
}

export function readStoredLeaderboardUsername(): string | null {
  try {
    return sanitizeLeaderboardUsername(window.localStorage.getItem(LEADERBOARD_USERNAME_KEY) ?? '');
  } catch {
    return null;
  }
}

export function writeStoredLeaderboardUsername(username: string): void {
  const sanitized = sanitizeLeaderboardUsername(username);

  if (!sanitized) {
    return;
  }

  try {
    window.localStorage.setItem(LEADERBOARD_USERNAME_KEY, sanitized);
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}

export function sanitizeLeaderboardUsername(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_USERNAME_LENGTH);
}
