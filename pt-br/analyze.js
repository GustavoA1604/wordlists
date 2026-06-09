// Compare candidate word sources against the current export (dist/words.txt).
//
// For each candidate it reports how many normalized words it would ADD on top of
// the current valid pool, broken down by length, and writes the full added list
// to pt-br/analysis/<name>.added.txt for inspection.
//
// Candidates:
//   - the local Ueda dictionaries (already in sources/)
//   - any *.txt / *.js / *.json file dropped into pt-br/_candidates/
//
// Usage: node pt-br/analyze.js [--len=5] [--min=3] [--max=15]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeWord, sortUnique } from "../lib/normalize.js";
import { ptbr } from "../lib/sources.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const onlyLen = args.len ? Number(args.len) : null;
const minLen = args.min ? Number(args.min) : 1;
const maxLen = args.max ? Number(args.max) : Infinity;

function inRange(w) {
  if (onlyLen) return w.length === onlyLen;
  return w.length >= minLen && w.length <= maxLen;
}

function readLines(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// Pull plausible word tokens out of an arbitrary text/js/json blob.
function extractRaw(path) {
  if (path.endsWith(".txt")) {
    // First whitespace/comma/tab-delimited field per line, so "word", "word,score"
    // and "lemma,code" all yield the word.
    return readLines(path).map((l) => l.split(/[\s,;|]+/)[0]);
  }
  const text = readFileSync(path, "utf8");
  // grab quoted strings and bare alpha-ish tokens (accents included)
  const quoted = [...text.matchAll(/"([^"\\]+)"/g)].map((m) => m[1]);
  if (quoted.length) return quoted;
  return text.split(/[^\p{L}-]+/u).filter(Boolean);
}

const baseline = new Set(
  readLines(join(ptbr, "dist", "words.txt")).map(normalizeWord).filter(Boolean),
);

// Build the candidate list: local Ueda files + anything in _candidates/.
const candidates = [
  { name: "ueda-palavras", path: join(ptbr, "sources", "ueda-palavras.txt") },
  { name: "ueda-dicio", path: join(ptbr, "sources", "ueda-dicio.txt") },
];
const candDir = join(ptbr, "_candidates");
if (existsSync(candDir)) {
  for (const f of readdirSync(candDir)) {
    if (/\.(txt|js|json)$/.test(f)) {
      candidates.push({ name: basename(f).replace(/\.[^.]+$/, ""), path: join(candDir, f) });
    }
  }
}

const outDir = join(ptbr, "analysis");
mkdirSync(outDir, { recursive: true });

function lenHistogram(words) {
  const by = {};
  for (const w of words) by[w.length] = (by[w.length] || 0) + 1;
  return by;
}

const scopeLabel = onlyLen
  ? `len=${onlyLen}`
  : `len ${minLen}..${maxLen === Infinity ? "∞" : maxLen}`;
console.log(`Baseline (current dist/words.txt): ${baseline.size} words, all 5-letter`);
console.log(`Scope for "added" counts: ${scopeLabel}\n`);

const rows = [];
for (const c of candidates) {
  let raw;
  try {
    raw = c.path.endsWith(".js") ? Object.values(await import(pathToFileURL(c.path).href)).flat() : extractRaw(c.path);
  } catch (e) {
    console.log(`! ${c.name}: failed to read (${e.message})`);
    continue;
  }
  const normalized = sortUnique(raw.flat().map(normalizeWord).filter(Boolean));
  const added = normalized.filter((w) => !baseline.has(w) && inRange(w));
  const addedFive = normalized.filter((w) => !baseline.has(w) && w.length === 5);

  writeFileSync(join(outDir, `${c.name}.added.txt`), added.join("\n") + "\n");
  rows.push({
    source: c.name,
    normalized: normalized.length,
    addedTotal: added.length,
    added5: addedFive.length,
    hist: lenHistogram(added),
  });
}

console.table(
  rows.map((r) => ({
    source: r.source,
    "normalized words": r.normalized,
    "would add (scope)": r.addedTotal,
    "would add (5-letter)": r.added5,
  })),
);
console.log("\nAdded-by-length per source:");
for (const r of rows) console.log(`  ${r.source}:`, JSON.stringify(r.hist));
console.log(`\nFull added lists written to pt-br/analysis/<source>.added.txt`);
