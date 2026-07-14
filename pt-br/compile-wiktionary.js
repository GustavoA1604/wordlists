// Compile a kaikki.org Wiktextract dump of pt.wiktionary.org
// (https://kaikki.org/ptwiktionary/) into sources/wiktionary.jsonl.gz: one row
// per (word, pos) with its glosses ({t: text, w?: accented source spelling}),
// word accent-stripped by our normalization.
//
// Only lang_code "pt" entries are kept (the dump documents words in hundreds
// of languages, since it is built from the Portuguese Wiktionary's coverage of
// all languages, not just Portuguese words). Definitions are descriptive only:
// they play no part in tiering (see engine.js), so absence is never fatal, the
// same stance already taken for MorphoBr's own coverage gaps.
//
// Portuguese Wiktionary gives a proper noun its own capitalized page (a place
// name most commonly: Brazil has thousands of municipalities that double as
// everyday words, e.g. "Óleo" is both a town in São Paulo and the word for
// oil). normalizeWord() lowercases and accent-strips, so a common word and
// its capitalized homograph collide onto the same key (~2.4k words in the
// full dump). Glosses are kept separate by source casing and concatenated
// lowercase-first, so a consumer taking glosses[0] as "the" definition gets
// the everyday sense, not the town.
//
// Usage: node pt-br/compile-wiktionary.js --src=/path/to/raw-wiktextract-data.jsonl[.gz]

import { createReadStream, createWriteStream } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { createInterface } from "node:readline";
import { createGzip, createGunzip } from "node:zlib";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr } from "../lib/sources.js";

const args = Object.fromEntries(
  argv
    .slice(2)
    .filter((a) => a.includes("="))
    .map((a) => a.replace(/^--/, "").split("=")),
);
if (!args.src) {
  console.error(
    "Usage: node pt-br/compile-wiktionary.js --src=/path/to/raw-wiktextract-data.jsonl[.gz]",
  );
  exit(1);
}

const out = join(ptbr, "sources", "wiktionary.jsonl.gz");

// One-off source-data corrections: rare pages where pt.wiktionary.org's own
// wikitext has a stray/unmatched markup character that survives extraction
// verbatim (e.g. "faria"'s condicional gloss leaks an unclosed italic quote:
// "verbo 'fazer" instead of "verbo fazer"). Not a pattern to regex away —
// Portuguese legitimately uses apostrophes elsewhere (d'água, ('fruto')) —
// so fix by exact string instead.
const GLOSS_FIXES = new Map([
  [
    "primeira pessoa do singular do condicional do verbo 'fazer",
    "primeira pessoa do singular do condicional do verbo fazer",
  ],
]);

let input = createReadStream(args.src);
if (args.src.endsWith(".gz")) input = input.pipe(createGunzip());
const rl = createInterface({ input, crlfDelay: Infinity });

// key `${word}\t${pos}` -> { lower: Map<gloss, sourceWord>, upper: Map<gloss, sourceWord> }.
// sourceWord is the raw (accented/cased) Wiktionary page title the gloss came
// from, kept so homographs that only differ by accent or case (ira/irá/Irã
// all normalize to "ira") can be told apart at emit time.
const rows = new Map();
let raw = 0,
  kept = 0,
  dropped = 0;

for await (const line of rl) {
  raw++;
  if (!line) continue;
  let d;
  try {
    d = JSON.parse(line);
  } catch {
    dropped++;
    continue;
  }
  if (d.lang_code !== "pt") continue;
  // Prefix/suffix page titles carry a leading or trailing hyphen (e.g.
  // "pré-", "-mente") that normalizeWord() rejects outright (it only accepts
  // pure a-z after accent-stripping) — strip it before normalizing so those
  // senses aren't silently dropped. Without this, "pre" had no definition at
  // all: Wiktionary only documents it as the prefix "pré-", never as a plain
  // word on its own page.
  const rawWord = d.word.replace(/^-|-$/g, "");
  const w = normalizeWord(rawWord);
  if (!w) {
    dropped++;
    continue;
  }
  const pos = typeof d.pos === "string" && d.pos ? d.pos : "-";
  const glosses = (d.senses ?? [])
    .flatMap((s) => s.glosses ?? [])
    .map((g) => g.trim())
    .map((g) => GLOSS_FIXES.get(g) ?? g)
    .filter(Boolean);
  if (!glosses.length) continue;

  const key = `${w}\t${pos}`;
  if (!rows.has(key)) rows.set(key, { lower: new Map(), upper: new Map() });
  const firstChar = rawWord[0];
  const isProperSource = firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
  const bucket = rows.get(key)[isProperSource ? "upper" : "lower"];
  for (const g of glosses) if (!bucket.has(g)) bucket.set(g, rawWord);
  kept++;
}

const gz = createGzip({ level: 9 });
const sink = createWriteStream(out);
gz.pipe(sink);
for (const key of [...rows.keys()].sort()) {
  const [w, pos] = key.split("\t");
  const { lower, upper } = rows.get(key);
  // lowercase-sourced glosses first
  const texts = [...new Set([...lower.keys(), ...upper.keys()])];
  // A gloss whose source page title isn't exactly `w` is for an accented or
  // capitalized homograph (e.g. "ira" the noun vs "Irã" the country vs "irá"
  // the verb form all normalize to "ira"). Carry that source spelling
  // alongside the gloss text (omitted when it matches `w`) instead of baking
  // it into the string, so a downstream consumer can decide whether to tag
  // each gloss individually or, when every gloss in a word converges on one
  // spelling, promote it to a single word-level label instead.
  const g = texts.map((t) => {
    const source = lower.has(t) ? lower.get(t) : upper.get(t);
    return source === w ? { t } : { t, w: source };
  });
  const line = JSON.stringify({ w, pos, g }) + "\n";
  const ok = gz.write(line);
  if (!ok) await new Promise((r) => gz.once("drain", r));
}
gz.end();
await new Promise((r) => sink.on("finish", r));

console.log(
  `wiktionary.jsonl.gz: ${rows.size} (word,pos) rows from ${kept} kept entries (${raw} raw lines, ${dropped} unparseable/non-alphabetic) -> ${out}`,
);
