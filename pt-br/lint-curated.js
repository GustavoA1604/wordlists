// Lint the curated decision files (lemmas.tsv, forms.tsv, removals.txt).
//
// Hard errors (exit 1):
//   - malformed rows (bad tier and no tier-implying tag, non-word first column)
//   - the same word decided in more than one place (lemmas.tsv vs forms.tsv vs
//     removals.txt), or duplicated within a file
//
// Warnings (reported, exit 0):
//   - redundant rows: the engine would produce the same tier without the row
//   - lemmas.tsv rows whose pos claims a MorphoBr class the lemma does not have
//
// Usage: npm run lint-curated

import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr, readCurated } from "../lib/sources.js";
import { loadEngine, TAG_POLICY } from "./engine.js";

let errors = 0;
const error = (msg) => { errors++; console.error(`ERROR: ${msg}`); };
const warn = (msg) => console.warn(`warn:  ${msg}`);

function rawRows(name) {
  const path = join(ptbr, "curated", name);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t").map((c) => c.trim()));
}

const validTier = (t) => t === "x" || t === "1" || t === "2" || t === "3";

// ── structural checks ────────────────────────────────────────────────────────

const seen = new Map(); // word -> file
function claim(word, file) {
  if (seen.has(word)) error(`"${word}" decided in both ${seen.get(word)} and ${file}`);
  else seen.set(word, file);
}

for (const row of rawRows("lemmas.tsv")) {
  const [lemma, , tier = "", tagsRaw = ""] = row;
  const w = normalizeWord(lemma);
  if (!w || w !== lemma) { error(`lemmas.tsv: bad headword "${lemma}"`); continue; }
  const tags = tagsRaw.split(",").filter(Boolean);
  if (!validTier(tier) && !tags.some((t) => TAG_POLICY[t] !== undefined)) {
    error(`lemmas.tsv: "${lemma}" has no tier and no tier-implying tag`);
  }
  claim(w, "lemmas.tsv");
}
for (const row of rawRows("forms.tsv")) {
  const [form, tier = ""] = row;
  const w = normalizeWord(form);
  if (!w || w !== form) { error(`forms.tsv: bad form "${form}"`); continue; }
  if (!validTier(tier)) error(`forms.tsv: "${form}" has bad tier "${tier}"`);
  claim(w, "forms.tsv");
}
for (const raw of readCurated("removals.txt")) {
  const w = normalizeWord(raw);
  if (!w || w !== raw) { error(`removals.txt: bad word "${raw}"`); continue; }
  claim(w, "removals.txt");
}

if (errors) {
  console.error(`\n${errors} error(s).`);
  process.exit(1);
}
console.log("✓ curated files well-formed, no cross-file duplicates.");

// ── semantic checks (need the engine) ────────────────────────────────────────

const engine = await loadEngine();

/**
 * What a word would resolve to if its own curated row did not exist: t1-base
 * trust, then rules (with the word's own lemma tier falling back to source
 * membership), then source membership.
 */
const DERIV_ONLY = (rows) => rows.every((r) => /(?:^|\+)(?:DIM|AUG|SUPER)(?:\+|$)/.test(r.feats));
function tierWithoutOwnRow(word) {
  if (engine.t1Base.has(word)) return 1;
  const base = engine.baseTier(word);
  const ruleTiers = engine
    .analysesOf(word)
    .map((g) =>
      g.lemma === word
        ? (DERIV_ONLY(g.rows) ? null : base) // headword analysis: lemma tier falls back to sources
        : engine.analysisTier(word, g.lemma, g.pos, g.rows),
    )
    .filter((t) => t !== null);
  if (ruleTiers.length) return Math.min(...ruleTiers);
  return base;
}

let redundant = 0;
for (const [lemma, rows] of engine.lemmas) {
  const posClasses = new Set((engine.morpho.byLemma.get(lemma) ?? []).map((r) => r.pos));
  for (const { pos, tier, tags } of rows) {
    if (["N", "V", "A", "ADV"].includes(pos) && !posClasses.has(pos)) {
      warn(`lemmas.tsv: "${lemma}" claims pos ${pos} but MorphoBr has [${[...posClasses].join(",") || "nothing"}]`);
    }
    // Redundant when the engine would already give this tier without the row
    // (tags still carry information, so tagged rows are never flagged).
    if (tier !== "x" && rows.length === 1 && tags.length === 0 && tierWithoutOwnRow(lemma) === tier) {
      redundant++;
      if (redundant <= 20) warn(`lemmas.tsv: "${lemma}" row is redundant (engine already says t${tier})`);
    }
  }
}
if (redundant > 20) warn(`...and ${redundant - 20} more redundant lemma rows`);

let formRedundant = 0;
for (const [form, { tier }] of engine.forms) {
  if (tierWithoutOwnRow(form) === tier) {
    formRedundant++;
    if (formRedundant <= 20) warn(`forms.tsv: "${form}" override is redundant (engine already says t${tier})`);
  }
}
if (formRedundant > 20) warn(`...and ${formRedundant - 20} more redundant form rows`);

console.log(`✓ lint done: ${engine.lemmas.size} lemma rows, ${engine.forms.size} form rows, ${engine.removals.size} removals (${redundant + formRedundant} redundant).`);
