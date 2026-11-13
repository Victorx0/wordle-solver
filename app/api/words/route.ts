import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase/server";

// Always run on request (never prerendered at build time); caching is handled
// by the Cache-Control header below.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;
const WORD_RE = /^[a-z]{5}$/;

type WordRow = { word: string; is_answer: boolean | null; is_guess: boolean | null };

export async function GET() {
  try {
    const supabase = getSupabase();
    const rows: WordRow[] = [];

    // PostgREST caps rows per request (1000 by default, configurable), so page
    // through the table. Advance by the number of rows actually returned and stop
    // on an empty page, so this stays correct whatever the project's cap is.
    for (let from = 0; ; ) {
      const { data, error } = await supabase
        .from("words")
        .select("word, is_answer, is_guess")
        .is("removed_at", null)
        .or("is_guess.eq.true,is_answer.eq.true")
        .order("word", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      rows.push(...(data as WordRow[]));
      from += data.length;
    }

    const guesses = new Set<string>();
    const answers = new Set<string>();
    for (const row of rows) {
      // CHAR(5) is blank-padded, so trim and normalise before validating.
      const word = row.word?.trim().toLowerCase();
      if (!word || !WORD_RE.test(word)) continue;
      // Every answer is also a valid guess.
      guesses.add(word);
      if (row.is_answer) answers.add(word);
    }

    if (guesses.size === 0) {
      // Usually means RLS is on without a SELECT policy for the anon role.
      console.error("[api/words] Supabase returned no words (check RLS policy on `words`)");
      return NextResponse.json({ error: "Word list unavailable" }, { status: 503 });
    }

    return NextResponse.json(
      { guesses: [...guesses], answers: [...answers] },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (err) {
    // Log details server-side only; never leak DB errors to the client.
    console.error("[api/words] Failed to load words:", err);
    return NextResponse.json({ error: "Word list unavailable" }, { status: 500 });
  }
}
