// PT-BR dictionary build pipeline.
//
// Sources give candidate words and frequency; MorphoBr gives morphology (lemma,
// POS, features); curated/ gives the hand-made decisions (lemmas.tsv, forms.tsv,
// removals.txt, definitions.tsv, definition-redirects.tsv). The engine
// (engine.js) combines the tiering inputs: every in-game lemma's paradigm
// expands into the pool, and each word's tier follows the precedence
// documented at the top of engine.js.
//
// Definitions come from Wiktionary first (see compile-wiktionary.js), then
// curated/definitions.tsv for words Wiktionary has no Portuguese-language
// coverage for at all (loanwords, ethnonyms, informal abbreviations, ...),
// then curated/definition-redirects.tsv for pure spelling variants of an
// already-defined word (e.g. "lage", the pre-orthographic-reform spelling of
// "laje") rather than a distinct sense worth its own gloss.
//
// Outputs (dist/, committed, consumers read these without building):
//   t1.txt / t2.txt / t3.txt  mutually exclusive tiers (t1 common/answers,
//                             t2 extended, t3 rare/obscure)
//   words.txt                 the whole valid pool (t1 + t2 + t3)
//   lexicon.jsonl             one line per word: tier + morphological analyses
//                             + curation tags + definitions ("d", plain gloss
//                             strings, individually tagged with "[spelling] "
//                             when they come from an accented/cased
//                             homograph; "dw" instead, no inline tags, when
//                             every gloss converges on one such spelling), for
//                             POS-aware / definition-aware consumers
//   manifest.json             build stats
//
// Usage: node --max-old-space-size=6000 pt-br/build.js

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr, loadWiktionary } from "../lib/sources.js";
import { loadEngine } from "./engine.js";

// Wiktionary's own row order (sorted "word\tpos") is alphabetical by POS code,
// which is not remotely a proxy for how likely a reading is: "rua" sorts its
// "intj" ("fora!, gire!") row before its "noun" (street) row purely because
// "intj" < "noun" as a string. Rank the open, content-bearing classes first;
// everything else (closed-class words, and any POS kaikki adds later) falls
// back to alphabetical order after them.
const POS_PRIORITY = ["noun", "verb", "adj", "adv"];
function posRank(pos) {
  const i = POS_PRIORITY.indexOf(pos);
  return i === -1 ? POS_PRIORITY.length : i;
}
function byPosPriority(a, b) {
  return posRank(a.pos) - posRank(b.pos) || a.pos.localeCompare(b.pos);
}

function readTsv(name) {
  const path = join(ptbr, "curated", name);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t").map((c) => c.trim()));
}

// curated/definitions.tsv: hand-written definitions for words Wiktionary has
// no Portuguese-language coverage for at all (loanwords, ethnonyms, informal
// abbreviations, ...). Columns: word  pos  gloss  [accent], one row per gloss;
// same { pos, g: [{t, w?}] } per-word shape as loadWiktionary() so it can be
// merged into the same "own defs" resolution build.js already does for
// Wiktionary. The optional 4th column is the word's accented/cased spelling
// when it differs from the plain board word (e.g. "carre"'s only sense is
// "carré"), reusing the same per-gloss tag / word-level "dw" convergence
// mechanism as Wiktionary-sourced accent homographs (see resolveOwnDefs).
function loadCuratedDefinitions() {
  const byWord = new Map();
  for (const [word, pos, gloss, accent] of readTsv("definitions.tsv")) {
    const w = normalizeWord(word);
    if (!w || !pos || !gloss) continue;
    if (!byWord.has(w)) byWord.set(w, []);
    const rows = byWord.get(w);
    let row = rows.find((r) => r.pos === pos);
    if (!row) rows.push((row = { pos, g: [] }));
    row.g.push(accent ? { t: gloss, w: accent } : { t: gloss });
  }
  return byWord;
}

// curated/definition-redirects.tsv: words that are pure spelling variants of
// another, already-defined word (e.g. "lage", the pre-orthographic-reform
// spelling of "laje") rather than a distinct sense worth its own gloss.
// Columns: word  target  reason.
function loadDefinitionRedirects() {
  const map = new Map();
  for (const [word, target] of readTsv("definition-redirects.tsv")) {
    const w = normalizeWord(word);
    const t = normalizeWord(target);
    if (w && t) map.set(w, t);
  }
  return map;
}

// Resolve a word's own definitions (own Wiktionary/curated entry only, no
// lemma fallback) into { d, dw? }, or null when it has none. Shared between a
// word's own entry and a definition-redirect target (see build() below).
function resolveOwnDefs(word, defs) {
  if (!defs?.length) return null;
  const sorted = defs.slice().sort(byPosPriority);
  // Each gloss's effective source spelling: its own accent/case tag (see
  // compile-wiktionary.js), or `word` itself when untagged. If every gloss
  // agrees on one spelling other than `word`, the word has no sense of its
  // own — it's only defined under that other form (e.g. "fara" is only
  // attested as "fará", the future tense of "fazer") — so surface it as one
  // word-level label (`dw`) instead of tagging every gloss inline. Compared
  // case-insensitively: the UI always renders this uppercase anyway, so a
  // lowercase/capitalized split like "ária" (the song) vs. "Ária" (the given
  // name) still reads as one converged spelling, not two — pick the
  // lowercase form as the representative when one exists.
  const origins = sorted.flatMap((d) => d.g).map((it) => it.w ?? word);
  const originKeys = new Set(origins.map((o) => o.toLowerCase()));
  if (originKeys.size === 1 && !originKeys.has(word)) {
    return {
      dw: origins.find((o) => o === o.toLowerCase()) ?? origins[0],
      d: sorted.map((d) => ({ pos: d.pos, g: d.g.map((it) => it.t) })),
    };
  }
  return {
    d: sorted.map((d) => ({
      pos: d.pos,
      g: d.g.map((it) => (it.w ? `[${it.w}] ${it.t}` : it.t)),
    })),
  };
}

