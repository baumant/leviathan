interface Env {
  DB: D1Database;
}

interface LeaderboardRequestBody {
  username?: unknown;
  score?: unknown;
  timeSurvivedSeconds?: unknown;
  shipsDestroyed?: unknown;
}

interface LeaderboardRow {
  username_key: string;
  username: string;
  score: number;
  time_survived_seconds: number;
  ships_destroyed: number;
  updated_at: string;
}

interface LeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  timeSurvivedSeconds: number;
  shipsDestroyed: number;
  updatedAt: string;
  isCurrentPlayer?: boolean;
}

const ALLOWED_ORIGINS = new Set([
  'https://leviathan.timothybauman.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
]);
const DEFAULT_LEADERBOARD_LIMIT = 10;
const MAX_LEADERBOARD_LIMIT = 50;
const MAX_USERNAME_LENGTH = 24;
const MAX_SCORE = 100_000_000;
const MAX_TIME_SURVIVED_SECONDS = 24 * 60 * 60;
const MAX_SHIPS_DESTROYED = 100_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return withCors(request, new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/leaderboard' && request.method === 'GET') {
        return withCors(request, await handleGetLeaderboard(url, env));
      }

      if (url.pathname === '/leaderboard' && request.method === 'POST') {
        return withCors(request, await handlePostLeaderboard(request, env));
      }

      return withCors(request, json({ error: 'Not found' }, 404));
    } catch (error) {
      const message = error instanceof RequestError ? error.message : 'Leaderboard unavailable';
      const status = error instanceof RequestError ? error.status : 500;
      return withCors(request, json({ error: message }, status));
    }
  },
};

async function handleGetLeaderboard(url: URL, env: Env): Promise<Response> {
  const limit = parseLimit(url.searchParams.get('limit'));
  const rawCurrentUsername = url.searchParams.get('username');
  const currentUsername = rawCurrentUsername ? sanitizeUsername(rawCurrentUsername) : null;
  const currentUsernameKey = currentUsername ? normalizeUsernameKey(currentUsername) : null;
  const entries = await readTopEntries(env, limit, currentUsernameKey);

  return json({ entries });
}

async function handlePostLeaderboard(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const username = sanitizeUsername(body.username);
  const usernameKey = normalizeUsernameKey(username);
  const score = parseBoundedInteger(body.score, 'score', MAX_SCORE);
  const timeSurvivedSeconds = parseBoundedNumber(
    body.timeSurvivedSeconds,
    'timeSurvivedSeconds',
    MAX_TIME_SURVIVED_SECONDS,
  );
  const shipsDestroyed = parseBoundedInteger(body.shipsDestroyed, 'shipsDestroyed', MAX_SHIPS_DESTROYED);
  const updatedAt = new Date().toISOString();

  const savedRow = await env.DB.prepare(
    `INSERT INTO leaderboard_entries (
      username_key,
      username,
      score,
      time_survived_seconds,
      ships_destroyed,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username_key) DO UPDATE SET
      username = excluded.username,
      score = excluded.score,
      time_survived_seconds = excluded.time_survived_seconds,
      ships_destroyed = excluded.ships_destroyed,
      updated_at = excluded.updated_at
    WHERE
      excluded.score > leaderboard_entries.score OR
      (
        excluded.score = leaderboard_entries.score AND
        excluded.time_survived_seconds > leaderboard_entries.time_survived_seconds
      ) OR
      (
        excluded.score = leaderboard_entries.score AND
        excluded.time_survived_seconds = leaderboard_entries.time_survived_seconds AND
        excluded.ships_destroyed > leaderboard_entries.ships_destroyed
      )
    RETURNING username_key, username, score, time_survived_seconds, ships_destroyed, updated_at`,
  )
    .bind(usernameKey, username, score, timeSurvivedSeconds, shipsDestroyed, updatedAt, updatedAt)
    .first<LeaderboardRow>();

  const accepted = Boolean(savedRow);
  const row = savedRow ?? (await readEntry(env, usernameKey));

  if (!row) {
    throw new RequestError('Could not save leaderboard entry', 500);
  }

  const rank = await readRank(env, row);
  const entries = await readTopEntries(env, DEFAULT_LEADERBOARD_LIMIT, usernameKey);

  return json({
    accepted,
    entry: toEntry(row, rank, usernameKey),
    entries,
  });
}

