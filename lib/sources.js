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
 */
export function loadFreqSources(cutoff = 1000) {
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
    if (AZ.test(w) && !seen.has(w)) {
      seen.add(w);
      result.push(w);
    }
  }
  return result;
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
  const byForm = new Map();
  const byLemma = new Map();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [form, lemma, pos, feats = ""] = line.split("\t");
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
