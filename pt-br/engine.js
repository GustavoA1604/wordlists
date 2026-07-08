// Core tiering engine: sources + MorphoBr morphology + curated decisions -> tiers.
//
// Shared by build.js (dist generation), lint-curated.js, and word.js / move.js
// (curation CLIs). See README.md "How tiering works".
//
// The model separates facts from decisions:
//   facts     - morphology (lemma, POS, features) comes from sources/morphobr.tsv.gz
//               and is never hand-maintained.
//   decisions - curated/lemmas.tsv (one line per headword: tier + tags),
//               curated/forms.tsv (per-form exceptions), curated/removals.txt.
//
// Tier resolution for a word, in precedence order:
//   1. removals.txt or a tier-x row          -> excluded from the pool
//   2. curated/forms.tsv override            -> that tier
//   3. curated headword row (word == lemma)  -> that tier
//   4. word in t1 base (omret + top-5k freq) -> t1 (frequency trust; rules never
//      demote everyday words, mirroring the old sweep skipping t1)
//   5. morphological rule tier (min over analyses whose lemma is in the game)
//   6. source-membership fallback (t2 base -> t2, else t3)
//
// Rule tier per analysis (lemma tier known):
//   - the headword itself (form == lemma)         -> lemma tier
//   - "obscure" verb form: every row of the        -> t3
//     (form, lemma) pair is 2nd person or
//     imperative (rule: 2nd person + imperatives
//     land in t3)
//   - lemma in t3                                  -> t3
//   - verb form whose lemma is below t1, and       -> t3
//     subjunctive/imperative-only forms of any
//     verb, unless the form itself is
//     frequency-attested (t1/t2 base) and not an
//     English-only word: conjugations of uncommon
//     verbs and unattested exhortative forms are
//     obscure even when regular
//   - any other inflection (conjugation, plural,   -> max(lemma tier, 2)
//     feminine, participle, gerund)
//   - DIM/AUG/SUPER rows contribute nothing: MorphoBr generates -zinho/-zao/
//     -issimo forms mechanically for every noun/adjective, so they neither
//     validate a word nor move its tier; a diminutive or superlative is valid
//     only via sources/curation.
//
// A lemma is "in the game" (its paradigm expands into the pool) when its
// headword form is itself valid: curated with a tier, or present in a base
// source, and not removed.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeWord } from "../lib/normalize.js";
import {
  ptbr,
  loadMorphoBr,
  loadValidSources,
  loadUncommonSources,
  loadCommonSources,
  loadFreqSources,
  readCurated,
} from "../lib/sources.js";

// Tags that imply a tier (or exclusion) when a curated row has no explicit
// tier. Tags are otherwise informational: consumers can re-map them (a game
// may drop "polemic" words entirely, keep "place" words playable, etc.).
export const TAG_POLICY = {
  english: "x",
  firstname: "x",
  nonword: "x",
  polemic: 3,
  place: 3,
  abbrev: 3,
  interj: 3,
  country: 2,
};

const DERIVATIONAL = /(?:^|\+)(?:DIM|AUG|SUPER)(?:\+|$)/;

