// Syncs the `words` table with the live NYT Wordle data.
//
//   1. Guess list: scraped from the Wordle JS bundles (the largest array of
//      5-letter strings in any bundle). New words are inserted, dropped words get
//      `removed_at` set, and words that come back are restored.
//   2. Answers: read from NYT's daily puzzle endpoint
//      (https://www.nytimes.com/svc/wordle/v2/YYYY-MM-DD.json). Every solution
//      seen is marked `is_answer = true` (inserted if missing).
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (required; writes need the service role)
//   ANSWER_LOOKBACK_DAYS  days of answers to fetch, ending today (default 7)
//   BACKFILL=true         fetch every answer since launch (2021-06-19) instead
//   DRY_RUN=true          report changes without writing
//
// Run: node scripts/sync-words.mjs

import { createClient } from "@supabase/supabase-js";

const WORDLE_URL = "https://www.nytimes.com/games/wordle/index.html";
const ANSWER_URL = (date) => `https://www.nytimes.com/svc/wordle/v2/${date}.json`;
const LAUNCH_DATE = "2021-06-19";
// Refuse to touch the DB if the scrape looks broken (the real list is ~14,855).
const MIN_GUESS_WORDS = 10_000;
// Refuse to mark more than this many words as removed in a single run.
const MAX_REMOVALS = 500;
const PAGE_SIZE = 1000;
const WRITE_BATCH = 500;
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; wordle-word-sync)" };

const WORD_RE = /^[a-z]{5}$/;
const ARRAY_RE = /\[(?:\s*["'][a-z]{5}["']\s*,){999,}\s*["'][a-z]{5}["']\s*\]/g;

const DRY_RUN = process.env.DRY_RUN === "true";
const BACKFILL = process.env.BACKFILL === "true";
const LOOKBACK = Number.parseInt(process.env.ANSWER_LOOKBACK_DAYS ?? "7", 10);

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------- guess list

async function scrapeGuessList() {
  const html = await fetchText(WORDLE_URL);
  const scriptUrls = [
    ...new Set(
      [...html.matchAll(/src="([^"]+\.js)"/g)]
        .map((m) => new URL(m[1], WORDLE_URL).href)
        .filter((u) => u.includes("/games-assets/")),
    ),
  ];
  if (scriptUrls.length === 0) throw new Error("No game script tags found on the Wordle page");

  let best = [];
  let bestUrl = null;
  for (const url of scriptUrls) {
    let js;
    try {
      js = await fetchText(url);
    } catch (err) {
      console.warn(`  skip ${url}: ${err.message}`);
      continue;
    }
    for (const match of js.matchAll(ARRAY_RE)) {
      const words = match[0].match(/[a-z]{5}/g);
      if (words.length > best.length) {
        best = words;
        bestUrl = url;
      }
    }
  }

  const unique = new Set(best.filter((w) => WORD_RE.test(w)));
  if (unique.size < MIN_GUESS_WORDS) {
    throw new Error(
      `Guess list scrape looks wrong: found ${unique.size} words (need >= ${MIN_GUESS_WORDS}). ` +
        "NYT may have changed the bundle layout.",
    );
  }
  console.log(`Guess list: ${unique.size} words from ${bestUrl}`);
  return unique;
}

// ------------------------------------------------------------------- answers

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function answerDates() {
  // Puzzles roll over at local midnight; by the time the cron runs (UTC) the
  // UTC date's puzzle is live everywhere in the Americas and beyond.
  const end = new Date(`${isoDate(new Date())}T00:00:00Z`);
  const start = BACKFILL
    ? new Date(`${LAUNCH_DATE}T00:00:00Z`)
    : new Date(end.getTime() - (Math.max(LOOKBACK, 1) - 1) * 86_400_000);
  const dates = [];
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) dates.push(isoDate(d));
  return dates;
}

async function fetchAnswers() {
  const dates = answerDates();
  const answers = new Set();
  let failures = 0;
  const CONCURRENCY = 8;

  for (let i = 0; i < dates.length; i += CONCURRENCY) {
    const chunk = dates.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (date) => JSON.parse(await fetchText(ANSWER_URL(date)))),
    );
    results.forEach((r, j) => {
      const word = r.status === "fulfilled" ? r.value?.solution?.trim().toLowerCase() : null;
      if (word && WORD_RE.test(word)) answers.add(word);
      else {
        failures++;
        console.warn(`  no answer for ${chunk[j]}: ${r.reason?.message ?? "bad payload"}`);
      }
    });
  }

  if (answers.size === 0) throw new Error("Could not fetch any daily answers");
  console.log(
    `Answers: ${answers.size} solutions from ${dates[0]}..${dates.at(-1)} (${failures} failed)`,
  );
  return answers;
}

// ------------------------------------------------------------------ database

async function loadWords(supabase) {
  const rows = new Map();
  for (let from = 0; ; ) {
    const { data, error } = await supabase
      .from("words")
      .select("word, is_answer, is_guess, removed_at")
      .order("word", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) rows.set(row.word.trim().toLowerCase(), row);
    from += data.length;
  }
  return rows;
}

async function inBatches(items, fn) {
  for (let i = 0; i < items.length; i += WRITE_BATCH) await fn(items.slice(i, i + WRITE_BATCH));
}

async function updateWords(supabase, words, patch, label) {
  console.log(`${label}: ${words.length}${words.length ? ` (e.g. ${words.slice(0, 5).join(", ")})` : ""}`);
  if (DRY_RUN || words.length === 0) return;
  await inBatches(words, async (batch) => {
    const { error } = await supabase.from("words").update(patch).in("word", batch);
    if (error) throw error;
  });
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [guesses, answers] = await Promise.all([scrapeGuessList(), fetchAnswers()]);
  const existing = await loadWords(supabase);
  console.log(`Database: ${existing.size} words`);

  const now = new Date().toISOString();
  const toInsert = [];
  const toRestore = []; // back in the guess list (or previously flagged as not guessable)
  const toRemove = []; // dropped from the guess list
  const toMarkAnswer = [];

  for (const word of new Set([...guesses, ...answers])) {
    const row = existing.get(word);
    if (!row) {
      toInsert.push({ word, is_guess: true, is_answer: answers.has(word) });
      continue;
    }
    if (row.removed_at !== null || row.is_guess !== true) toRestore.push(word);
    if (answers.has(word) && row.is_answer !== true) toMarkAnswer.push(word);
  }

  for (const [word, row] of existing) {
    // Past answers stay valid even if NYT trims them from the bundle.
    if (!guesses.has(word) && row.removed_at === null && row.is_answer !== true) toRemove.push(word);
  }

  if (toRemove.length > MAX_REMOVALS) {
    throw new Error(
      `Refusing to remove ${toRemove.length} words (limit ${MAX_REMOVALS}); check the scrape.`,
    );
  }

  console.log(`New words: ${toInsert.length}${toInsert.length ? ` (e.g. ${toInsert.slice(0, 5).map((r) => r.word).join(", ")})` : ""}`);
  if (!DRY_RUN && toInsert.length) {
    await inBatches(toInsert, async (batch) => {
      const { error } = await supabase
        .from("words")
        .upsert(batch, { onConflict: "word", ignoreDuplicates: true });
      if (error) throw error;
    });
  }
  await updateWords(supabase, toRestore, { is_guess: true, removed_at: null }, "Restored");
  await updateWords(supabase, toMarkAnswer, { is_answer: true }, "Marked as answer");
  await updateWords(supabase, toRemove, { is_guess: false, removed_at: now }, "Removed");

  console.log(DRY_RUN ? "Dry run complete; no changes written." : "Sync complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
