/**
 * The high scores table.
 *
 * Score is final cash — `s.score = Math.round(s.cash)` in the sim's
 * `finalise()`. That is the "one number at the end" the whole design is built
 * around, so the board needs no derived stat and shows none.
 *
 * Fetched fresh each time it opens rather than cached: it is a handful of rows,
 * and a stale board is worse than a slow one.
 *
 * Grey throughout. Nothing here is clickable except BACK, and money is green on
 * the floor because it is a live quantity you are managing — a finished score in
 * a table is not that, so it stays in the neutral palette rather than borrowing
 * a meaning it does not have.
 */

import { LEADERBOARD_LIMIT } from "../save/config";
import { fetchScores, type SaveManager, type ScoreRow } from "../save/store";
import { el } from "./identity";

export interface ScoresView {
  root: HTMLElement;
  /** Fetches and renders. Call whenever the view becomes visible. */
  refresh(): void;
}

function formatMoney(score: number): string {
  return "$" + Math.round(score).toLocaleString();
}

export function buildScores(manager: SaveManager): ScoresView {
  const root = el("div", "scores");
  const table = el("div", "scores-table");
  const status = el("div", "studio-msg");

  root.append(table, status);

  function renderRows(rows: ScoreRow[]): void {
    table.replaceChildren();
    if (rows.length === 0) {
      status.textContent = "No runs on the board yet. Be the first.";
      return;
    }

    rows.forEach((row, i) => {
      const line = el("div", "scores-row");
      line.append(
        el("span", "scores-rank", String(i + 1)),
        // textContent throughout — a display name is another player's text and
        // never becomes markup.
        el("span", "scores-name", row.name),
        el("span", "scores-score", formatMoney(row.score)),
      );
      // The server decides which row is yours, by comparing the studio id it
      // stored against the token you sent. Matching on name and score here
      // instead would highlight every player who happens to share both.
      if (row.me) line.classList.add("is-me");
      table.append(line);
    });

    const mine = rows.findIndex((r) => r.me);
    status.textContent = mine >= 0 ? `You are ${mine + 1} of ${rows.length}.` : "";
  }

  return {
    root,
    refresh(): void {
      status.textContent = "Loading…";
      table.replaceChildren();
      manager
        .token()
        .then((token) => fetchScores(LEADERBOARD_LIMIT, token))
        .then(renderRows, () => {
          table.replaceChildren();
          status.textContent = "High scores need the server — it is not reachable right now.";
        });
    },
  };
}