function parseTier(s) {
  if (s === "x") return "x";
  const n = Number(s);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

/** Parse a curated TSV (columns separated by tabs, `#` comments, blank-safe). */
function readTsv(name) {
  const path = join(ptbr, "curated", name);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t").map((c) => c.trim()));
}

/**
 * curated/lemmas.tsv: headword-level decisions.
 * Columns: lemma  pos  tier  tags
 *   pos:  N|V|A|ADV for MorphoBr lemmas (constrains which analyses the row
 *         governs), or a free label for stubs (PROP, ABBR, INTJ, LOAN, -).
 *   tier: 1|2|3|x, or empty when a tag implies it via TAG_POLICY.
 *   tags: comma-separated, optional.
 * Returns Map lemma -> [{ pos, tier, tags }].
 */
export function readLemmas() {
  const map = new Map();
  for (const [lemma, pos = "-", tierRaw = "", tagsRaw = ""] of readTsv("lemmas.tsv")) {
    const w = normalizeWord(lemma);
    if (!w) continue;
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [];
    let tier = parseTier(tierRaw);
    if (tier === null) {
      for (const t of tags) if (TAG_POLICY[t] !== undefined) { tier = TAG_POLICY[t]; break; }
    }
    if (tier === null) continue; // no decision derivable; ignore the row
    if (!map.has(w)) map.set(w, []);
    map.get(w).push({ pos, tier, tags });
  }
  return map;
}

/**
 * curated/forms.tsv: per-form exceptions where the rule tier is wrong.
 * Columns: form  tier  reason
 * Returns Map form -> { tier, reason }.
 */
export function readForms() {
  const map = new Map();
  for (const [form, tierRaw = "", reason = ""] of readTsv("forms.tsv")) {
    const w = normalizeWord(form);
    const tier = parseTier(tierRaw);
    if (!w || tier === null) continue;
    map.set(w, { tier, reason });
  }
  return map;
}

/** A verb (form, lemma) pair is obscure when every reading is 2nd person or imperative. */
function verbObscure(rows) {
  return rows.every(
    ({ feats }) => /(?:^|\+)2(?:\+|$)/.test(feats) || /^IMP(?:\+|$)/.test(feats),
  );
}

export async function loadEngine() {
  const norm = (ws) => new Set(ws.map(normalizeWord).filter(Boolean));
  const t1Base = norm([...loadCommonSources(), ...loadFreqSources(5000)]);
  const t2Base = norm([...loadUncommonSources(), ...loadFreqSources(15000)]);
  const t3Base = norm([...(await loadValidSources()), ...loadFreqSources(20000)]);

  const morpho = loadMorphoBr();
  const lemmas = readLemmas();
  const forms = readForms();
  const removals = new Set(readCurated("removals.txt").map(normalizeWord).filter(Boolean));

  // English words that are NOT also in a broad PT dictionary: their presence in
  // the frequency corpus attests English usage, not Portuguese (same test as
  // gen-candidates.js). Used to deny frequency rescue to verb-form homographs.
  const englishNoise = (() => {
    const read = (f) =>
      readFileSync(join(ptbr, "sources", f), "utf8")
        .split(/\r?\n/)
        .map(normalizeWord)
        .filter(Boolean);
    const pt = new Set([...read("ueda-palavras.txt"), ...read("ueda-dicio.txt")]);
    return new Set(read("english-words.txt").filter((w) => !pt.has(w)));
  })();

  const baseTier = (w) =>
    t1Base.has(w) ? 1 : t2Base.has(w) ? 2 : t3Base.has(w) ? 3 : null;

  /**
   * Tier of a headword (lemma), or "x"/null when it is out of the game.
   * `pos` narrows to a POS-specific curated row when present.
   */
  function lemmaTier(lemma, pos = null) {
    const rows = lemmas.get(lemma);
    if (rows) {
      const row =
        (pos && rows.find((r) => r.pos === pos)) ??
        rows.find((r) => r.pos === "-") ??
        rows[0];
      if (row) return row.tier;
    }
    if (removals.has(lemma)) return "x";
    if (forms.has(lemma)) return forms.get(lemma).tier;
    return baseTier(lemma);
  }

  /**
   * Rule tier contributed by one (form, lemma, pos) analysis group, or null
   * when the group contributes nothing (derivational rows, out-of-game lemma).
   */
  function analysisTier(form, lemma, pos, rows) {
    const lt = lemmaTier(lemma, pos);
    if (lt === null || lt === "x") return null;
    const real = rows.filter((r) => !DERIVATIONAL.test(r.feats));
    if (real.length === 0) return null;
    if (form === lemma) return lt;
    if (lt === 3) return 3;
    if (pos === "V" && verbObscure(real)) return 3;
    if (pos === "V") {
      // Two classes of conjugation are obscure unless the form itself is
      // frequency-attested: any form of a less frequent verb (lemma below t1,
      // "azei"/"tombavam"), and subjunctive/imperative-only forms even of t1
      // verbs ("vare": nobody meets it outside "que ele vare"; "fale"/"coma"
      // are attested and stay). Attestation is denied when the form is an
      // English word absent from the PT dictionaries: corpus frequency for
      // "ale" or "spot" attests English, not Portuguese.
      const subjOnly = real.every((r) => /^(IMP|SBJR|SBJP|SBJF)(\+|$)/.test(r.feats));
      const attested =
        (t1Base.has(form) || t2Base.has(form)) && !englishNoise.has(form);
      if ((lt >= 2 || subjOnly) && !attested) return 3;
    }
    return Math.max(lt, 2);
  }

  /** All analyses of a form, grouped by (lemma, pos): [{ lemma, pos, rows }]. */
  function analysesOf(form) {
    const rows = morpho.byForm.get(form);
    if (!rows) return [];
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.lemma}\t${r.pos}`;
      if (!groups.has(key)) groups.set(key, { lemma: r.lemma, pos: r.pos, rows: [] });
      groups.get(key).rows.push(r);
    }
    return [...groups.values()];
  }

  /**
   * Resolve a word's tier with full reasoning. Returns
   *   { tier: 1|2|3|"x"|null, why: string, analyses: [{lemma,pos,rows,tier}] }
   * tier null means the word is not in the pool at all.
   */
  function resolve(word) {
    const analyses = analysesOf(word).map((g) => ({
      ...g,
      tier: analysisTier(word, g.lemma, g.pos, g.rows),
    }));
    if (removals.has(word)) return { tier: "x", why: "removals.txt", analyses };

    // An explicit curated headword row decides the word itself outright.
    if (lemmas.has(word)) {
      return { tier: lemmaTier(word), why: "curated/lemmas.tsv (headword)", analyses };
    }

    if (forms.has(word)) {
      const { tier, reason } = forms.get(word);
      return { tier, why: `curated/forms.tsv${reason ? ` (${reason})` : ""}`, analyses };
    }
    if (t1Base.has(word)) return { tier: 1, why: "t1 base (omret/top-5k frequency)", analyses };

    const ruleTiers = analyses.map((a) => a.tier).filter((t) => t !== null);
    if (ruleTiers.length > 0) {
      const t = Math.min(...ruleTiers);
      return { tier: t, why: "morphology rules", analyses };
    }
    const bt = baseTier(word);
    if (bt !== null) return { tier: bt, why: `t${bt} base (source membership)`, analyses };
    return { tier: null, why: "not in any source, curation, or expansion", analyses };
  }

  /** In-game MorphoBr lemmas: headword valid and not removed. Map lemma -> Set<pos>. */
  function inGameLemmas() {
    const result = new Map();
    for (const lemma of morpho.byLemma.keys()) {
      const lt = lemmaTier(lemma);
      if (lt === null || lt === "x") continue;
      result.set(lemma, lt);
    }
    return result;
  }

  /**
   * The full valid pool: base sources + curated headwords/forms + the expanded
   * paradigms of in-game lemmas (minus derivational rows), minus removals and
   * tier-x decisions.
   */
  function pool() {
    const words = new Set([...t1Base, ...t2Base, ...t3Base]);
    for (const [lemma, rows] of lemmas) {
      const tier = lemmaTier(lemma);
      if (tier !== null && tier !== "x") words.add(lemma);
    }
    for (const w of forms.keys()) if (forms.get(w).tier !== "x") words.add(w);
    for (const lemma of inGameLemmas().keys()) {
      for (const { form, feats } of morpho.byLemma.get(lemma)) {
        if (DERIVATIONAL.test(feats)) continue;
        words.add(form);
      }
    }
    for (const w of removals) words.delete(w);
    for (const [w, { tier }] of forms) if (tier === "x") words.delete(w);
    for (const [lemma, rows] of lemmas) {
      if (rows.every((r) => r.tier === "x")) words.delete(lemma);
    }
    return words;
  }

  return {
    t1Base, t2Base, t3Base, morpho, lemmas, forms, removals,
    baseTier, lemmaTier, analysisTier, analysesOf, resolve, inGameLemmas, pool,
  };
}
