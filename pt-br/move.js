// Record a curation decision: move a word to a tier or remove it.
//
//   npm run move -- <palavra> <1|2|3|x> [--tag=polemic,place] [--reason="..."] [--form]
//
// The decision is recorded at the highest level it fits:
//   - MorphoBr headword (or a word with no analyses) -> curated/lemmas.tsv;
//     the whole paradigm follows on the next build.
//   - pure inflection -> curated/forms.tsv (tier) or curated/removals.txt (x).
//   - --form forces a form-level decision even for a headword.
//
// Follow with `npm run build` to regenerate dist/.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr } from "../lib/sources.js";
import { loadEngine } from "./engine.js";

const flags = Object.fromEntries(
  argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v = true] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);
const positional = argv.slice(2).filter((a) => !a.startsWith("--"));
const word = normalizeWord(positional[0] ?? "");
const tier = positional[1] === "x" ? "x" : Number(positional[1]);
if (!word || !(tier === "x" || tier === 1 || tier === 2 || tier === 3)) {
  console.error('Usage: npm run move -- <palavra> <1|2|3|x> [--tag=a,b] [--reason="..."] [--form]');
  exit(1);
}
const tags = flags.tag ? String(flags.tag).split(",").map((t) => t.trim()).filter(Boolean) : [];
const reason = typeof flags.reason === "string" ? flags.reason : "";

// ── curated file editing (headers preserved, bodies kept sorted) ────────────

function editCurated(name, fn) {
  const path = join(ptbr, "curated", name);
  const raw = existsSync(path) ? readFileSync(path, "utf8") : "";
  const all = raw.split(/\r?\n/);
  const header = [];
  for (const l of all) {
    if (l.trim().startsWith("#")) header.push(l);
    else if (l.trim()) break;
  }
  const body = all.map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const next = fn(body);
  writeFileSync(path, [...header, ...next.sort(), ""].join("\n"), "utf8");
}

const dropWord = (rows) => rows.filter((r) => r.split("\t")[0] !== word && r !== word);

function setLemmaRow() {
  editCurated("lemmas.tsv", (rows) => {
    const existing = rows.find((r) => r.split("\t")[0] === word);
    const oldTags = existing ? (existing.split("\t")[3] ?? "") : "";
    const pos = existing ? existing.split("\t")[1] : "-";
    const merged = [...new Set([...oldTags.split(",").filter(Boolean), ...tags])].join(",");
    return [...dropWord(rows), [word, pos, tier, merged].join("\t")];
  });
  console.log(`curated/lemmas.tsv: ${word} -> ${tier === "x" ? "removida" : `t${tier}`}${tags.length ? ` [${tags}]` : ""}`);
}

function setFormRow() {
  editCurated("forms.tsv", (rows) => [
    ...dropWord(rows),
    [word, tier, reason || "manual"].join("\t"),
  ]);
  console.log(`curated/forms.tsv: ${word} -> t${tier}`);
}

function addRemoval() {
  editCurated("removals.txt", (rows) => [...dropWord(rows), word]);
  console.log(`curated/removals.txt: ${word} removida`);
}

function clearElsewhere({ lemmas = false, forms = false, removals = false }) {
  if (lemmas) editCurated("lemmas.tsv", dropWord);
  if (forms) editCurated("forms.tsv", dropWord);
  if (removals) editCurated("removals.txt", dropWord);
}

// ── decide the level and record ─────────────────────────────────────────────

const engine = await loadEngine();
const before = engine.resolve(word);
const isHeadword = engine.morpho.byLemma.has(word);
const hasAnalyses = before.analyses.length > 0;

if (flags.form || (!isHeadword && hasAnalyses)) {
  // Form-level decision.
  if (tier === "x") {
    clearElsewhere({ forms: true, lemmas: !isHeadword });
    addRemoval();
  } else {
    clearElsewhere({ removals: true });
    setFormRow();
  }
  if (!flags.form) {
    const lemmas = [...new Set(before.analyses.map((a) => `${a.lemma} (${engine.lemmaTier(a.lemma, a.pos) ?? "fora do jogo"})`))];
    console.log(`nota: "${word}" é forma de ${lemmas.join(", ")}; se a decisão vale para o paradigma inteiro, mova o lema.`);
  }
} else {
  // Headword (or residue stub) decision in lemmas.tsv.
  clearElsewhere({ forms: true, removals: true });
  setLemmaRow();
  if (isHeadword && tier !== "x") {
    console.log("o paradigma inteiro segue a nova camada no próximo build.");
  }
}

console.log(`antes: ${before.tier === null ? "não constava" : before.tier === "x" ? "removida" : `t${before.tier}`} (${before.why})`);
console.log("agora rode: npm run build");
