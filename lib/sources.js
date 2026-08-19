// Loaders for the raw PT-BR sources and the curated override files.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const ptbr = join(here, "..", "pt-br");

function readLines(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** A curated override file: one word per line, `#` comments and blanks ignored. */
export function readCurated(name) {
  const lines = readLines(join(ptbr, "curated", name));
  return lines.filter((l) => !l.startsWith("#"));
}

/** Raw words from the broad "valid"-class source (wordle-finder, all lengths). */
export async function loadValidSources() {
  const finderUrl = pathToFileURL(join(ptbr, "sources", "finder.js")).href;
  return (await import(finderUrl)).words;
}

/** Raw words from the "uncommon"-class source (broader everyday vocabulary). */
export function loadUncommonSources() {
  return readLines(join(ptbr, "sources", "silviotamaso.txt"));
}

/**
 * Top-N words from the fserb frequency-ranked corpus (lower rank = more frequent).
 * Used to fill gaps in curated sources, mainly common short words and conjugations
 * that Wordle-oriented lists miss. Returns words in rank order (deduped).
 *
 * `filter`, when given, is an extra predicate a candidate word must pass to be
 * accepted (e.g. "is this recognized by an independent dictionary source?").
 * Since a rejection makes the scan keep reading to still fill `cutoff` slots,
 * a filtered call reaches deeper into the corpus than an unfiltered one for
 * the same cutoff \u2014 by design, so a caller can ask for "N cross-validated
 * words" and get them regardless of how deep the corpus's noise floor is.
 */
export function loadFreqSources(cutoff = 1000, filter = null) {
  const COMBINING = /[\u0300-\u036f]/g;
  const AZ = /^[a-z]+$/;
  const result = [];
  const seen = new Set();
  for (const line of readLines(join(ptbr, "sources", "fserb-icf.txt"))) {
    if (result.length >= cutoff) break;
    const comma = line.lastIndexOf(",");
    if (comma < 0) continue;
    const w = line
      .slice(0, comma)
      .normalize("NFD")
      .replace(COMBINING, "")
      .toLowerCase()
      .trim();
    if (AZ.test(w) && !seen.has(w) && (!filter || filter(w))) {
      seen.add(w);
      result.push(w);
    }
  }
  return result;
}

const PL_FEAT = /(?:^|\+)PL(?:\+|$)/;
const DERIV_FEAT = /(?:^|\+)(?:DIM|AUG|SUPER)(?:\+|$)/;

/**
 * Is this MorphoBr plural row a generation artifact?
 *
 * MorphoBr builds paradigms mechanically, and for a few nominal endings its
 * plural rule misfires and emits a string Portuguese orthography cannot
 * produce. Those forms then look like ordinary attested plurals to the engine
 * ("invess" as the plural of "inves", "aniis" as the plural of "anil") and end
 * up validating typos of real words. The families below are recognized by
 * shape rather than listed word by word, so the same class of noise stays out
 * when the MorphoBr snapshot is regenerated.
 *
 * Only the plural row is dropped: the lemma and its other forms are untouched,
 * and a form that another source attests on its own (the loanwords "stress",
 * "loess", "miss") is unaffected, since this filters MorphoBr, not the pool.
 *
 *   1. bare -s on a word already ending in -s/-z/-x: those pluralize with -es
 *      or stay invariable, never by appending -s ("invess", "jesuss",
 *      "sifiliss", "ultrizs", "duplexs").
 *   2. -il turned into -iis, keeping the stem's i ("anil" -> "aniis" instead
 *      of "anis"): no Portuguese plural doubles the i this way.
 *   3. bare -s on a word ending in -l/-m when the paradigm also carries the
 *      regular plural ("docils" beside "doceis", "decolagems" beside
 *      "decolagens"): the -s row is a duplicate of a plural already formed
 *      correctly. The "paradigm also has it" guard is what keeps the
 *      loanwords that really do take -s ("pixels", "emails", "booms").
 *
 * Left alone on purpose: -n and -r finals, where the bare -s plural is the
 * standard one ("hifens", "polens", "hackers", "outdoors") and it is MorphoBr's
 * *other* form ("hifenes", "hackeres") that is dubious.
 */
function badPlural(form, lemma, feats, pluralsOf) {
  if (!PL_FEAT.test(feats) || DERIV_FEAT.test(feats)) return false;
  if (form === lemma + "s") {
    if (/[szx]$/.test(lemma)) return true;
    if (/[lm]$/.test(lemma)) {
      const pls = pluralsOf.get(lemma);
      const regular = lemma.endsWith("m")
        ? [lemma.slice(0, -1) + "ns"]
        : [
            lemma.slice(0, -1) + "is",
            lemma.slice(0, -2) + "is",
            lemma.slice(0, -2) + "eis",
          ];
      if (regular.some((p) => pls.has(p))) return true;
    }
    return false;
  }
  if (lemma.endsWith("il") && form === lemma.slice(0, -1) + "is") return true;
  return false;
}

/**
 * The compiled MorphoBr morphological lexicon (see SOURCES.md and
 * pt-br/compile-morphobr.js). Returns two indexes over the same rows:
 *
 *   byForm:  normalized form  -> [{ lemma, pos, feats }]
 *   byLemma: normalized lemma -> [{ form, pos, feats }]
 *
 * pos is one of N, V, A, ADV; feats is the remaining "+"-joined tag string
 * (e.g. "PRS+1+SG", "DIM+M+PL", "" for adverbs).
 */
export function loadMorphoBr() {
  const raw = gunzipSync(
    readFileSync(join(ptbr, "sources", "morphobr.tsv.gz")),
  ).toString("utf8");

  const rows = [];
  const pluralsOf = new Map(); // lemma -> Set<plural form>
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [form, lemma, pos, feats = ""] = line.split("\t");
    rows.push({ form, lemma, pos, feats });
    if (PL_FEAT.test(feats) && !DERIV_FEAT.test(feats)) {
      let s = pluralsOf.get(lemma);
      if (!s) pluralsOf.set(lemma, (s = new Set()));
      s.add(form);
    }
  }

  const byForm = new Map();
  const byLemma = new Map();
  for (const { form, lemma, pos, feats } of rows) {
    if (badPlural(form, lemma, feats, pluralsOf)) continue;
    let f = byForm.get(form);
    if (!f) byForm.set(form, (f = []));
    f.push({ lemma, pos, feats });
    let l = byLemma.get(lemma);
    if (!l) byLemma.set(lemma, (l = []));
    l.push({ form, pos, feats });
  }
  return { byForm, byLemma };
}

/**
 * Definitions compiled from the Portuguese Wiktionary (see SOURCES.md and
 * pt-br/compile-wiktionary.js). Returns Map normalized word -> [{ pos, g }],
 * one entry per word class the word is attested in; each gloss in `g` is
 * `{ t: text, w?: accented source spelling }`, `w` present only when it
 * differs from the map key (an accent/case homograph, e.g. "ira"/"irá"/"Irã").
 */
export function loadWiktionary() {
  const raw = gunzipSync(
    readFileSync(join(ptbr, "sources", "wiktionary.jsonl.gz")),
  ).toString("utf8");
  const byWord = new Map();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const { w, pos, g } = JSON.parse(line);
    if (!byWord.has(w)) byWord.set(w, []);
    byWord.get(w).push({ pos, g });
  }
  return byWord;
}

/** Raw words from the "common"-class source (curated everyday vocabulary). */
export function loadCommonSources() {
  const omret = JSON.parse(
    readFileSync(join(ptbr, "sources", "omret.json"), "utf8"),
  );
  // omret maps normalized -> accented; either side normalizes to the same token.
  return Object.keys(omret);
}

export { ptbr };
