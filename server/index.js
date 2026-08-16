/**
 * Agent Idol server: the built game plus a two-route save API.
 *
 * There are no accounts, no sessions, no cookies and no PII. A studio is a
 * blob of a few hundred bytes addressed by a hash, and the hash is the whole
 * credential — see src/save/key.ts for why that is the right trade here and
 * what it deliberately does not protect against.
 *
 *   GET  /api/save     200 the save | 404 nothing stored yet
 *   PUT  /api/save     200 stored
 *   PUT  /api/score    200 recorded (upsert, best score wins)
 *   GET  /api/scores   200 the top rows; flags your own if a token is sent
 *   GET  /api/health   200 { ok, store }
 *
 * The studio token travels in the `x-studio-token` HEADER, never in the path or
 * the query string. It is the whole credential, and URLs are the one part of a
 * request that reliably ends up written down — access logs, proxy logs, browser
 * history, `Referer`. Headers are not logged by default anywhere in that chain.
 *
 * The token is SHA-256(studio key), computed in the browser. The plaintext key
 * never reaches this process at all.
 *
 * KNOWN LIMITATION — the leaderboard is client-authoritative. The browser sends
 * a number and this process believes it, so anyone with devtools can post any
 * score they like. Only the cheap defences are in place: one row per studio,
 * best-score-wins, a sanity ceiling, and rate limiting. Making it trustworthy
 * needs server-side verification, and the sim is seeded and deterministic
 * precisely so that a replay log could be re-simulated here later. Until that
 * exists, treat the board as social, not competitive.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

import { createStore, storageId } from "./store.js";

const PORT = Number(process.env.PORT || 3000);
const DIST = resolve(process.env.STATIC_DIR || "dist");

/** Biggest save we will accept. A real save is well under 2KB. */
const MAX_BODY_BYTES = 16 * 1024;

/** Save-API requests allowed per IP per window. */
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 60);
const RATE_WINDOW_MS = 60_000;

/** Schema version this server will store. Matches SAVE_VERSION in src/save. */
const SAVE_VERSION = 1;

/** Rows returned by the leaderboard, and the ceiling a caller may ask for. */
const DEFAULT_BOARD_LIMIT = 25;
const MAX_BOARD_LIMIT = 100;

/** Matches MAX_NAME_LENGTH in src/save/config.ts. */
const MAX_NAME_LENGTH = 18;

/**
 * Sanity ceiling on a submitted score.
 *
 * Not an anti-cheat measure — the board is client-authoritative and this does
 * not change that. It only keeps the table sortable and readable, so a single
 * `Number.MAX_SAFE_INTEGER` submission cannot permanently pin the top row.
 */
const MAX_SCORE = 100_000_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

// ---------------------------------------------------------------------------
// rate limiting
// ---------------------------------------------------------------------------

/**
 * Fixed-window counter per client IP.
 *
 * This is what makes a four-word key (2^32) safe rather than merely large: at
 * 60 tries a minute it is roughly 136 years of sustained guessing to cover 1%
 * of the space, per IP.
 *
 * In-memory, so it resets on redeploy and is per-instance. That is proportional
 * to a browser game; if this ever runs on several instances, move the counter
 * to the store.
 */
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now >= entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

// Unbounded growth here would be a slow memory leak under scan traffic.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) if (now >= entry.resetAt) hits.delete(ip);
}, RATE_WINDOW_MS).unref();

function clientIp(req) {
  // Railway terminates TLS at its edge and forwards the real address here.
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    // A save is per-player and must never be held by a shared cache.
    "cache-control": "no-store",
  });
  res.end(payload);
}

/** Tokens are hex SHA-256 digests. Anything else never reaches the store. */
function validToken(token) {
  return typeof token === "string" && /^[0-9a-f]{64}$/.test(token);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop reading rather than buffering an attacker's upload.
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * The server is a blob store, not a rules engine — the client owns the save
 * shape and re-validates every field on load anyway. This only rejects what
 * would make the store itself unhealthy: unparseable bodies, non-objects, and
 * versions this build does not recognise.
 */
function acceptableSave(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.v !== SAVE_VERSION) return null;
  return parsed;
}

/**
 * Validates a leaderboard submission.
 *
 * Names are cleaned again here rather than trusted from the client: the client
 * cleaning is for the player's benefit, this one is because anything reaching
 * the table is about to be shown to every other player.
 */
