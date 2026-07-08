// Explain a word: analyses, tier, and why it landed there.
//
// Usage: npm run word -- acordo [outras palavras...]

import { argv, exit } from "node:process";
import { normalizeWord } from "../lib/normalize.js";
import { loadEngine } from "./engine.js";

const words = argv.slice(2).map(normalizeWord).filter(Boolean);
if (words.length === 0) {
  console.error("Usage: npm run word -- <palavra> [outras...]");
  exit(1);
}

const FEAT_LABELS = {
  N: "substantivo", V: "verbo", A: "adjetivo", ADV: "advérbio",
  M: "masc", F: "fem", SG: "sing", PL: "plural",
  DIM: "diminutivo", AUG: "aumentativo", SUPER: "superlativo",
  PRS: "presente", IMPF: "imperfeito", PRF: "perfeito", PQP: "mais-que-perfeito",
  FUT: "futuro", COND: "condicional", IMP: "imperativo",
  SBJR: "subj. presente", SBJP: "subj. imperfeito", SBJF: "subj. futuro",
  INF: "infinitivo", GRD: "gerúndio", PTPST: "particípio",
  1: "1ª", 2: "2ª", 3: "3ª",
};
const label = (tag) => FEAT_LABELS[tag] ?? tag;
const featsLabel = (f) => (f === "" ? "-" : f.split("+").map(label).join(" "));

const engine = await loadEngine();

for (const w of words) {
  const { tier, why, analyses } = engine.resolve(w);
  const inPool = tier === 1 || tier === 2 || tier === 3;
  console.log(`\n${w}  ->  ${inPool ? `t${tier}` : tier === "x" ? "removida" : "não consta"}  (${why})`);

  const tags = engine.lemmas.get(w)?.flatMap((r) => r.tags) ?? [];
  if (tags.length) console.log(`  tags: ${[...new Set(tags)].join(", ")}`);

  for (const a of analyses) {
    const lt = engine.lemmaTier(a.lemma, a.pos);
    const head =
      a.lemma === w
        ? "headword"
        : `de "${a.lemma}" (${lt === null ? "fora do jogo" : lt === "x" ? "removido" : `t${lt}`})`;
    const contrib = a.tier === null ? "sem efeito" : `-> t${a.tier}`;
    console.log(`  ${label(a.pos).padEnd(12)} ${head.padEnd(28)} ${contrib}`);
    for (const r of a.rows) console.log(`      ${featsLabel(r.feats)}`);
  }
  if (analyses.length === 0) console.log("  (sem análise morfológica no MorphoBr)");
}
console.log();
