export interface LeaderboardRunSubmission {
  username: string;
  score: number;
  timeSurvivedSeconds: number;
  shipsDestroyed: number;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  timeSurvivedSeconds: number;
  shipsDestroyed: number;
  updatedAt: string;
  isCurrentPlayer?: boolean;
}

export interface LeaderboardSubmitResult {
  accepted: boolean;
  entry: LeaderboardEntry;
  entries: LeaderboardEntry[];
}

interface LeaderboardListResponse {
  entries?: unknown;
}

interface LeaderboardSubmitResponse extends LeaderboardListResponse {
  accepted?: unknown;
  entry?: unknown;
}

const LEADERBOARD_REQUEST_TIMEOUT_MS = 7000;
const DEFAULT_LEADERBOARD_LIMIT = 10;

export class LeaderboardClient {
  constructor(private readonly baseUrl: URL) {}

  async list(username: string | null = null, limit = DEFAULT_LEADERBOARD_LIMIT): Promise<LeaderboardEntry[]> {
    const url = new URL('/leaderboard', this.baseUrl);
    url.searchParams.set('limit', `${limit}`);

    if (username) {
      url.searchParams.set('username', username);
    }

    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
    const payload = await readJson<LeaderboardListResponse>(response);
    return parseEntries(payload.entries);
  }

  async submit(run: LeaderboardRunSubmission): Promise<LeaderboardSubmitResult> {
    const url = new URL('/leaderboard', this.baseUrl);
    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(run),
    });
    const payload = await readJson<LeaderboardSubmitResponse>(response);
    const entry = parseEntry(payload.entry);

    if (!entry) {
      throw new Error('Leaderboard response did not include the saved entry.');
    }

    return {
      accepted: payload.accepted === true,
      entry,
      entries: parseEntries(payload.entries),
    };
  }

  private async fetchWithTimeout(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), LEADERBOARD_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Leaderboard request failed with ${response.status}.`);
      }

      return response;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

export function createLeaderboardClient(): LeaderboardClient | null {
  const apiUrl = import.meta.env.VITE_LEADERBOARD_API_URL?.trim();

  if (!apiUrl) {
    return null;
  }

  try {
    return new LeaderboardClient(new URL(apiUrl));
  } catch {
    return null;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error('Leaderboard response was not valid JSON.');
  }
}

function parseEntries(value: unknown): LeaderboardEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(parseEntry).filter((entry): entry is LeaderboardEntry => Boolean(entry));
}

function parseEntry(value: unknown): LeaderboardEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<LeaderboardEntry>;

  if (
    typeof candidate.rank !== 'number' ||
    typeof candidate.username !== 'string' ||
    typeof candidate.score !== 'number' ||
    typeof candidate.timeSurvivedSeconds !== 'number' ||
    typeof candidate.shipsDestroyed !== 'number' ||
    typeof candidate.updatedAt !== 'string'
  ) {
    return null;
  }

  return {
    rank: Math.max(1, Math.floor(candidate.rank)),
    username: candidate.username,
    score: Math.max(0, Math.floor(candidate.score)),
    timeSurvivedSeconds: Math.max(0, candidate.timeSurvivedSeconds),
    shipsDestroyed: Math.max(0, Math.floor(candidate.shipsDestroyed)),
    updatedAt: candidate.updatedAt,
    isCurrentPlayer: candidate.isCurrentPlayer === true || undefined,
  };
}