export async function build() {
  const engine = await loadEngine();
  const pool = engine.pool();
  const wiktionary = loadWiktionary();
  const curatedDefs = loadCuratedDefinitions();
  const redirects = loadDefinitionRedirects();

  const t1 = [],
    t2 = [],
    t3 = [];
  const lexicon = [];
  for (const w of [...pool].sort()) {
    const { tier, analyses } = engine.resolve(w);
    if (tier !== 1 && tier !== 2 && tier !== 3) continue; // defensive; pool excludes removals
    [null, t1, t2, t3][tier].push(w);

    const entry = { w, t: tier };
    const tags = engine.lemmas.get(w)?.flatMap((r) => r.tags) ?? [];
    if (tags.length) entry.g = [...new Set(tags)];

    // Prefer the word's own Wiktionary entry (also covers inflected forms
    // that have one, e.g. "flexão de X" glosses), merged with
    // curated/definitions.tsv (hand-written glosses for senses Wiktionary is
    // missing, whether the word has no Wiktionary coverage at all, like
    // "aulo", or just an incomplete one, like "pet": Wiktionary only has the
    // "PET" plastic sense, curated/definitions.tsv adds the "animal de
    // estimação" one); otherwise fall back to its lemma(s), since most
    // conjugations/plurals are not defined on their own.
    const ownRows = (rows, curated) => (rows || curated ? [...(rows ?? []), ...(curated ?? [])] : null);
    let own = resolveOwnDefs(w, ownRows(wiktionary.get(w), curatedDefs.get(w)));
    if (!own && redirects.has(w)) {
      // Another word whose definition also applies here, either a pure
      // spelling variant (e.g. "lage", the pre-orthographic-reform spelling
      // of "laje") or a form MorphoBr doesn't link to its own lemma (e.g.
      // "zere", imperative of "zerar"; "pets", plural of "pet"): reuse the
      // target's own definitions. If the target itself has no single
      // converged spelling, promote the target word as `dw` anyway — it's
      // still the one accurate spelling/lemma to show for `w`.
      const target = redirects.get(w);
      const targetOwn = resolveOwnDefs(target, ownRows(wiktionary.get(target), curatedDefs.get(target)));
      if (targetOwn) own = { dw: targetOwn.dw ?? target, d: targetOwn.d };
    }
    if (own) {
      entry.d = own.d;
      if (own.dw) entry.dw = own.dw;
    } else {
      const lemmaWords = [...new Set(analyses.map((a) => a.lemma))];
      const rawDefs = lemmaWords.flatMap((l) => ownRows(wiktionary.get(l), curatedDefs.get(l)) ?? []).sort(byPosPriority);
      if (rawDefs.length) entry.d = rawDefs.map((d) => ({ pos: d.pos, g: d.g.map((it) => it.t) }));
    }

    if (analyses.length) {
      entry.a = analyses.map(({ lemma, pos, rows, tier: at }) => {
        const a = { l: lemma, pos, f: rows.map((r) => r.feats) };
        if (at !== null) a.t = at;
        const ltags =
          lemma !== w && engine.lemmas.get(lemma)?.flatMap((r) => r.tags);
        if (ltags && ltags.length) a.g = [...new Set(ltags)];
        return a;
      });
    }
    lexicon.push(JSON.stringify(entry));
  }

  const valid = [...t1, ...t2, ...t3].sort();
  const withDefs = lexicon.reduce(
    (n, line) => n + (JSON.parse(line).d ? 1 : 0),
    0,
  );

  return {
    t1,
    t2,
    t3,
    valid,
    lexicon,
    stats: {
      curatedLemmas: engine.lemmas.size,
      curatedForms: engine.forms.size,
      removals: engine.removals.size,
      t1: t1.length,
      t2: t2.length,
      t3: t3.length,
      valid: valid.length,
      withDefs,
    },
  };
}

function writeOutput({ t1, t2, t3, valid, lexicon, stats }) {
  const dist = join(ptbr, "dist");
  writeFileSync(join(dist, "t1.txt"), t1.join("\n") + "\n");
  writeFileSync(join(dist, "t2.txt"), t2.join("\n") + "\n");
  writeFileSync(join(dist, "t3.txt"), t3.join("\n") + "\n");
  writeFileSync(join(dist, "words.txt"), valid.join("\n") + "\n");
  writeFileSync(join(dist, "lexicon.jsonl"), lexicon.join("\n") + "\n");
  // No timestamp: keep manifest deterministic so rebuilds are idempotent.
  writeFileSync(
    join(dist, "manifest.json"),
    JSON.stringify(stats, null, 2) + "\n",
  );
}

// Run as a script: build and write dist/.
if (import.meta.url === pathToFileURL(argv[1]).href) {
  const result = await build();
  writeOutput(result);
  console.log("wordlists pt-br built:", result.stats);
}
