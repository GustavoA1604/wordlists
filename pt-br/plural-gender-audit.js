// Audits 3-8 letter words for missing plural and masculine/feminine counterparts.
//
// Unlike the verb audit, there's no external inflection API for nouns/adjectives, and
// not every word has a real gender pair (mesa has no masculine counterpart; homem/mulher
// is suppletive). So candidates are generated with regular morphological rules and
// validated against ueda-dicio.txt (a broad pre-inflected dictionary) as ground truth -
// if the generated form isn't a real word, ueda-dicio won't have it and it's dropped.
//
// Gender rule (regular -o/-a plus a few common irregular adjective patterns):
//   -o <-> -a (menino/menina), -or -> -ora (professor/professora),
//   -es -> -esa (frances/francesa, i.e. -ês/-esa with accents stripped),
//   -eu -> -eia or -ia (europeu/europeia, judeu/judia)
//
// Plural rule: regular Portuguese pluralization (vowel+s, r/z/n+es, m->ns, l-endings
// swapped for -is/-eis, -ão handled by trying all three of -oes/-aes/-aos and letting
// the dictionary pick the valid one(s)).
//
// Two passes: (1) gender pairs off the current wordlist, (2) plurals off the current
// wordlist AND any newly-found gender pairs (so e.g. menina's plural is also checked).
//
// Tier for an addition: t1 base -> t2; t2/t3 base -> same tier as the base (mirrors
// the base word's "commonness"). Conflicting proposals for the same word prefer t2.
//
// Usage: node pt-br/plural-gender-audit.js

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr } from "../lib/sources.js";

function lines(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// ── ground truth dictionary (validates a generated candidate is a real word) ────

const dicio = new Set(lines(join(ptbr, "sources", "ueda-dicio.txt")).map(normalizeWord).filter(Boolean));

// ── current wordlist + tier map ─────────────────────────────────────────────────

const valid = new Set(lines(join(ptbr, "dist", "words.txt")));
const tierOf = new Map();
for (const t of ["t1", "t2", "t3"]) {
  for (const w of lines(join(ptbr, "dist", `${t}.txt`))) tierOf.set(w, t);
}

// ── candidate generation ─────────────────────────────────────────────────────────

function pluralCandidates(w) {
  if (/ao$/.test(w)) {
    const stem = w.slice(0, -2);
    return [stem + "oes", stem + "aes", stem + "aos"];
  }
  if (/il$/.test(w)) {
    const stem = w.slice(0, -2);
    return [stem + "is", stem + "eis"];
  }
  if (/[aeo]l$/.test(w) || /ul$/.test(w)) return [w.slice(0, -1) + "is"];
  if (/m$/.test(w)) return [w.slice(0, -1) + "ns"];
  if (/[rz]$/.test(w)) return [w + "es"];
  if (/n$/.test(w)) return [w + "s", w + "es"];
  if (/s$/.test(w)) return [w + "es"];
  if (/[aeiou]$/.test(w)) return [w + "s"];
  return [w + "s"]; // rare consonant endings (loanwords); harmless fallback
}

function genderCandidates(w) {
  const out = [];
  if (/o$/.test(w) && w.length > 1) out.push(w.slice(0, -1) + "a");
  if (/a$/.test(w) && w.length > 1) out.push(w.slice(0, -1) + "o");
  if (/or$/.test(w)) out.push(w + "a");
  if (/es$/.test(w) && w.length > 3) out.push(w + "a"); // -ês -> -esa
  if (/eu$/.test(w)) {
    const stem = w.slice(0, -2);
    out.push(stem + "eia", stem + "ia");
  }
  return out;
}

// tier for a newly-found word, given the tier of the base word that generated it.
function tierForAddition(baseTier) {
  return baseTier === "t1" ? "t2" : baseTier;
}

// ── pass 1: gender pairs ─────────────────────────────────────────────────────────

const candidates = [...valid].filter((w) => w.length >= 3 && w.length <= 8);

const genderFound = new Map(); // word -> { tier, base }
for (const w of candidates) {
  const baseTier = tierOf.get(w);
  if (!baseTier) continue;
  for (const cand of genderCandidates(w)) {
    if (!dicio.has(cand)) continue; // not a real word
    if (valid.has(cand)) continue; // already present, nothing to add
    const proposedTier = tierForAddition(baseTier);
    const existing = genderFound.get(cand);
    if (!existing || (existing.tier === "t3" && proposedTier === "t2")) {
      genderFound.set(cand, { tier: proposedTier, base: w });
    }
  }
}
console.log(`Gender-pair candidates validated + missing: ${genderFound.size}`);

// ── pass 2: plurals, over original candidates + newly-found gender pairs ────────

const pluralBase = new Map(candidates.map((w) => [w, tierOf.get(w)]));
for (const [w, { tier }] of genderFound) pluralBase.set(w, tier);

const pluralFound = new Map(); // word -> { tier, base }
for (const [w, baseTier] of pluralBase) {
  if (!baseTier) continue;
  for (const cand of pluralCandidates(w)) {
    if (!dicio.has(cand)) continue;
    if (valid.has(cand)) continue;
    if (genderFound.has(cand)) continue; // already slated via the gender pass
    const proposedTier = tierForAddition(baseTier);
    const existing = pluralFound.get(cand);
    if (!existing || (existing.tier === "t3" && proposedTier === "t2")) {
      pluralFound.set(cand, { tier: proposedTier, base: w });
    }
  }
}
console.log(`Plural candidates validated + missing: ${pluralFound.size}`);

// ── merge + write review output ──────────────────────────────────────────────────

const all = new Map([...genderFound, ...pluralFound]);
const t2Adds = [...all].filter(([, v]) => v.tier === "t2").map(([w]) => w).sort();
const t3Adds = [...all].filter(([, v]) => v.tier === "t3").map(([w]) => w).sort();
console.log(`Total unique additions: ${all.size} (t2: ${t2Adds.length}, t3: ${t3Adds.length})`);

const reviewDir = join(ptbr, "review");
mkdirSync(reviewDir, { recursive: true });
function writeReport(name, map) {
  const rows = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  writeFileSync(
    join(reviewDir, name),
    rows.map(([w, v]) => `${w}\t${v.tier}\t${v.base}`).join("\n") + "\n",
  );
}
writeReport("plural-gender-audit-gender.tsv", genderFound);
writeReport("plural-gender-audit-plural.tsv", pluralFound);
writeFileSync(join(reviewDir, "plural-gender-audit-t2.txt"), t2Adds.join("\n") + "\n");
writeFileSync(join(reviewDir, "plural-gender-audit-t3.txt"), t3Adds.join("\n") + "\n");
console.log("-> review/plural-gender-audit-{gender,plural}.tsv, plural-gender-audit-{t2,t3}.txt");
