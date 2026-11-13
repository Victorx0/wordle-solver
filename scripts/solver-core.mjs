// Shared solver logic for evaluate-solver and benchmark-solver.
// Mirrors the strategy in app/page.tsx:
//   - open with a fixed word (default "tarse")
//   - filter the remaining answers by the colour pattern
//   - 1 or 2 candidates left: guess the first one
//   - otherwise: guess the word (from the full guess list, in API order) with the
//     highest entropy over the remaining candidates; ties go to the earliest word

import { readFile } from "node:fs/promises";
import { loadRemovedAnswers } from "./removed-answers.mjs";

export const WORD_RE = /^[a-z]{5}$/;
export const MAX_GUESSES = 6;
export const HARD_LIMIT = 20; // safety stop so a broken strategy can't loop forever
export const SOLVED = 242; // all greens

// ---- Load word lists --------------------------------------------------------
const readLines = async (path) =>
  (await readFile(new URL(path, import.meta.url), "utf8"))
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((w) => WORD_RE.test(w));

// apiUrl: the app's API (e.g. http://localhost:3000/api/words) so the lists match
// Supabase exactly; otherwise local files: public/data/words.csv (guesses) and
// data/original-answers.txt minus data/removed-answers.txt (answers).
export async function loadWords(apiUrl) {
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

// ---- Pattern + entropy ------------------------------------------------------
const POW3 = [1, 3, 9, 27, 81];
const letterCounts = new Uint8Array(26);
const isGreen = new Uint8Array(5);
const patternBuckets = new Int32Array(243);

export const encodeWord = (word) => Uint8Array.from(word, (c) => c.charCodeAt(0) - 97);

export const patternCode = (guess, target) => {
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

export const calculateEntropy = (guess, possible) => {
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

// ---- Solver -----------------------------------------------------------------
// Returns { solve(answer, { cache, onDecision }) }.
//   cache       a Map shared across games to reuse next-guess decisions
//               (omit it to compute every decision from scratch, like the app)
//   onDecision  called with (ms, candidateCount) after each entropy search
export function createSolver({ guesses, answers, startWord = "tarse" }) {
  const encodedGuesses = guesses.map(encodeWord);
  const encodedOf = new Map(guesses.map((w, i) => [w, encodedGuesses[i]]));
  for (const a of answers) if (!encodedOf.has(a)) encodedOf.set(a, encodeWord(a));
  const encodedStart = encodedOf.get(startWord) ?? encodeWord(startWord);

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

  const solve = (answer, { cache, onDecision } = {}) => {
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

      let next;
      if (cache) {
        key += `${guess}:${pattern}|`;
        next = cache.get(key);
      }
      if (next === undefined) {
        const t0 = performance.now();
        next = pickGuess(candidates);
        if (onDecision && candidates.length > 2) onDecision(performance.now() - t0, candidates.length);
        if (cache) cache.set(key, next);
      }
      guess = next;
      encodedGuess = encodedOf.get(guess) ?? encodeWord(guess);
    }
    return { count: Infinity, path, error: `not solved in ${HARD_LIMIT}` };
  };

  return { solve, hasStart: encodedOf.has(startWord) };
}
