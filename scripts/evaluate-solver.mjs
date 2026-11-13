// Plays the solver from app/page.tsx against every answer and reports the
// average number of guesses, the distribution, and any failures (> 6 guesses).
// The strategy lives in scripts/solver-core.mjs (mirrors page.tsx).
//
// Word lists:
//   default        local files: public/data/words.csv (guesses) and
//                  data/original-answers.txt minus data/removed-answers.txt (answers)
//   --url <url>    the app's API instead, e.g. --url http://localhost:3000/api/words
//                  (run `npm run dev` first) so the lists match Supabase exactly
//
// Other options:
//   --start <word>  opening guess (default: tarse)
//   --verbose       print the guess sequence for every answer
//
// Run: node scripts/evaluate-solver.mjs

import { loadWords, createSolver, MAX_GUESSES } from "./solver-core.mjs";

// ---- CLI args ---------------------------------------------------------------
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const apiUrl = argValue("--url");
const startWord = (argValue("--start") ?? "tarse").toLowerCase();
const verbose = args.includes("--verbose");

// ---- Simulation -------------------------------------------------------------
const { guesses, answers, source } = await loadWords(apiUrl);
const { solve, hasStart } = createSolver({ guesses, answers, startWord });
if (!hasStart) console.warn(`Warning: start word "${startWord}" isn't in the guess list.`);

// The strategy is deterministic, so the next guess depends only on the
// candidate set. Cache it by the history of patterns seen so far.
const cache = new Map();

console.log(`Word lists: ${source} — ${guesses.length} guesses, ${answers.length} answers`);
console.log(`Opening guess: ${startWord}\n`);

const started = Date.now();
const dist = new Map();
const failures = [];
let total = 0;

answers.forEach((answer, i) => {
  const { count, path, error } = solve(answer, { cache });
  if (verbose) console.log(`${answer}: ${count} (${path.join(" → ")})${error ? ` [${error}]` : ""}`);
  if (!Number.isFinite(count)) {
    failures.push({ answer, path, error });
    return;
  }
  total += count;
  dist.set(count, (dist.get(count) ?? 0) + 1);
  if (count > MAX_GUESSES) failures.push({ answer, path });
  if (!verbose && (i + 1) % 250 === 0) process.stdout.write(`  ${i + 1}/${answers.length}\r`);
});

const solvedCount = [...dist.values()].reduce((a, b) => a + b, 0);
console.log(`\nAverage guesses: ${(total / solvedCount).toFixed(4)}  (over ${solvedCount} answers)`);
console.log("\nDistribution:");
for (const n of [...dist.keys()].sort((a, b) => a - b)) {
  const c = dist.get(n);
  console.log(`  ${n}: ${String(c).padStart(5)}  ${((100 * c) / solvedCount).toFixed(1).padStart(5)}%`);
}
console.log(`\nWin rate (≤ ${MAX_GUESSES}): ${((100 * (answers.length - failures.length)) / answers.length).toFixed(2)}%`);
if (failures.length) {
  console.log(`Failures (${failures.length}):`);
  for (const f of failures) console.log(`  ${f.answer}: ${f.path.join(" → ")}${f.error ? ` [${f.error}]` : ""}`);
}
console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
