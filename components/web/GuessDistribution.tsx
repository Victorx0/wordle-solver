"use client"
import { useEffect, useRef, useState } from "react";

// Results of `node scripts/evaluate-solver.mjs --url http://localhost:3000/api/words`
// (opening guess "tarse", every answer in the live Supabase answer list).
// Re-run the script and update these numbers if the solver or word lists change.
const DISTRIBUTION = [
  { guesses: 2, answers: 43 },
  { guesses: 3, answers: 1188 },
  { guesses: 4, answers: 1101 },
  { guesses: 5, answers: 61 },
  { guesses: 6, answers: 1 },
];
const TOTAL = DISTRIBUTION.reduce((sum, d) => sum + d.answers, 0);
const AVERAGE = DISTRIBUTION.reduce((sum, d) => sum + d.guesses * d.answers, 0) / TOTAL;
const MAX = Math.max(...DISTRIBUTION.map((d) => d.answers));

// Nonzero shares that would round to 0.0% read as "<0.1%".
const share = (n: number) => {
  const pct = (100 * n) / TOTAL;
  return n > 0 && pct < 0.05 ? "<0.1%" : `${pct.toFixed(1)}%`;
};

export default function GuessDistribution() {
  const figureRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState<number | null>(null);

  // Grow the bars the first time the chart scrolls into view.
  useEffect(() => {
    const el = figureRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="w-full border-t border-(--w-border)">
    <section className="mx-auto max-w-xl px-4 py-5 sm:py-6 text-sm">
      <h2 className="font-(family-name:--font-display) font-bold text-lg sm:text-xl">
        Solver Performance
      </h2>
      <p className="mt-1 text-(--w-muted) leading-relaxed">
        Guesses needed to solve each of the {TOTAL.toLocaleString()} Wordle answers, opening with{" "}
        <span className="font-semibold uppercase tracking-wide text-(--w-ink)">tarse</span>.
      </p>

      {/* Headline stats */}
      <div className="mt-4 grid grid-cols-3 border border-(--w-border) divide-x divide-(--w-border)">
        {[
          { label: "Average", value: AVERAGE.toFixed(2) },
          { label: "Win Rate", value: "100%" },
          { label: "Answers", value: TOTAL.toLocaleString() },
        ].map((stat) => (
          <div key={stat.label} className="flex flex-col items-center justify-center gap-1 py-2.5 px-2">
            <span className="text-xl sm:text-2xl font-bold tabular-nums leading-none">{stat.value}</span>
            <span className="text-[0.65rem] sm:text-xs font-semibold uppercase tracking-[0.12em] text-(--w-muted)">
              {stat.label}
            </span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div
        ref={figureRef}
        className="dist-chart mt-5"
        data-visible={visible}
        onMouseLeave={() => setActive(null)}
        aria-hidden="true"
      >
        <div className="mb-2 flex justify-between text-[0.65rem] sm:text-xs font-semibold uppercase tracking-[0.12em] text-(--w-muted)">
          <span>Guesses</span>
          <span>Answers</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {DISTRIBUTION.map((d, i) => (
            <div
              key={d.guesses}
              className="dist-row"
              data-active={active === i}
              data-dimmed={active !== null && active !== i}
              onMouseEnter={() => setActive(i)}
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="dist-label">{d.guesses}</span>
              <div className="dist-track">
                <div
                  className="dist-bar"
                  style={{ width: `max(4px, ${(100 * d.answers) / MAX}%)` }}
                />
                {active === i && (
                  <div
                    className="dist-tooltip"
                    // Anchor at the bar end, shifted left by the same fraction so it never overflows the track.
                    style={{
                      left: `${(100 * d.answers) / MAX}%`,
                      transform: `translateX(-${(100 * d.answers) / MAX}%)`,
                    }}
                  >
                    <span className="font-bold">{d.answers.toLocaleString()}</span> answers in {d.guesses} guesses
                    <span className="text-white/70"> · {share(d.answers)}</span>
                  </div>
                )}
              </div>
              <span className="dist-value">
                <span className="font-bold text-(--w-ink)">{d.answers.toLocaleString()}</span>
                <span className="text-(--w-muted)">{share(d.answers)}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Accessible table view of the same data */}
      <table className="sr-only">
        <caption>Number of guesses the solver needed, across {TOTAL} answers</caption>
        <thead>
          <tr>
            <th scope="col">Guesses</th>
            <th scope="col">Answers</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {DISTRIBUTION.map((d) => (
            <tr key={d.guesses}>
              <th scope="row">{d.guesses}</th>
              <td>{d.answers}</td>
              <td>{share(d.answers)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
    </div>
  );
}
