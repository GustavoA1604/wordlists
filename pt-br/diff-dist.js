// Plain-text report of what a rebuild changed in dist/.
//
// dist/ is committed, so the previous state is always one `git show` away. This
// diffs the two lexicon.jsonl snapshots and prints what actually changed about
// the words — added, removed, retiered, retagged, redefined — instead of the
// 300k-line file diff git shows.
//
// Usage:
//   npm run diff-dist                     # committed dist/ (HEAD) vs working tree
//   npm run diff-dist -- --base=HEAD~3    # any git revision as the baseline
//   npm run diff-dist -- --base=old.jsonl # or a lexicon.jsonl saved elsewhere
//   npm run diff-dist -- --full           # print every section in full
//   npm run diff-dist -- --limit=50       # rows per section on screen (default 25)
//
// The full report always goes to pt-br/review/dist-diff.txt regardless of what
// is printed; only the on-screen copy is truncated.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { ptbr } from "../lib/sources.js";

const flags = Object.fromEntries(
  argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v = true] = a.replace(/^--/, "").split("=");
      return [k, v];
    }),
);
const base = typeof flags.base === "string" ? flags.base : "HEAD";
const limit = flags.full ? Infinity : Number(flags.limit ?? 25);

const LEXICON = "pt-br/dist/lexicon.jsonl";

/** Read a lexicon snapshot: a file path if it exists, else a git revision. */
function readSnapshot(ref) {
  if (existsSync(ref)) return { text: readFileSync(ref, "utf8"), label: ref };
  try {
    const text = execFileSync("git", ["show", `${ref}:${LEXICON}`], {
      cwd: join(ptbr, ".."),
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 512,
    });
    let label = ref;
    try {
      label = `${ref} (${execFileSync(
        "git",
        ["log", "-1", "--format=%h %s", ref],
        {
          cwd: join(ptbr, ".."),
          encoding: "utf8",
        },
      ).trim()})`;
    } catch {}
    return { text, label };
  } catch {
    console.error(
      `cannot read a baseline from "${ref}": not a file, and \`git show ${ref}:${LEXICON}\` failed.`,
    );
    exit(1);
  }
}

function parse(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const e = JSON.parse(line);
    map.set(e.w, e);
  }
  return map;
}

/** One-line rendering of an entry's definitions, stable enough to compare. */
function defsOf(e) {
  if (!e.d?.length) return null;
  const body = e.d.map((d) => `${d.pos}: ${d.g.join(" | ")}`).join("  //  ");
  return e.dw ? `[${e.dw}] ${body}` : body;
}
const tagsOf = (e) => (e.g?.length ? [...e.g].sort().join(",") : null);

const baseline = readSnapshot(base);
const before = parse(baseline.text);
const baseLabel = baseline.label;
const afterPath = join(ptbr, "dist", "lexicon.jsonl");
if (!existsSync(afterPath)) {
  console.error(`${afterPath} not found — run \`npm run build\` first.`);
  exit(1);
}
const after = parse(readFileSync(afterPath, "utf8"));

const added = [];
const removed = [];
const retiered = [];
const retagged = [];
const redefined = [];

for (const [w, e] of after) {
  const old = before.get(w);
  if (!old) {
    added.push({ w, tier: e.t, defs: defsOf(e), tags: tagsOf(e) });
    continue;
  }
  if (old.t !== e.t) retiered.push({ w, from: old.t, to: e.t });
  const [ot, nt] = [tagsOf(old), tagsOf(e)];
  if (ot !== nt) retagged.push({ w, tier: e.t, from: ot, to: nt });
  const [od, nd] = [defsOf(old), defsOf(e)];
  if (od !== nd) redefined.push({ w, tier: e.t, from: od, to: nd });
}
for (const [w, e] of before) {
  if (!after.has(w))
    removed.push({ w, tier: e.t, defs: defsOf(e), tags: tagsOf(e) });
}

const byWord = (a, b) => a.w.localeCompare(b.w);
const byTierThenWord = (a, b) => (a.tier ?? 0) - (b.tier ?? 0) || byWord(a, b);
added.sort(byTierThenWord);
removed.sort(byTierThenWord);
retiered.sort(byWord);
retagged.sort(byTierThenWord);
redefined.sort(byTierThenWord);

// Losing and gaining a definition read differently from having one rewritten,
// and in a typical build they differ by orders of magnitude, so they get their
// own sections instead of being buried in one list.
const defsLost = redefined.filter((r) => r.to === null);
const defsGained = redefined.filter((r) => r.from === null);
const defsChanged = redefined.filter((r) => r.from !== null && r.to !== null);

// ── rendering ────────────────────────────────────────────────────────────────

