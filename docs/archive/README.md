# Archive

Planning documents whose work is finished. Kept for provenance — they explain
*why* the code looks the way it does, but they are no longer instructions and
should not be followed as if they were.

- **`KICKOFF.md`** — the original brief for build-order steps 2–4. All three
  steps are done. Its "watch for and raise rather than quietly solve" list is
  still live, and the answers are recorded in the root `README.md`.
- **`DELEGATION.md`** — the work-package breakdown (WP-0 … WP-5) those steps
  were built from. Every package shipped. Three of its calls were overridden
  during the build; each override is explained in the commit that made it:
  - `vite ^6` → `^5` (vitest 2.1's peer dependency is vite 5)
  - `.segs i` sized by `scaleX` → static one-time `width` (it is a flex row)
  - delivery detected per-agent → per-pod (the sim idles every agent on a pod
    in one frame, so the per-agent rule fired N times per delivery)

The live design documents are still in `docs/`, and the handover PDF still
wins any conflict.
