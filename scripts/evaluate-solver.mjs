// Plays the solver from app/page.tsx against every answer and reports the
// average number of guesses, the distribution, and any failures (> 6 guesses).
//
// The strategy is copied exactly from page.tsx:
//   - open with "tarse"
//   - filter the remaining answers by the colour pattern
//   - 1 or 2 candidates left: guess the first one
//   - otherwise: guess the word (from the full guess list, in API order) with the
//     highest entropy over the remaining candidates; ties go to the earliest word
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

import { readFile } from "node:fs/promises";
import { loadRemovedAnswers } from "./removed-answers.mjs";

const WORD_RE = /^[a-z]{5}$/;
const MAX_GUESSES = 6;
const HARD_LIMIT = 20; // safety stop so a broken strategy can't loop forever

// ---- CLI args ---------------------------------------------------------------
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const apiUrl = argValue("--url");
const startWord = (argValue("--start") ?? "tarse").toLowerCase();
const verbose = args.includes("--verbose");

// ---- Load word lists --------------------------------------------------------
const readLines = async (path) =>
  (await readFile(new URL(path, import.meta.url), "utf8"))
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((w) => WORD_RE.test(w));

async function loadWords() {
  if (apiUrl) {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`GET ${apiUrl} -> HTTP ${res.status}`);
    const data = await res.json();
    const clean = (list) => (Array.isArray(list) ? list.filter((w) => typeof w === "string" && WORD_RE.test(w)) : []);
    const guesses = clean(data.guesses);
    const answers = clean(data.answers);
    return { guesses, answers: answers.length ? answers : guesses, source: apiUrl };
  }

  const removed = await loadRemovedAnswers();
  const answers = (await readLines("../data/original-answers.txt")).filter((w) => !removed.has(w));
  // The API returns words sorted ascending and every answer is also a guess.
  const guesses = [...new Set([...(await readLines("../public/data/words.csv")), ...answers])].sort();
  return { guesses, answers, source: "local files" };
}

// ---- Solver logic (mirrors app/page.tsx) -------------------------------------
const POW3 = [1, 3, 9, 27, 81];
const letterCounts = new Uint8Array(26);
const isGreen = new Uint8Array(5);
const patternBuckets = new Int32Array(243);
const SOLVED = 242; // all greens

const encodeWord = (word) => Uint8Array.from(word, (c) => c.charCodeAt(0) - 97);

const patternCode = (guess, target) => {
  letterCounts.fill(0);
  let code = 0;
  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) {
      isGreen[i] = 1;
      code += 2 * POW3[i];
    } else {
      isGreen[i] = 0;
      letterCounts[target[i]]++;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (!isGreen[i] && letterCounts[guess[i]] > 0) {
      code += POW3[i];
      letterCounts[guess[i]]--;
    }
  }
  return code;
};

const calculateEntropy = (guess, possible) => {
  patternBuckets.fill(0);
  for (const w of possible) patternBuckets[patternCode(guess, w)]++;
  const total = possible.length;
  let entropy = 0;
  for (let i = 0; i < 243; i++) {
    const count = patternBuckets[i];
    if (count) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
};

// ---- Simulation -------------------------------------------------------------
const { guesses, answers, source } = await loadWords();
const encodedGuesses = guesses.map(encodeWord);
const encodedOf = new Map(guesses.map((w, i) => [w, encodedGuesses[i]]));
for (const a of answers) if (!encodedOf.has(a)) encodedOf.set(a, encodeWord(a));

if (!encodedOf.has(startWord)) console.warn(`Warning: start word "${startWord}" isn't in the guess list.`);
const encodedStart = encodeWord(startWord);

// The strategy is deterministic, so the next guess depends only on the
// candidate set. Cache it by the history of patterns seen so far.
const nextGuessCache = new Map();

const pickGuess = (candidates) => {
  if (candidates.length <= 2) return candidates[0];
  const encodedCandidates = candidates.map((w) => encodedOf.get(w));
  let best = "";
  let maxEntropy = -1;
  for (let i = 0; i < encodedGuesses.length; i++) {
    const score = calculateEntropy(encodedGuesses[i], encodedCandidates);
    if (score > maxEntropy) {
      maxEntropy = score;
      best = guesses[i];
    }
  }
  return best;
};

const solve = (answer) => {
  const target = encodedOf.get(answer);
  let candidates = answers;
  let guess = startWord;
  let encodedGuess = encodedStart;
  let key = "";
  const path = [];

  for (let n = 1; n <= HARD_LIMIT; n++) {
    path.push(guess);
    const pattern = patternCode(encodedGuess, target);
    if (pattern === SOLVED) return { count: n, path };

    candidates = candidates.filter((w) => patternCode(encodedGuess, encodedOf.get(w)) === pattern);
    if (candidates.length === 0) return { count: Infinity, path, error: "no candidates left" };

    key += `${guess}:${pattern}|`;
    let next = nextGuessCache.get(key);
    if (next === undefined) {
      next = pickGuess(candidates);
      nextGuessCache.set(key, next);
    }
    guess = next;
    encodedGuess = encodedOf.get(guess) ?? encodeWord(guess);
  }
  return { count: Infinity, path, error: `not solved in ${HARD_LIMIT}` };
};

console.log(`Word lists: ${source} — ${guesses.length} guesses, ${answers.length} answers`);
console.log(`Opening guess: ${startWord}\n`);

const started = Date.now();
const dist = new Map();
const failures = [];
let total = 0;

answers.forEach((answer, i) => {
  const { count, path, error } = solve(answer);
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
