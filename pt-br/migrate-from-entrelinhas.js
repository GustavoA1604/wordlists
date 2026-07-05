// One-off migration: seed the curated/ override files from the delta between a
// fresh (uncurated) pipeline run and the current hand-curated entrelinhas lists.
//
// Usage: node pt-br/migrate-from-entrelinhas.js [path-to-entrelinhas]
//
// This makes the migration lossless by construction: whatever the base pipeline
// fails to reproduce is captured as a curated addition/removal, so regenerating
// entrelinhas from dist/ reproduces today's committed lists exactly.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ptbr } from "../lib/sources.js";
import { bases } from "./build.js";

const FIVE = /^[a-z]{5}$/;

function parseQuotedWords(path) {
  // Pull every "abcde"-style token out of valid.js / answers.js.
  const text = readFileSync(path, "utf8");
  return new Set([...text.matchAll(/"([a-z]+)"/g)].map((m) => m[1]));
}

function writeCurated(name, words, header) {
  const sorted = [...words].sort();
  const body = sorted.length ? sorted.join("\n") + "\n" : "";
  writeFileSync(join(ptbr, "curated", name), `# ${header}\n${body}`);
  return sorted.length;
}

const entrelinhas = process.argv[2] || "D:/dev/entrelinhas";

const { t1Base, t2Base, t3Base } = await bases();

const allBase = [...t1Base, ...t2Base, ...t3Base];
const v5 = new Set(allBase.filter((w) => FIVE.test(w)));
const c5 = new Set(t1Base.filter((w) => FIVE.test(w)));

const curValid = parseQuotedWords(join(entrelinhas, "src/data/valid.js"));
const curAnswers = parseQuotedWords(join(entrelinhas, "src/data/answers.js"));

// Words missing from sources go into t2 (extended) by default.
// Words that sources include as t1 but should be excluded from answers go into t2.
const t1Add = [...curAnswers].filter((w) => !c5.has(w));
const t2Add = [
  ...[...curValid].filter((w) => !v5.has(w)),       // missing from valid sources
  ...[...c5].filter((w) => !curAnswers.has(w)),      // demoted from t1
];
const removed = [...v5].filter((w) => !curValid.has(w));

const counts = {
  "t1.txt": writeCurated("t1.txt", t1Add, "t1: words to force into tier 1"),
  "t2.txt": writeCurated("t2.txt", t2Add, "t2: words to force into tier 2"),
  "removals.txt": writeCurated("removals.txt", removed, "removals: words to exclude from all tiers"),
};

console.log("base 5-letter valid:", v5.size, "t1:", c5.size);
console.log("current entrelinhas valid:", curValid.size, "answers:", curAnswers.size);
console.log("seeded curated deltas:", counts);