const NONE = "(sem definição)";
const pad = (w) => w.padEnd(24);
const count = (m, w) => [...m.values()].filter((e) => e.t === w).length;

// `total` is the real size of the section: the on-screen copy passes a sliced
// `rows`, and the heading must still say how many there are in full.
function section(title, rows, render, total = rows.length) {
  const lines = [
    "",
    `── ${title} (${total}) ${"─".repeat(Math.max(0, 60 - title.length - String(total).length))}`,
  ];
  if (total === 0) lines.push("  (nenhuma)");
  for (const r of rows) lines.push(...render(r));
  return lines;
}

const tierLine = (label, oldN, newN) => {
  const d = newN - oldN;
  return `  ${label.padEnd(10)} ${String(newN).padStart(7)}   ${d === 0 ? "=" : d > 0 ? `+${d}` : d}`;
};

const withDefs = (m) => [...m.values()].filter((e) => e.d).length;

const header = [
  "wordlists pt-br — dist diff",
  `base:    ${baseLabel}`,
  `current: pt-br/dist/lexicon.jsonl (working tree)`,
  "",
  tierLine("t1", count(before, 1), count(after, 1)),
  tierLine("t2", count(before, 2), count(after, 2)),
  tierLine("t3", count(before, 3), count(after, 3)),
  tierLine("total", before.size, after.size),
  tierLine("withDefs", withDefs(before), withDefs(after)),
];

const body = [
  ...section("REMOVIDAS", removed, (r) => [
    `- ${pad(r.w)} t${r.tier}${r.tags ? `  [${r.tags}]` : ""}`,
    `      ${r.defs ?? NONE}`,
  ]),
  ...section("ADICIONADAS", added, (r) => [
    `+ ${pad(r.w)} t${r.tier}${r.tags ? `  [${r.tags}]` : ""}`,
    `      ${r.defs ?? NONE}`,
  ]),
  ...section("CAMADA ALTERADA", retiered, (r) => [
    `~ ${pad(r.w)} t${r.from} -> t${r.to}`,
  ]),
  ...section("TAGS ALTERADAS", retagged, (r) => [
    `~ ${pad(r.w)} t${r.tier}  [${r.from ?? "-"}] -> [${r.to ?? "-"}]`,
  ]),
  ...section("DEFINIÇÃO PERDIDA", defsLost, (r) => [
    `~ ${pad(r.w)} t${r.tier}`,
    `    - ${r.from}`,
  ]),
  ...section("DEFINIÇÃO GANHA", defsGained, (r) => [
    `~ ${pad(r.w)} t${r.tier}`,
    `    + ${r.to}`,
  ]),
  ...section("DEFINIÇÃO ALTERADA", defsChanged, (r) => [
    `~ ${pad(r.w)} t${r.tier}`,
    `    - ${r.from}`,
    `    + ${r.to}`,
  ]),
];

const reviewDir = join(ptbr, "review");
mkdirSync(reviewDir, { recursive: true });
const outPath = join(reviewDir, "dist-diff.txt");
writeFileSync(outPath, [...header, ...body, ""].join("\n"));

// On screen: the same report, each section cut to `limit` rows.
console.log(header.join("\n"));
for (const [title, rows, render] of [
  [
    "REMOVIDAS",
    removed,
    (r) => [`- ${pad(r.w)} t${r.tier}   ${r.defs ?? NONE}`],
  ],
  [
    "ADICIONADAS",
    added,
    (r) => [`+ ${pad(r.w)} t${r.tier}   ${r.defs ?? NONE}`],
  ],
  [
    "CAMADA ALTERADA",
    retiered,
    (r) => [`~ ${pad(r.w)} t${r.from} -> t${r.to}`],
  ],
  [
    "TAGS ALTERADAS",
    retagged,
    (r) => [`~ ${pad(r.w)} [${r.from ?? "-"}] -> [${r.to ?? "-"}]`],
  ],
  [
    "DEFINIÇÃO PERDIDA",
    defsLost,
    (r) => [`~ ${pad(r.w)} t${r.tier}`, `    - ${r.from}`],
  ],
  [
    "DEFINIÇÃO GANHA",
    defsGained,
    (r) => [`~ ${pad(r.w)} t${r.tier}`, `    + ${r.to}`],
  ],
  [
    "DEFINIÇÃO ALTERADA",
    defsChanged,
    (r) => [`~ ${pad(r.w)} t${r.tier}`, `    - ${r.from}`, `    + ${r.to}`],
  ],
]) {
  console.log(
    section(title, rows.slice(0, limit), render, rows.length).join("\n"),
  );
  if (rows.length > limit)
    console.log(`  ... e mais ${rows.length - limit} (ver o arquivo)`);
}
console.log(`\nrelatório completo -> ${outPath}`);
