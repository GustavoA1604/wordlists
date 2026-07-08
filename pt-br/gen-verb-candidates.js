// Close the verb-conjugation gap for the (5-letter) export, using ueda-dicio as
// ground truth. The export is single-length and already near-complete for regular
// 5-letter forms; the real gaps are stem-changing IRREGULAR forms a rule-based
// conjugator never produces (fazer->faco, ouvir->ouco, pedir->peco), which the
// pre-inflected ueda-dicio nonetheless spells out.
//
// So instead of generating conjugations, this diffs ueda-dicio against the export:
// every word of the target length that ueda-dicio has and the export lacks, annotated
// so the verb forms are easy to pick out and proper nouns easy to skip.
//
//   - name  : IBGE first name above --name-min (likely a person, not a word)
//   - place : world gazetteer / PT country / BR municipality (rescues real places)
//   - verbish: ends in a Portuguese verbal inflection (weak signal, for scanning)
//   - score : fserb-icf frequency (lower = more frequent), if known
//
// Forms that ueda-dicio ALSO lacks (truly missing irregulars) are the step-2 network
// case; this script cannot see those.
//
// Usage: node pt-br/gen-verb-candidates.js [--len=5] [--name-min=1000]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr, readCurated } from "../lib/sources.js";
import { readLemmas, readForms } from "./engine.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const LEN = args.len ? Number(args.len) : 5;
const NAME_MIN = args["name-min"] ? Number(args["name-min"]) : 1000;
const isLen = (w) => w.length === LEN;
const src = (f) => join(ptbr, "sources", f);

function lines(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
function normSet(path, filter = isLen) {
  return new Set(
    lines(path)
      .map(normalizeWord)
      .filter((w) => w && filter(w)),
  );
}
function curatedSet(name) {
  return new Set(readCurated(name).map(normalizeWord).filter(Boolean));
}

// Already-decided words: never propose these.
const valid = new Set(lines(join(ptbr, "dist", "words.txt")));
const decided = new Set([
  ...valid,
  ...curatedSet("removals.txt"),
  ...readLemmas().keys(),
  ...readForms().keys(),
]);

// Ground truth: the pre-inflected dictionary, target length only.
const dicio = normSet(src("ueda-dicio.txt"));

// Frequency scores (lower = more frequent). Best score per word.
const score = new Map();
for (const line of lines(src("fserb-icf.txt"))) {
  const [raw, s] = line.split(",");
  const w = normalizeWord(raw);
  if (w && isLen(w) && !score.has(w)) score.set(w, parseFloat(s));
}

// First names (IBGE prenomes above the threshold).
const names = new Set();
if (existsSync(src("prenomes-ibge.csv"))) {
  for (const line of lines(src("prenomes-ibge.csv")).slice(1)) {
    const cols = line.split(",");
    const w = normalizeWord(cols[0]);
    if (!w || !isLen(w)) continue;
    const total = cols.slice(1).reduce((a, x) => a + (parseInt(x, 10) || 0), 0);
    if (total >= NAME_MIN) names.add(w);
  }
}

// Place names (rescue real places that are also words).
const places = new Set();
const addPlace = (field) => {
  const n = normalizeWord(field);
  if (n && isLen(n)) places.add(n);
};
if (existsSync(src("world-cities.csv"))) {
  for (const line of lines(src("world-cities.csv")).slice(1)) {
    const c = line.split(",");
    addPlace(c[0]);
    addPlace(c[1]);
    addPlace(c[2]);
  }
}
for (const f of ["places-paises.txt", "places-municipios-br.txt"]) {
  if (existsSync(src(f))) for (const line of lines(src(f))) addPlace(line);
}

// Verbal-ending heuristic (weak; just to help scanning). Covers the inflections that
// distinguish conjugated forms from typical nouns/adjectives at 5 letters.
const VERB_ENDINGS = [
  "ou",
  "ei",
  "eu",
  "iu",
  " am",
  "em",
  "ia",
  "es",
  "as",
  "ado",
  "ido",
  "ava",
  "era",
  "ira",
  "amos",
  "emos",
  "imos",
  "asse",
  "esse",
  "isse",
  "ara",
  "aram",
  "eram",
  "iram",
];
const verbish = (w) => VERB_ENDINGS.some((e) => w.endsWith(e));

// The diff: target-length words ueda-dicio has but the export lacks.
const gap = [...dicio]
  .filter((w) => !decided.has(w))
  .map((w) => ({
    w,
    score: score.has(w) ? score.get(w) : Infinity,
    name: names.has(w),
    place: places.has(w),
    verbish: verbish(w),
  }))
  .sort((a, b) => a.score - b.score || a.w.localeCompare(b.w));

// "clean" = not a first name (places stay; a place that is also a name is set aside).
const clean = gap.filter((c) => !c.name);
const verbCandidates = clean.filter((c) => c.verbish || !c.place);

const reviewDir = join(ptbr, "review");
mkdirSync(reviewDir, { recursive: true });

writeFileSync(
  join(reviewDir, `verb-conjugations-${LEN}.txt`),
  verbCandidates.map((c) => c.w).join("\n") + "\n",
);
writeFileSync(
  join(reviewDir, `verb-conjugations-${LEN}.annotated.tsv`),
  "word\tscore\tverbish\tname\tplace\n" +
    gap
      .map((c) =>
        [
          c.w,
          c.score === Infinity ? "" : c.score.toFixed(4),
          c.verbish ? "y" : "",
          c.name ? "y" : "",
          c.place ? "y" : "",
        ].join("\t"),
      )
      .join("\n") +
    "\n",
);

console.log(
  `Target length: ${LEN}. Already-decided excluded: ${valid.size} valid.`,
);
console.log(`Words ueda-dicio has but the export lacks: ${gap.length}`);
console.log(
  `  set aside as first names (>=${NAME_MIN}): ${gap.filter((c) => c.name).length}`,
);
console.log(
  `  set aside as places only:                ${clean.filter((c) => c.place && !c.verbish).length}`,
);
console.log(
  `  review queue (verb-ish / non-place):     ${verbCandidates.length}`,
);
console.log(`  -> review/verb-conjugations-${LEN}.txt`);
console.log(`  -> review/verb-conjugations-${LEN}.annotated.tsv`);
console.log(`\nReview queue:`);
console.log("  " + verbCandidates.map((c) => c.w).join(" "));
