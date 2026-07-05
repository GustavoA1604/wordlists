// PT-BR dictionary build pipeline.
//
// Merges the raw sources, applies the curated overrides, and writes neutral,
// length-agnostic output to dist/. Consumers (e.g. the entrelinhas game) read
// dist/ and apply their own game-specific filtering (length, etc.).
//
// Three tiers, mutually exclusive:
//   t1 (common)   - omret curated everyday words, used as game answers
//   t2 (extended) - silvio broader everyday list, recognized but less frequent
//   t3 (rare)     - finder.js broad dictionary, obscure/archaic/technical
//
// Curated overrides in curated/: t1.txt, t2.txt, t3.txt, removals.txt.
// Each word lives in exactly one file. Adding to t1.txt promotes it there
// regardless of its source. removals.txt removes a word from all tiers.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { normalizeAll, normalizeWord, sortUnique } from "../lib/normalize.js";
import {
  ptbr,
  loadValidSources,
  loadUncommonSources,
  loadCommonSources,
  loadFreqSources,
  readCurated,
} from "../lib/sources.js";

function curatedSet(name) {
  return new Set(readCurated(name).map(normalizeWord).filter(Boolean));
}

/**
 * Uncurated, normalized base pools (no overrides applied). Shared by build() and
 * the migration script so both agree on exactly what "base" means.
 */
export async function bases() {
  const t1Base = normalizeAll([
    ...loadCommonSources(),
    ...loadFreqSources(5000),
  ]);
  // t2Base: silvio curated list + top-1000 fserb frequency words.
  // The freq slice fills gaps in curated sources (common short words,
  // conjugations, plurals) that Wordle-oriented lists tend to miss.
  const t2Base = normalizeAll([
    ...loadUncommonSources(),
    ...loadFreqSources(15000),
  ]);
  // t3Base: broad finder.js dictionary + the next slice of frequency words
  // (ranks 15000-20000). That range is rare enough it never promotes to t1/t2,
  // so it lands in t3 by the same fallback logic below.
  const t3Base = normalizeAll([
    ...(await loadValidSources()),
    ...loadFreqSources(20000),
  ]);
  return { t1Base, t2Base, t3Base };
}

export async function build() {
  const { t1Base, t2Base, t3Base } = await bases();

  const curatedT1 = curatedSet("t1.txt");
  const curatedT2 = curatedSet("t2.txt");
  const curatedT3 = curatedSet("t3.txt");
  const rejections = curatedSet("removals.txt");

  // Union of all sources and curated additions, minus rejections.
  const allWords = new Set([
    ...t1Base, ...t2Base, ...t3Base,
    ...curatedT1, ...curatedT2, ...curatedT3,
  ]);
  for (const w of rejections) allWords.delete(w);

  // Assign each word to exactly one tier. Curated overrides take priority;
  // source membership (t1Base > t2Base > t3Base) is the fallback.
  const t1BaseSet = new Set(t1Base);
  const t2BaseSet = new Set(t2Base);

  const t1 = [], t2 = [], t3 = [];
  for (const w of sortUnique([...allWords])) {
    if      (curatedT1.has(w))  t1.push(w);
    else if (curatedT2.has(w))  t2.push(w);
    else if (curatedT3.has(w))  t3.push(w);
    else if (t1BaseSet.has(w))  t1.push(w);
    else if (t2BaseSet.has(w))  t2.push(w);
    else                        t3.push(w);
  }

  const valid = sortUnique([...t1, ...t2, ...t3]);

  return {
    t1, t2, t3, valid,
    stats: {
      t1Base: t1Base.length,
      t2Base: t2Base.length,
      t3Base: t3Base.length,
      curatedT1: curatedT1.size,
      curatedT2: curatedT2.size,
      curatedT3: curatedT3.size,
      rejections: rejections.size,
      t1: t1.length,
      t2: t2.length,
      t3: t3.length,
      valid: valid.length,
    },
  };
}

function writeOutput({ t1, t2, t3, valid, stats }) {
  const dist = join(ptbr, "dist");
  writeFileSync(join(dist, "t1.txt"), t1.join("\n") + "\n");
  writeFileSync(join(dist, "t2.txt"), t2.join("\n") + "\n");
  writeFileSync(join(dist, "t3.txt"), t3.join("\n") + "\n");
  writeFileSync(join(dist, "words.txt"), valid.join("\n") + "\n");
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
