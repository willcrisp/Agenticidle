/**
 * Storage drivers for the studio save API.
 *
 * Two of them, picked by environment:
 *
 *   postgres  when DATABASE_URL is set. This is the one to use on Railway —
 *             add a Postgres service and Railway injects DATABASE_URL into this
 *             service automatically.
 *   file      otherwise. One file per studio, sharded two levels deep so a
 *             directory never fills up. Fine locally.
 *
 * The file driver is a real trap on Railway specifically: a container's
 * filesystem is ephemeral unless a volume is mounted, so saves would vanish on
 * every redeploy. index.js warns loudly at boot when that combination looks
 * likely rather than losing player data quietly.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Storage id for a studio.
 *
 * The client already sent SHA-256(key); this hashes it AGAIN before it is
 * written down. That second hash is the point of the whole scheme: a dump of
 * this table yields ids that are neither the player's key nor the token the API
 * accepts, so a leak cannot be replayed against the service.
 */
export function storageId(token) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Rows the file-backed leaderboard keeps. The table only ever shows the top
 * handful; this is headroom so a score that later becomes competitive is not
 * discarded, without letting one file grow without bound.
 */
const MAX_BOARD_ROWS = 1000;

// ---------------------------------------------------------------------------
// file driver
// ---------------------------------------------------------------------------

function fileStore(dir) {
  const root = resolve(dir);

  // id is always a 64-char hex digest we produced ourselves, so it cannot
  // contain a path separator or traverse out of root.
  const pathFor = (id) => join(root, id.slice(0, 2), id.slice(2, 4), `${id}.json`);

  // The leaderboard lives in one file rather than being scanned out of the
  // per-studio files, which would mean reading every save on every page view.
  const boardPath = join(root, "leaderboard.json");

  // Read-modify-write on a shared file interleaves badly under concurrent
  // requests: two submissions racing would lose one. Every board write goes
  // through this chain, so they are applied one at a time.
  let boardLock = Promise.resolve();

  async function readBoard() {
    try {
      const parsed = JSON.parse(await readFile(boardPath, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  return {
    kind: "file",
    describe: () => `file store at ${root}`,

    async topScores(limit, meId = null) {
      const board = await readBoard();
      // `id` is never sent to the client — it is the stored digest. Only a
      // boolean derived from it goes out.
      return board.slice(0, limit).map(({ id, name, score, at }) => ({
        name,
        score,
        at,
        me: meId !== null && id === meId,
      }));
    },

    recordScore(id, entry) {
      boardLock = boardLock.then(async () => {
        const board = await readBoard();
        const existing = board.find((row) => row.id === id);
        // One row per studio, holding its best. Without this a player could
        // push the whole table down with repeated mediocre runs.
        if (existing && existing.score >= entry.score) {
          // Still let them correct the name attached to their best score.
          if (existing.name !== entry.name) {
            existing.name = entry.name;
          } else {
            return;
          }
        } else if (existing) {
          Object.assign(existing, entry, { id, at: new Date().toISOString() });
        } else {
          board.push({ id, ...entry, at: new Date().toISOString() });
        }
        board.sort((a, b) => b.score - a.score);
        const trimmed = board.slice(0, MAX_BOARD_ROWS);
        await mkdir(root, { recursive: true });
        const tmp = `${boardPath}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify(trimmed), "utf8");
        await rename(tmp, boardPath);
      });
      return boardLock;
    },

    async get(id) {
      try {
        return JSON.parse(await readFile(pathFor(id), "utf8"));
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },

    async put(id, blob) {
      const target = pathFor(id);
      await mkdir(dirname(target), { recursive: true });
      // Write-then-rename: a crash mid-write leaves the previous save intact
      // instead of a truncated file that fails to parse.
      const tmp = `${target}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(blob), "utf8");
      await rename(tmp, target);
    },
  };
}

// ---------------------------------------------------------------------------
// postgres driver
// ---------------------------------------------------------------------------

async function postgresStore(url) {
  let pg;
  try {
    pg = (await import("pg")).default;
  } catch {
    throw new Error("DATABASE_URL is set but the 'pg' package is not installed — run: npm install");
  }

  const pool = new pg.Pool({
    connectionString: url,
    // Railway's managed Postgres terminates TLS with a certificate this process
    // has no root for. The connection is still encrypted; only the chain is
    // unverified, and the payload is a game save.
    ssl: url.includes("localhost") || url.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS studio_save (
      id         TEXT PRIMARY KEY,
      blob       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // One row per studio holding its best score, so the table cannot be pushed
  // down by one player submitting repeatedly.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS studio_score (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      score      BIGINT NOT NULL,
      seed       TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS studio_score_score_idx ON studio_score (score DESC)",
  );

  return {
    kind: "postgres",
    describe: () => "postgres",

    async topScores(limit, meId = null) {
      const { rows } = await pool.query(
        `SELECT name, score, updated_at, (id = $2) AS me
         FROM studio_score ORDER BY score DESC, updated_at ASC LIMIT $1`,
        [limit, meId],
      );
      // BIGINT arrives as a string from pg; the client wants a number.
      return rows.map((r) => ({
        name: r.name,
        score: Number(r.score),
        at: r.updated_at.toISOString(),
        me: r.me === true,
      }));
    },

    async recordScore(id, entry) {
      await pool.query(
        `INSERT INTO studio_score (id, name, score, seed, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (id) DO UPDATE SET
           name       = EXCLUDED.name,
           score      = GREATEST(studio_score.score, EXCLUDED.score),
           seed       = CASE WHEN EXCLUDED.score > studio_score.score
                             THEN EXCLUDED.seed ELSE studio_score.seed END,
           updated_at = CASE WHEN EXCLUDED.score > studio_score.score
                             THEN now() ELSE studio_score.updated_at END`,
        [id, entry.name, Math.round(entry.score), entry.seed],
      );
    },

    async get(id) {
      const { rows } = await pool.query("SELECT blob FROM studio_save WHERE id = $1", [id]);
      return rows.length ? rows[0].blob : null;
    },

    async put(id, blob) {
      await pool.query(
        `INSERT INTO studio_save (id, blob, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET blob = EXCLUDED.blob, updated_at = now()`,
        [id, blob],
      );
    },
  };
}

/** Picks a driver from the environment. */
export async function createStore(env) {
  if (env.DATABASE_URL) return postgresStore(env.DATABASE_URL);
  return fileStore(env.SAVE_DATA_DIR || ".data");
}