function acceptableScore(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const { name, score, seed } = parsed;
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (score < 0 || score > MAX_SCORE) return null;
  if (typeof seed !== "string" || seed.length > 64) return null;

  const cleaned = (typeof name === "string" ? name : "")
    // C0/C1 controls, zero-width characters and bidirectional overrides — the
    // codepoints that let one row rewrite the rows around it.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);

  return { name: cleaned || "ANONYMOUS", score: Math.round(score), seed };
}

// ---------------------------------------------------------------------------
// static files
// ---------------------------------------------------------------------------

async function serveStatic(req, res, pathname) {
  // normalize() collapses `..` before the join, so a crafted path cannot escape
  // DIST and read the filesystem.
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, rel);

  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, "index.html");
    info = await stat(file).catch(() => null);
  }
  if (!info?.isFile()) {
    // Single page: unknown paths fall back to the shell.
    file = join(DIST, "index.html");
    info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found. Run `npm run build` first.\n");
      return;
    }
  }

  const ext = extname(file).toLowerCase();
  const isHashed = /-[A-Za-z0-9_]{8,}\.\w+$/.test(file);
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "content-length": info.size,
    // Vite fingerprints its assets, so those are immutable. index.html is not.
    "cache-control": isHashed ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

const store = await createStore(process.env);

if (store.kind === "file" && process.env.RAILWAY_ENVIRONMENT && !process.env.SAVE_DATA_DIR) {
  console.warn(
    "\n  WARNING: running on Railway with the file store and no SAVE_DATA_DIR.\n" +
      "  Container filesystems are ephemeral — every studio will be lost on redeploy.\n" +
      "  Add a Postgres service (Railway injects DATABASE_URL), or mount a volume\n" +
      "  and set SAVE_DATA_DIR to its mount path.\n",
  );
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const { pathname } = url;

  try {
    if (pathname === "/api/health") {
      sendJson(res, 200, { ok: true, store: store.describe() });
      return;
    }

    // Every /api route below is rate limited: the save routes because the
    // token is the credential, the score routes because they write.
    const isApi = pathname.startsWith("/api/");
    if (isApi && rateLimited(clientIp(req))) {
      res.setHeader("retry-after", String(RATE_WINDOW_MS / 1000));
      sendJson(res, 429, { error: "slow down" });
      return;
    }

    const token = req.headers["x-studio-token"];

    if (pathname === "/api/scores" && req.method === "GET") {
      const asked = Number(url.searchParams.get("limit") || DEFAULT_BOARD_LIMIT);
      const limit = Number.isFinite(asked)
        ? Math.min(MAX_BOARD_LIMIT, Math.max(1, Math.floor(asked)))
        : DEFAULT_BOARD_LIMIT;
      // A token here is optional and read-only: it only lets the server flag
      // which row is the caller's own, so the client does not have to guess by
      // matching on name and score.
      const meId = validToken(token) ? storageId(token) : null;
      sendJson(res, 200, { scores: await store.topScores(limit, meId) });
      return;
    }

    if (pathname === "/api/score") {
      if (req.method !== "PUT") {
        res.writeHead(405, { allow: "PUT" });
        res.end();
        return;
      }
      if (!validToken(token)) {
        sendJson(res, 400, { error: "bad token" });
        return;
      }
      const entry = acceptableScore(await readBody(req));
      if (entry === null) {
        sendJson(res, 400, { error: "bad score" });
        return;
      }
      // Keyed by the same double-hashed id as the save, so a studio owns
      // exactly one row and cannot flood the table.
      await store.recordScore(storageId(token), entry);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/save") {
      if (!validToken(token)) {
        sendJson(res, 400, { error: "bad token" });
        return;
      }
      const id = storageId(token);

      if (req.method === "GET") {
        const blob = await store.get(id);
        if (blob === null) sendJson(res, 404, { error: "no studio" });
        else sendJson(res, 200, blob);
        return;
      }

      if (req.method === "PUT") {
        const body = await readBody(req);
        const blob = acceptableSave(body);
        if (blob === null) {
          sendJson(res, 400, { error: "bad save" });
          return;
        }
        await store.put(id, blob);
        sendJson(res, 200, { ok: true });
        return;
      }

      res.writeHead(405, { allow: "GET, PUT" });
      res.end();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }

    await serveStatic(req, res, pathname);
  } catch (err) {
    const status = err?.status || 500;
    // Log server-side, but never hand an internal message back to the client.
    if (status >= 500) console.error("request failed:", err);
    if (!res.headersSent) sendJson(res, status, { error: status === 413 ? "too large" : "server error" });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Agent Idol on :${PORT} — serving ${DIST}, saves in ${store.describe()}`);
});
