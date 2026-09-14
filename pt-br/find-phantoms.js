// Find candidate `formonly` headwords: MorphoBr nominal lemmas that look like
// generation artifacts, and the non-words their paradigms contribute.
//
// MorphoBr derives nominal lemmas mechanically, and for verb-form homographs it
// sometimes invents one that Portuguese does not have: beside the real noun
// "peneira" it carries a masculine "peneiro" -- in fact the 1sg present of
// "peneirar" -- whose paradigm then hands the pool "peneiros". Regressive
// derivation is productive, though, so plenty of the same-shaped homographs are
// real nouns ("envio", "retiro", "elenco", "arranco"): this cannot be decided
// automatically, which is why it is a report rather than an engine rule.
//
// A lemma is reported when all of the following hold:
//   - it is a MorphoBr N/A headword, and the same string is also an inflected
//     form of some *other* lemma (so the word's validity is already explained
//     without the nominal reading);
//   - Wiktionary attests no noun/adjective sense for it (only a verb sense, or
//     no entry at all);
//   - its paradigm contributes at least one form that nothing else in the
//     pipeline attests -- no source, no curation, no other in-game lemma. Those
//     forms are the actual damage, and are listed per row.
//
// The "shape" column flags the two sharpest sub-cases:
//
//   fem-split  a masculine-only -o lemma sitting beside a separate feminine-only
//              -a lemma of the same stem. Real gender pairs are ONE MorphoBr
//              lemma carrying both M and F rows ("gato" -> gato/gata/gatos/
//              gatas), so that split is the artifact's signature.
//   gerundive  an -ndo lemma that is also some verb's gerund, given a full
//              M/F x SG/PL nominal paradigm ("admirando" -> admiranda,
//              admirandas, admirandos). Portuguese does lexicalize a few of
//              these ("formando", "doutorando", "memorando", "tremendo"), but
//              MorphoBr generates them wholesale.
//
// The "dicio" column is the strongest keep signal: a hit means one of the Ueda
// dictionaries lists an *inflected* form of the nominal paradigm -- a word the
// verb cannot produce, so its presence is independent evidence that the nominal
// lemma is real. Those dictionaries are not part of tiering (loadEngine only
// mines them for englishNoise), which is exactly why they are worth consulting
// here. A miss is weak evidence: they are incomplete, and miss real words
// ("crescendos", "integrandos", "multiplicandos").
//
// Rows are ordered by the tier the orphan forms currently land in (t1 first:
// those are the ones a game actually shows) and written to
// pt-br/review/phantom-lemmas.tsv for triage. Confirmed ones get the
// `formonly` tag in curated/lemmas.tsv; the rest are left alone.
//
// Usage: node --max-old-space-size=6000 pt-br/find-phantoms.js [--max-tier=2]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr, loadWiktionary } from "../lib/sources.js";
import { loadEngine } from "./engine.js";