async function readJsonBody(request: Request): Promise<LeaderboardRequestBody> {
  let parsed: unknown;

  try {
    parsed = await request.json();
  } catch {
    throw new RequestError('Expected JSON body', 400);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RequestError('Expected JSON object', 400);
  }

  return parsed as LeaderboardRequestBody;
}

async function readTopEntries(env: Env, limit: number, currentUsernameKey: string | null): Promise<LeaderboardEntry[]> {
  const result = await env.DB.prepare(
    `SELECT username_key, username, score, time_survived_seconds, ships_destroyed, updated_at
    FROM leaderboard_entries
    ORDER BY score DESC, time_survived_seconds DESC, ships_destroyed DESC, updated_at ASC, username_key ASC
    LIMIT ?`,
  )
    .bind(limit)
    .all<LeaderboardRow>();

  return result.results.map((row, index) => toEntry(row, index + 1, currentUsernameKey));
}

async function readEntry(env: Env, usernameKey: string): Promise<LeaderboardRow | null> {
  return env.DB.prepare(
    `SELECT username_key, username, score, time_survived_seconds, ships_destroyed, updated_at
    FROM leaderboard_entries
    WHERE username_key = ?
    LIMIT 1`,
  )
    .bind(usernameKey)
    .first<LeaderboardRow>();
}

async function readRank(env: Env, row: LeaderboardRow): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) + 1 AS rank
    FROM leaderboard_entries
    WHERE
      score > ? OR
      (score = ? AND time_survived_seconds > ?) OR
      (score = ? AND time_survived_seconds = ? AND ships_destroyed > ?) OR
      (
        score = ? AND
        time_survived_seconds = ? AND
        ships_destroyed = ? AND
        (
          updated_at < ? OR
          (updated_at = ? AND username_key < ?)
        )
      )`,
  )
    .bind(
      row.score,
      row.score,
      row.time_survived_seconds,
      row.score,
      row.time_survived_seconds,
      row.ships_destroyed,
      row.score,
      row.time_survived_seconds,
      row.ships_destroyed,
      row.updated_at,
      row.updated_at,
      row.username_key,
    )
    .first<{ rank: number }>();

  return Math.max(1, Math.floor(result?.rank ?? 1));
}

function toEntry(row: LeaderboardRow, rank: number, currentUsernameKey: string | null): LeaderboardEntry {
  return {
    rank,
    username: row.username,
    score: row.score,
    timeSurvivedSeconds: row.time_survived_seconds,
    shipsDestroyed: row.ships_destroyed,
    updatedAt: row.updated_at,
    isCurrentPlayer: currentUsernameKey === row.username_key || undefined,
  };
}

function parseLimit(rawLimit: string | null): number {
  if (!rawLimit) {
    return DEFAULT_LEADERBOARD_LIMIT;
  }

  const limit = Number(rawLimit);

  if (!Number.isInteger(limit)) {
    return DEFAULT_LEADERBOARD_LIMIT;
  }

  return Math.min(MAX_LEADERBOARD_LIMIT, Math.max(1, limit));
}

function sanitizeUsername(value: unknown): string {
  if (typeof value !== 'string') {
    throw new RequestError('Username is required', 400);
  }

  const username = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_USERNAME_LENGTH);

  if (!username) {
    throw new RequestError('Username is required', 400);
  }

  return username;
}

function normalizeUsernameKey(username: string): string {
  return username.toLocaleLowerCase('en-US');
}

function parseBoundedInteger(value: unknown, field: string, max: number): number {
  const parsed = parseBoundedNumber(value, field, max);

  if (!Number.isInteger(parsed)) {
    throw new RequestError(`${field} must be an integer`, 400);
  }

  return parsed;
}

function parseBoundedNumber(value: unknown, field: string, max: number): number {
  const parsed = typeof value === 'number' ? value : NaN;

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
    throw new RequestError(`${field} is out of range`, 400);
  }

  return parsed;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get('Origin');
  const headers = new Headers(response.headers);

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Vary', 'Origin');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
