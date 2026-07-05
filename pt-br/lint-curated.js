// Curated file linter.
//
// 1. Fail fast if any word appears in more than one curated file.
// 2. Remove entries that are redundant (word would land in the same tier
//    without the override — the curated entry has no effect).
// 3. Re-write each file sorted alphabetically, preserving the header comment.
//
// Usage: node pt-br/lint-curated.js [--dry-run]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { bases } from "./build.js";
import { ptbr, readCurated } from "../lib/sources.js";
import { normalizeWord } from "../lib/normalize.js";

const DRY_RUN = argv.includes("--dry-run");

// ── helpers ─────────────────────────────────────────────────────────────────

function readFile(name) {
  return readFileSync(join(ptbr, "curated", name), "utf8");
}

/** Parse a curated file into { header, words }. header is the first `#` line. */
function parse(name) {
  const raw = readFile(name);
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines.find((l) => l.startsWith("#")) ?? "";
  const words = lines
    .filter((l) => !l.startsWith("#"))
    .map(normalizeWord)
    .filter(Boolean);
  return { header, words };
}

function write(name, header, words) {
  const sorted = [...new Set(words)].sort();
  const content = [header, ...sorted, ""].join("\n");
  writeFileSync(join(ptbr, "curated", name), content, "utf8");
}

// ── load all four curated files ──────────────────────────────────────────────

const FILES = ["t1.txt", "t2.txt", "t3.txt", "removals.txt"];
const parsed = Object.fromEntries(FILES.map((f) => [f, parse(f)]));

// ── step 1: duplicate check ──────────────────────────────────────────────────

const seen = new Map(); // word → filename
let hasDupes = false;
for (const file of FILES) {
  for (const w of parsed[file].words) {
    if (seen.has(w)) {
      console.error(`DUPLICATE: "${w}" in ${seen.get(w)} and ${file}`);
      hasDupes = true;
    } else {
      seen.set(w, file);
    }
  }
}
if (hasDupes) {
  console.error("Fix duplicates before continuing.");
  exit(1);
}
console.log("✓ No duplicates across curated files.");

// ── step 2: compute base sets ────────────────────────────────────────────────

const { t1Base, t2Base, t3Base } = await bases();
const t1BaseSet = new Set(t1Base);
const t2BaseSet = new Set(t2Base);
const t3BaseSet = new Set(t3Base);

const curatedT1 = new Set(parsed["t1.txt"].words);
const curatedT2 = new Set(parsed["t2.txt"].words);
const curatedT3 = new Set(parsed["t3.txt"].words);
const curatedRem = new Set(parsed["removals.txt"].words);

// ── step 3: find and remove redundant entries ────────────────────────────────

/**
 * A curated entry is redundant when the word would end up in the same tier
 * (or be absent) even without the explicit override.
 *
 *  t1.txt:       word is already in t1BaseSet  → naturally t1
 *  t2.txt:       word is in t2BaseSet AND NOT in t1BaseSet  → naturally t2
 *  t3.txt:       word is in t3BaseSet AND NOT in t1BaseSet AND NOT in t2BaseSet  → naturally t3
 *  removals.txt: word is absent from every source and curated tier
 *                → would never appear anyway
 */
function isRedundant(file, w) {
  switch (file) {
    case "t1.txt":
      return t1BaseSet.has(w);
    case "t2.txt":
      return !t1BaseSet.has(w) && t2BaseSet.has(w);
    case "t3.txt":
      return t3BaseSet.has(w) && !t1BaseSet.has(w) && !t2BaseSet.has(w);
    case "removals.txt": {
      const inAnyBase = t1BaseSet.has(w) || t2BaseSet.has(w) || t3BaseSet.has(w);
      const inAnyCurated = curatedT1.has(w) || curatedT2.has(w) || curatedT3.has(w);
      return !inAnyBase && !inAnyCurated;
    }
  }
}

let totalRemoved = 0;
for (const file of FILES) {
  const { header, words } = parsed[file];
  const redundant = words.filter((w) => isRedundant(file, w));
  const kept = words.filter((w) => !isRedundant(file, w));

  if (redundant.length > 0) {
    console.log(
      `${file}: removing ${redundant.length} redundant entr${redundant.length === 1 ? "y" : "ies"}: ${redundant.join(", ")}`,
    );
    totalRemoved += redundant.length;
  }

  if (!DRY_RUN) write(file, header, kept);
  else parsed[file].kept = kept; // used only for dry-run reporting
}

if (totalRemoved === 0) console.log("✓ No redundant entries found.");

// ── step 4: sort ─────────────────────────────────────────────────────────────

if (!DRY_RUN) {
  for (const file of FILES) {
    const { header, words } = parsed[file];
    // Re-read after redundancy removal (write() already sorted, this is a no-op
    // if we just wrote, but ensures sort even when nothing was removed).
    const cleaned = words.filter((w) => !isRedundant(file, w));
    write(file, header, cleaned);
  }
  console.log("✓ Files sorted and written.");
} else {
  console.log("(dry-run: no files written)");
}