const args = Object.fromEntries(
  argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const maxTier = args["max-tier"] ? Number(args["max-tier"]) : 3;

const DERIVATIONAL = /(?:^|\+)(?:DIM|AUG|SUPER)(?:\+|$)/;
const NOMINAL = new Set(["N", "A"]);
const WK_NOMINAL = new Set(["noun", "adj", "adjective"]);

const engine = await loadEngine();
const wiktionary = loadWiktionary();

// The Ueda dictionaries, read straight from sources/ because the engine keeps
// them for englishNoise only. Independent of everything tiering uses, which is
// what makes them worth a column here.
const dicio = new Set(
  ["ueda-dicio.txt", "ueda-palavras.txt"].flatMap((f) =>
    readFileSync(join(ptbr, "sources", f), "utf8")
      .split(/\r?\n/)
      .map(normalizeWord)
      .filter(Boolean),
  ),
);

/** Genders a lemma's non-derivational rows of one POS carry, plus their count. */
function genders(lemma, pos) {
  const rows = (engine.morpho.byLemma.get(lemma) ?? []).filter(
    (r) => r.pos === pos && !DERIVATIONAL.test(r.feats),
  );
  const g = new Set();
  for (const { feats } of rows) {
    if (/(?:^|\+)M(?:\+|$)/.test(feats)) g.add("M");
    if (/(?:^|\+)F(?:\+|$)/.test(feats)) g.add("F");
  }
  return { g, n: rows.length };
}

/** Masculine-only -o lemma beside a separate feminine-only -a lemma. */
function splitGenderPair(lemma) {
  if (!lemma.endsWith("o")) return false;
  const masc = genders(lemma, "N");
  if (masc.n === 0 || masc.g.size !== 1 || !masc.g.has("M")) return false;
  const fem = genders(lemma.slice(0, -1) + "a", "N");
  return fem.n > 0 && fem.g.size === 1 && fem.g.has("F");
}

/** An -ndo lemma that is also some verb's gerund. */
function gerundive(lemma) {
  if (!/(?:ando|endo|indo)$/.test(lemma)) return false;
  return (engine.morpho.byForm.get(lemma) ?? []).some(
    (r) => r.pos === "V" && /(?:^|\+)GRD(?:\+|$)/.test(r.feats),
  );
}

/** Does some other in-game lemma also produce `form`? */
function sharedWithOtherLemma(form, lemma) {
  return engine.analysesOf(form).some((a) => {
    if (a.lemma === lemma) return false;
    const lt = engine.lemmaTier(a.lemma, a.pos);
    return lt !== null && lt !== "x";
  });
}

/** Nothing outside this lemma's paradigm puts `form` in the pool. */
function orphan(form, lemma) {
  if (wiktionary.has(form)) return false;
  if (
    engine.t1Base.has(form) ||
    engine.t2Base.has(form) ||
    engine.t3Base.has(form)
  )
    return false;
  if (engine.forms.has(form) || engine.lemmas.has(form)) return false;
  return !sharedWithOtherLemma(form, lemma);
}

const rows = [];
for (const [lemma, tier] of engine.inGameLemmas()) {
  const readings = engine.morpho.byForm.get(lemma) ?? [];
  if (!readings.some((r) => r.lemma === lemma && NOMINAL.has(r.pos))) continue;
  if (!readings.some((r) => r.lemma !== lemma)) continue; // not a homograph
  const wkPos = new Set((wiktionary.get(lemma) ?? []).map((e) => e.pos));
  if ([...wkPos].some((p) => WK_NOMINAL.has(p))) continue; // attested nominal

  const orphans = [
    ...new Set(
      (engine.morpho.byLemma.get(lemma) ?? [])
        .filter(
          (r) =>
            NOMINAL.has(r.pos) &&
            !DERIVATIONAL.test(r.feats) &&
            r.form !== lemma &&
            orphan(r.form, lemma),
        )
        .map((r) => r.form),
    ),
  ];
  if (orphans.length === 0) continue;

  const worst = Math.min(...orphans.map((f) => engine.resolve(f).tier ?? 3));
  if (worst > maxTier) continue;
  // Inflected forms of the nominal paradigm a dictionary lists: the verb cannot
  // produce these, so a hit argues the lemma is real. Forms another in-game
  // lemma also produces are excluded — MorphoBr's augmentative lemma "lobao"
  // carries "loba"/"lobas", which are really "lobo"'s and say nothing about
  // whether "lobão" is a noun in its own right.
  const inDicio = [
    ...new Set(
      (engine.morpho.byLemma.get(lemma) ?? [])
        .filter(
          (r) =>
            NOMINAL.has(r.pos) &&
            !DERIVATIONAL.test(r.feats) &&
            r.form !== lemma &&
            dicio.has(r.form) &&
            !sharedWithOtherLemma(r.form, lemma),
        )
        .map((r) => r.form),
    ),
  ];
  rows.push({
    lemma,
    tier,
    worst,
    shape: [
      splitGenderPair(lemma) ? "fem-split" : "",
      gerundive(lemma) ? "gerundive" : "",
    ]
      .filter(Boolean)
      .join("+"),
    wk: [...wkPos].join("/") || "-",
    dicio: inDicio.join(","),
    orphans,
  });
}

rows.sort((a, b) => a.worst - b.worst || a.lemma.localeCompare(b.lemma));

const out = [
  "# candidate `formonly` headwords -- see pt-br/find-phantoms.js",
  "# a `dicio` hit is a keep signal: an inflected nominal form a dictionary lists",
  "# lemma\tlemma tier\tworst orphan tier\tshape\twiktionary pos\tdicio\torphan forms",
  ...rows.map((r) =>
    [
      r.lemma,
      r.tier,
      r.worst,
      r.shape,
      r.wk,
      r.dicio,
      r.orphans.join(","),
    ].join("\t"),
  ),
].join("\n");
const path = join(ptbr, "review", "phantom-lemmas.tsv");
writeFileSync(path, out + "\n");

const byTier = [1, 2, 3].map((t) => rows.filter((r) => r.worst === t).length);
const noDicio = rows.filter((r) => !r.dicio).length;
console.log(
  `${rows.length} candidate lemmas (orphan forms in t1/t2/t3: ${byTier.join("/")}), ` +
    `${rows.reduce((n, r) => n + r.orphans.length, 0)} orphan forms; ` +
    `${noDicio} with no dictionary support -> review/phantom-lemmas.tsv`,
);
