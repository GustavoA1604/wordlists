// One-off migration: fold the decisions embedded in curated/t{1,2,3}.txt and
// the current dist/ into the new curated model (lemmas.tsv + forms.tsv).
//
// For every word in the current dist, resolve its tier with the new engine
// (running on empty lemmas.tsv/forms.tsv). Where the engine already reproduces
// the current tier, there is nothing to record: the tier follows from sources
// and rules. Where it differs, the decision is preserved at the highest level
// it fits:
//
//   - the word is a MorphoBr headword  -> lemmas.tsv row (paradigm follows it)
//   - the word has no analyses (residue: places, loans, abbreviations, interj)
//                                      -> lemmas.tsv stub row, auto-tagged from
//                                         the filter sources where possible
//   - the word is only an inflection   -> NOT preserved: its tier should follow
//     of some lemma                        the rules; disagreements land in the
//                                          rebuild diff for one review pass.
//     Exception: when every lemma of the inflection is out of the game, the
//     word would vanish from the pool, so it is preserved in forms.tsv and the
//     lemma is reported as a candidate promotion.
//
// Outputs: curated/lemmas.tsv, curated/forms.tsv, review/migration-report.md.
// Does NOT delete the old curated files or touch dist/.
//
// Usage: node --max-old-space-size=6000 pt-br/migrate-to-lemmas.js

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr } from "../lib/sources.js";
import { loadEngine } from "./engine.js";

