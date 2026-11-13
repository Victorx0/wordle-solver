// Loads data/removed-answers.txt: original answers NYT later pulled from the
// answer pool (still valid guesses). Shared by sync-words and seed-original-answers.

import { readFile } from "node:fs/promises";

const LIST_PATH = new URL("../data/removed-answers.txt", import.meta.url);
const WORD_RE = /^[a-z]{5}$/;

export async function loadRemovedAnswers() {
  const words = (await readFile(LIST_PATH, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim().toLowerCase())
    .filter(Boolean);
  const bad = words.filter((w) => !WORD_RE.test(w));
  if (bad.length) throw new Error(`Invalid entries in removed-answers list: ${bad.join(", ")}`);
  return new Set(words);
}
