// Compile a MorphoBr checkout (https://github.com/LR-POR/MorphoBr, Apache-2.0)
// into sources/morphobr.tsv.gz: one row per (form, lemma, pos, feats), both
// form and lemma accent-stripped by our normalization, deduped, sorted by form.
//
// The clitics/ dir is skipped: those are hyphenated verb+clitic combinations
// ("comprei-o"), which normalizeWord() rejects anyway.
//
// Diminutive/augmentative/superlative rows are kept and carry their DIM/AUG/
// SUPERL tag; whether they count as playable is a build-time policy decision,
// not a compile-time one.
//
// Usage: node pt-br/compile-morphobr.js --src=/path/to/MorphoBr

import { createReadStream, createWriteStream, readdirSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { createInterface } from "node:readline";
import { createGzip } from "node:zlib";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr } from "../lib/sources.js";

const args = Object.fromEntries(
  argv.slice(2).filter((a) => a.includes("=")).map((a) => a.replace(/^--/, "").split("=")),
);
if (!args.src) {
  console.error("Usage: node pt-br/compile-morphobr.js --src=/path/to/MorphoBr");
  exit(1);
}

const CLASS_DIRS = ["nouns", "verbs", "adjectives", "adverbs"];
const out = join(ptbr, "sources", "morphobr.tsv.gz");

const rows = new Set();
let raw = 0, dropped = 0;

for (const dir of CLASS_DIRS) {
  const full = join(args.src, dir);
  for (const file of readdirSync(full).filter((f) => f.endsWith(".dict"))) {
    const rl = createInterface({ input: createReadStream(join(full, file)), crlfDelay: Infinity });
    for await (const line of rl) {
      raw++;
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const form = normalizeWord(line.slice(0, tab));
      const analysis = line.slice(tab + 1);
      const plus = analysis.indexOf("+");
      if (plus < 0) continue;
      const lemma = normalizeWord(analysis.slice(0, plus));
      const tags = analysis.slice(plus + 1); // e.g. "V+PRS+1+SG", "N+DIM+M+SG"
      const tagPlus = tags.indexOf("+");
      const pos = tagPlus < 0 ? tags : tags.slice(0, tagPlus);
      const feats = tagPlus < 0 ? "" : tags.slice(tagPlus + 1);
      if (!form || !lemma) {
        dropped++;
        continue;
      }
      rows.add(`${form}\t${lemma}\t${pos}\t${feats}`);
    }
  }
  console.error(`${dir}: done (${rows.size} unique rows so far)`);
}

const sorted = [...rows].sort();
const gz = createGzip({ level: 9 });
const sink = createWriteStream(out);
gz.pipe(sink);
const CHUNK = 50_000;
for (let i = 0; i < sorted.length; i += CHUNK) {
  const ok = gz.write(sorted.slice(i, i + CHUNK).join("\n") + "\n");
  if (!ok) await new Promise((r) => gz.once("drain", r));
}
gz.end();
await new Promise((r) => sink.on("finish", r));

console.log(`morphobr.tsv.gz: ${sorted.length} rows (from ${raw} raw lines, ${dropped} unparseable/non-alphabetic) -> ${out}`);
