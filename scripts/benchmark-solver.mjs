// Times how long the solver from app/page.tsx takes to compute a full game.
// Every answer is played to completion with the solver's own (entropy-optimal)
// guesses, and every decision is computed from scratch — no cache shared
// between games — so each game costs what it would cost a user in the app.
//
// Reports, per game: mean / median / p90 / p99 / max compute time.
// Per decision (one entropy search over the full guess list): mean time,
// and mean time grouped by turn number.
// The opening guess is fixed, so it costs nothing; games solved by guess 2 or
// that only ever have ≤ 2 candidates left involve no entropy search at all.
//
// Options:
//   --url <url>     load word lists from the app's API (see evaluate-solver.mjs)
//   --start <word>  opening guess (default: tarse)
//   --limit <n>     only time the first n answers (quick check)
//   --warmup <n>    untimed games first so the JIT is warmed up (default: 20)
//   --json <path>   also write per-game results to a JSON file
//
// Run: node scripts/benchmark-solver.mjs

import { writeFile } from "node:fs/promises";
import os from "node:os";
import { loadWords, createSolver, MAX_GUESSES } from "./solver-core.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const apiUrl = argValue("--url");
const startWord = (argValue("--start") ?? "tarse").toLowerCase();
const limit = Number(argValue("--limit") ?? Infinity);
const warmup = Number(argValue("--warmup") ?? 20);
const jsonPath = argValue("--json");

const { guesses, answers: allAnswers, source } = await loadWords(apiUrl);
const { solve, hasStart } = createSolver({ guesses, answers: allAnswers, startWord });
if (!hasStart) console.warn(`Warning: start word "${startWord}" isn't in the guess list.`);
const answers = allAnswers.slice(0, limit);

console.log(`Word lists: ${source} — ${guesses.length} guesses, ${allAnswers.length} answers`);
console.log(`Opening guess: ${startWord}`);
console.log(`Machine: ${os.cpus()[0]?.model ?? "unknown CPU"}, Node ${process.version}`);
console.log(`Timing ${answers.length} games (no cache, ${warmup} warm-up games)\n`);

// Warm-up: let V8 optimise the hot loops before timing.
for (let i = 0; i < Math.min(warmup, allAnswers.length); i++) solve(allAnswers[allAnswers.length - 1 - i]);

const games = [];
const decisions = []; // { ms, candidates, turn }
const started = performance.now();

answers.forEach((answer, i) => {
  let turn = 1;
  const t0 = performance.now();
  const { count, path, error } = solve(answer, {
    onDecision: (ms, candidates) => decisions.push({ ms, candidates, turn: ++turn }),
  });
  const ms = performance.now() - t0;
  games.push({ answer, ms, guesses: count, path, error });
  if ((i + 1) % 100 === 0) process.stdout.write(`  ${i + 1}/${answers.length}\r`);
});

const wallMs = performance.now() - started;

// ---- Report -----------------------------------------------------------------
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`);

const times = games.map((g) => g.ms).sort((a, b) => a - b);
const solved = games.filter((g) => Number.isFinite(g.guesses));
const slowest = [...games].sort((a, b) => b.ms - a.ms).slice(0, 5);

console.log(`\nPer game (${games.length} games):`);
console.log(`  mean    ${fmt(mean(times))}`);
console.log(`  median  ${fmt(pct(times, 50))}`);
console.log(`  p90     ${fmt(pct(times, 90))}`);
console.log(`  p99     ${fmt(pct(times, 99))}`);
console.log(`  min     ${fmt(times[0])}`);
console.log(`  max     ${fmt(times[times.length - 1])}`);

console.log(`\nPer decision (entropy search over ${guesses.length} guesses, ${decisions.length} total):`);
console.log(`  mean    ${fmt(mean(decisions.map((d) => d.ms)))}`);
console.log(`  avg decisions per game  ${(decisions.length / games.length).toFixed(2)}`);
const byTurn = new Map();
for (const d of decisions) (byTurn.get(d.turn) ?? byTurn.set(d.turn, []).get(d.turn)).push(d);
console.log("  by turn chosen:");
for (const turn of [...byTurn.keys()].sort((a, b) => a - b)) {
  const ds = byTurn.get(turn);
  console.log(
    `    guess ${turn}: ${String(ds.length).padStart(5)} searches, mean ${fmt(mean(ds.map((d) => d.ms))).padStart(9)}, ` +
      `avg ${mean(ds.map((d) => d.candidates)).toFixed(1)} candidates`,
  );
}

console.log("\nTime by guesses needed:");
const byCount = new Map();
for (const g of solved) (byCount.get(g.guesses) ?? byCount.set(g.guesses, []).get(g.guesses)).push(g.ms);
for (const n of [...byCount.keys()].sort((a, b) => a - b)) {
  const ms = byCount.get(n);
  console.log(`  ${n} guesses: ${String(ms.length).padStart(5)} games, mean ${fmt(mean(ms))}`);
}

console.log("\nSlowest games:");
for (const g of slowest) console.log(`  ${g.answer}: ${fmt(g.ms)}  (${g.path.join(" → ")})`);

const failed = games.filter((g) => !Number.isFinite(g.guesses) || g.guesses > MAX_GUESSES);
console.log(`\nAverage guesses: ${mean(solved.map((g) => g.guesses)).toFixed(4)}, failures: ${failed.length}`);
console.log(`Total compute: ${fmt(wallMs)}`);

if (jsonPath) {
  await writeFile(jsonPath, JSON.stringify({ source, startWord, games, decisions }, null, 2));
  console.log(`Wrote ${jsonPath}`);
}