function lines(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// ── current dist (the decisions to preserve) ───────────────────────────────

const distTier = new Map();
for (const [file, tier] of [["t1.txt", 1], ["t2.txt", 2], ["t3.txt", 3]]) {
  for (const w of lines(join(ptbr, "dist", file))) distTier.set(w, tier);
}

// ── auto-tag helpers (filter sources; informational tags on stub rows) ─────

function loadTaggers() {
  const src = (f) => join(ptbr, "sources", f);
  const norm = (ws) => new Set(ws.map(normalizeWord).filter(Boolean));
  const countries = norm(lines(src("places-paises.txt")));
  const municipios = norm(lines(src("places-municipios-br.txt")));
  const cities = new Set();
  for (const line of lines(src("world-cities.csv")).slice(1)) {
    const name = normalizeWord(line.split(",")[0]);
    if (name) cities.add(name);
  }
  // "english" only when the word is not also in a broad PT dictionary
  // (assimilated loans like "mouse" stay untagged), mirroring gen-candidates.
  const englishAll = norm(lines(src("english-words.txt")));
  const ptDict = norm([
    ...lines(src("ueda-palavras.txt")),
    ...lines(src("ueda-dicio.txt")),
  ]);
  const english = new Set([...englishAll].filter((w) => !ptDict.has(w)));
  const prenomes = new Set();
  for (const line of lines(src("prenomes-ibge.csv")).slice(1)) {
    const [name, , freq] = line.split(",");
    const w = normalizeWord(name);
    if (w && Number(freq) >= 1000) prenomes.add(w);
  }
  return (w) => {
    const tags = [];
    if (countries.has(w)) tags.push("country");
    else if (municipios.has(w) || cities.has(w)) tags.push("place");
    if (prenomes.has(w)) tags.push("firstname");
    if (english.has(w)) tags.push("english");
    return tags;
  };
}

// ── migrate ─────────────────────────────────────────────────────────────────

const HEADER_LEMMAS = [
  "# curated/lemmas.tsv: headword-level decisions. Columns: lemma<TAB>pos<TAB>tier<TAB>tags",
  "# tier: 1|2|3|x (x = removed). Empty tier is allowed when a tag implies one (see TAG_POLICY in engine.js).",
  "# pos: N|V|A|ADV for MorphoBr lemmas, or a stub label (PROP, ABBR, INTJ, LOAN, -).",
  "# tags: comma-separated (english, firstname, nonword, polemic, place, abbrev, interj, country, ...).",
];
const HEADER_FORMS = [
  "# curated/forms.tsv: per-form exceptions to the morphology rules. Columns: form<TAB>tier<TAB>reason",
  "# Keep this file small: prefer a lemmas.tsv decision or a rule fix when one applies.",
];

let engine = await loadEngine();
if (engine.lemmas.size > 0 || engine.forms.size > 0) {
  console.error("curated/lemmas.tsv or forms.tsv already exist and are non-empty; refusing to overwrite a started migration.");
  process.exit(1);
}
const tagOf = loadTaggers();

const lemmaRows = [];   // [lemma, pos, tier, tags]
const formRows = [];    // [form, tier, reason]
const stats = { reproduced: 0, headword: 0, stub: 0, orphanForm: 0, explicitT1: 0, ruleDiff: 0 };
const ruleDiffs = [];   // inflections whose tier will change on rebuild
const promotions = new Map(); // out-of-game lemma -> forms preserved

// Pass 1: preserve decisions that live on headwords (MorphoBr lemmas and
// residue stubs). These rows change which lemmas are in the game, so they must
// be written and reloaded before inflections can be classified.
const inflections = [];
for (const [w, tier] of [...distTier].sort()) {
  const r = engine.resolve(w);
  if (r.tier === tier) { stats.reproduced++; continue; }

  const asLemma = engine.morpho.byLemma.get(w);
  if (asLemma) {
    const posSet = [...new Set(asLemma.map((r2) => r2.pos))];
    lemmaRows.push([w, posSet.length === 1 ? posSet[0] : "-", tier, tagOf(w).join(",")]);
    stats.headword++;
    continue;
  }
  if (r.analyses.length === 0) {
    lemmaRows.push([w, "-", tier, tagOf(w).join(",")]);
    stats.stub++;
    continue;
  }
  inflections.push([w, tier]);
}

writeLemmas();
engine = await loadEngine(); // reload with the headword rows in effect

// Pass 2: classify the remaining inflections against the migrated headwords.
for (const [w, tier] of inflections) {
  const r = engine.resolve(w);
  if (r.tier === tier) { stats.reproduced++; continue; }
  if (r.tier === null) {
    // Every lemma of this form is out of the game: the word would vanish.
    formRows.push([w, tier, "migrated: lemma not in game"]);
    for (const a of r.analyses) {
      if (!promotions.has(a.lemma)) promotions.set(a.lemma, []);
      promotions.get(a.lemma).push(w);
    }
    stats.orphanForm++;
    continue;
  }
  // Moves in or out of t1 are explicit past decisions, not rule noise: t1 is
  // never produced by an inflection rule, and a dist tier of 1 for a word
  // outside the t1 base can only have come from curated/t1.txt. Preserve them.
  if (tier === 1 || r.tier === 1) {
    formRows.push([w, tier, "migrated: explicit t1-related decision"]);
    stats.explicitT1++;
    continue;
  }
  ruleDiffs.push(`${w}\t${tier} -> ${r.tier}\t${r.analyses.map((a) => `${a.lemma}/${a.pos}:${a.tier}`).join(" ")}`);
  stats.ruleDiff++;
}

// ── write ───────────────────────────────────────────────────────────────────

function writeLemmas() {
  writeFileSync(
    join(ptbr, "curated", "lemmas.tsv"),
    [...HEADER_LEMMAS, ...lemmaRows.map((r) => r.join("\t"))].join("\n") + "\n",
  );
}

writeLemmas();
writeFileSync(
  join(ptbr, "curated", "forms.tsv"),
  [...HEADER_FORMS, ...formRows.map((r) => r.join("\t"))].join("\n") + "\n",
);

mkdirSync(join(ptbr, "review"), { recursive: true });
const report = [
  "# Migration report",
  "",
  `- dist words: ${distTier.size}`,
  `- reproduced by sources+rules alone (no row needed): ${stats.reproduced}`,
  `- preserved as headword rows in lemmas.tsv: ${stats.headword}`,
  `- preserved as stub rows in lemmas.tsv (no analyses): ${stats.stub}`,
  `- preserved in forms.tsv (inflection of out-of-game lemma): ${stats.orphanForm}`,
  `- inflections whose tier will change on rebuild (rule normalization): ${stats.ruleDiff}`,
  "",
  "## Candidate lemma promotions (out-of-game lemmas whose forms were preserved)",
  "",
  ...[...promotions].sort().map(([l, ws]) => `- ${l}: ${ws.join(", ")}`),
  "",
  "## Rule-normalization diffs (word, current -> rebuilt, analyses)",
  "",
  ...ruleDiffs,
  "",
].join("\n");
writeFileSync(join(ptbr, "review", "migration-report.md"), report);

console.log(stats);
console.log("-> curated/lemmas.tsv, curated/forms.tsv, review/migration-report.md");
