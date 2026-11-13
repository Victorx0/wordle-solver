// One-time reset: makes `is_answer` match the original 2,315-word Wordle answer
// list in data/original-answers.txt. Run `sync-words.mjs` with BACKFILL=true
// afterwards to add every solution NYT has used since (some aren't in the
// original list).
//
// Order avoids a window with no answers: flag the original list first, then
// unflag everything else.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRY_RUN=true (optional)
// Run: node scripts/seed-original-answers.mjs

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const LIST_PATH = new URL("../data/original-answers.txt", import.meta.url);
const EXPECTED_COUNT = 2315;
const PAGE_SIZE = 1000;
const WRITE_BATCH = 500;
const WORD_RE = /^[a-z]{5}$/;
const DRY_RUN = process.env.DRY_RUN === "true";

async function loadList() {
  const words = (await readFile(LIST_PATH, "utf8")).split(/\s+/).filter(Boolean);
  const unique = new Set(words.map((w) => w.toLowerCase()));
  const bad = [...unique].filter((w) => !WORD_RE.test(w));
  if (bad.length) throw new Error(`Invalid entries in answer list: ${bad.slice(0, 10).join(", ")}`);
  if (unique.size !== EXPECTED_COUNT) {
    throw new Error(`Expected ${EXPECTED_COUNT} unique answers, found ${unique.size}`);
  }
  return unique;
}

async function loadAnswerFlags(supabase) {
  const flags = new Map();
  for (let from = 0; ; ) {
    const { data, error } = await supabase
      .from("words")
      .select("word, is_answer")
      .order("word", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) flags.set(row.word.trim().toLowerCase(), row.is_answer === true);
    from += data.length;
  }
  return flags;
}

async function inBatches(items, fn) {
  for (let i = 0; i < items.length; i += WRITE_BATCH) await fn(items.slice(i, i + WRITE_BATCH));
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const original = await loadList();
  const flags = await loadAnswerFlags(supabase);

  const toInsert = [...original].filter((w) => !flags.has(w));
  const toFlag = [...original].filter((w) => flags.get(w) === false);
  const toUnflag = [...flags].filter(([w, isAnswer]) => isAnswer && !original.has(w)).map(([w]) => w);
  const before = [...flags.values()].filter(Boolean).length;

  console.log(`Original list: ${original.size} words`);
  console.log(`Currently flagged as answers: ${before}`);
  console.log(`Insert (missing from table): ${toInsert.length}`);
  console.log(`Flag as answer: ${toFlag.length}`);
  console.log(`Unflag (not in original list): ${toUnflag.length}`);

  if (DRY_RUN) {
    console.log("Dry run; no changes written.");
    return;
  }

  await inBatches(toInsert, async (batch) => {
    const rows = batch.map((word) => ({ word, is_answer: true, is_guess: true }));
    const { error } = await supabase.from("words").upsert(rows, { onConflict: "word", ignoreDuplicates: true });
    if (error) throw error;
  });
  await inBatches(toFlag, async (batch) => {
    const { error } = await supabase.from("words").update({ is_answer: true }).in("word", batch);
    if (error) throw error;
  });
  await inBatches(toUnflag, async (batch) => {
    const { error } = await supabase.from("words").update({ is_answer: false }).in("word", batch);
    if (error) throw error;
  });

  const { count, error } = await supabase
    .from("words")
    .select("word", { count: "exact", head: true })
    .eq("is_answer", true);
  if (error) throw error;
  console.log(`Done. Rows with is_answer = true: ${count}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
