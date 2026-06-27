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

const { validBase, commonBase } = await bases();

const v5 = new Set(validBase.filter((w) => FIVE.test(w)));
const c5 = new Set(commonBase.filter((w) => FIVE.test(w)));

const curValid = parseQuotedWords(join(entrelinhas, "src/data/valid.js"));
const curAnswers = parseQuotedWords(join(entrelinhas, "src/data/answers.js"));

const validAdd = [...curValid].filter((w) => !v5.has(w));
const validRemove = [...v5].filter((w) => !curValid.has(w));
const commonAdd = [...curAnswers].filter((w) => !c5.has(w));
const commonRemove = [...c5].filter((w) => !curAnswers.has(w));

const counts = {
  "valid-additions.txt": writeCurated(
    "valid-additions.txt",
    validAdd,
    "valid-additions: words to force-include in the valid pool",
  ),
  "valid-removals.txt": writeCurated(
    "valid-removals.txt",
    validRemove,
    "valid-removals: words to force-exclude from the valid pool",
  ),
  "common-additions.txt": writeCurated(
    "common-additions.txt",
    commonAdd,
    "common-additions: words to force-include in the common pool (implies valid)",
  ),
  "common-removals.txt": writeCurated(
    "common-removals.txt",
    commonRemove,
    "common-removals: words to drop from the common pool (stay valid)",
  ),
};

console.log("base 5-letter valid:", v5.size, "common:", c5.size);
console.log(
  "current entrelinhas valid:",
  curValid.size,
  "answers:",
  curAnswers.size,
);
console.log("seeded curated deltas:", counts);
