# Wordle Solver

A web app that suggests the best next guess for a Wordle puzzle. Type in the
word you guessed, tap each tile to match the colours your game showed, and the
solver narrows down the possible answers and picks the next guess.

## How it works

- **Opening guess:** a fixed word (`tarse`).
- **Filtering:** each guess and its colour pattern rules out every answer that
  would have produced a different pattern.
- **Next guess:** with one or two candidates left, it guesses one of them.
  Otherwise it picks the word from the full guess list with the highest
  information entropy over the remaining candidates, i.e. the guess that is
  expected to split them up the most.

The page also shows how many guesses the solver needs across every answer
(see [Solver evaluation](#solver-evaluation)).

## Tech stack

- [Next.js](https://nextjs.org) (App Router), React, TypeScript, Tailwind CSS
- [Supabase](https://supabase.com) (Postgres) for the word list
- GitHub Actions for a daily word-list sync

## Getting started

Requires Node.js 20.9 or later (CI uses 22).

```bash
npm install
```

Create `.env.local` in the project root:

```bash
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_ANON_KEY=<your anon / publishable key>
```

These are read only on the server (`lib/supabase/server.ts`), so they must
**not** have a `NEXT_PUBLIC_` prefix. Never commit `.env*` files; they are
already in `.gitignore`.

```bash
npm run dev
```

Then open <http://localhost:3000>.

## Database

The app reads from a single `words` table:

| Column       | Type          | Meaning                                         |
| ------------ | ------------- | ----------------------------------------------- |
| `word`       | `char(5)`     | The word (unique)                               |
| `is_guess`   | `boolean`     | Accepted as a guess                             |
| `is_answer`  | `boolean`     | Can be a daily answer                           |
| `removed_at` | timestamp     | Set when the word is dropped from the game      |

`GET /api/words` returns every word that hasn't been removed, split into
`guesses` and `answers`, and is cached for an hour.

Enable Row Level Security on `words` with a `SELECT`-only policy for the
`anon` role. Only the sync scripts (using the service role key) should be able
to write.

## Keeping the word list up to date

[`.github/workflows/sync-words.yml`](.github/workflows/sync-words.yml) runs
[`scripts/sync-words.mjs`](scripts/sync-words.mjs) daily. It adds new words,
marks recent daily answers, and flags words that were dropped.

It needs two repository secrets: `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. The workflow can also be run manually, with
options for a full backfill, a dry run, or a one-time reset to the original
answer list ([`scripts/seed-original-answers.mjs`](scripts/seed-original-answers.mjs)).

To run it locally:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DRY_RUN=true node scripts/sync-words.mjs
```

## Solver evaluation

```bash
# Play every answer and report the average guesses and distribution
node scripts/evaluate-solver.mjs

# Time how long the solver takes per game
node scripts/benchmark-solver.mjs
```

Both use the local word lists in `data/` and `public/data/` by default. Pass
`--url http://localhost:3000/api/words` (with `npm run dev` running) to use the
live Supabase lists instead, and `--start <word>` to try a different opening
guess. See the comments at the top of each script for more options.

## Disclaimer

This is an unofficial fan project. It is not affiliated with, endorsed by, or
sponsored by The New York Times Company. Wordle is a trademark of The New York
Times Company.
