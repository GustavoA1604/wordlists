// PT-BR dictionary build pipeline.
//
// Sources give candidate words and frequency; MorphoBr gives morphology (lemma,
// POS, features); curated/ gives the hand-made decisions (lemmas.tsv, forms.tsv,
// removals.txt). The engine (engine.js) combines them: every in-game lemma's
// paradigm expands into the pool, and each word's tier follows the precedence
// documented at the top of engine.js.
//
// Outputs (dist/, committed, consumers read these without building):
//   t1.txt / t2.txt / t3.txt  mutually exclusive tiers (t1 common/answers,
//                             t2 extended, t3 rare/obscure)
//   words.txt                 the whole valid pool (t1 + t2 + t3)
//   lexicon.jsonl             one line per word: tier + morphological analyses
//                             + curation tags, for POS-aware consumers
//   manifest.json             build stats
//
// Usage: node --max-old-space-size=6000 pt-br/build.js

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { ptbr } from "../lib/sources.js";
import { loadEngine } from "./engine.js";

export async function build() {
  const engine = await loadEngine();
  const pool = engine.pool();

  const t1 = [], t2 = [], t3 = [];
  const lexicon = [];
  for (const w of [...pool].sort()) {
    const { tier, analyses } = engine.resolve(w);
    if (tier !== 1 && tier !== 2 && tier !== 3) continue; // defensive; pool excludes removals
    [null, t1, t2, t3][tier].push(w);

    const entry = { w, t: tier };
    const tags = engine.lemmas.get(w)?.flatMap((r) => r.tags) ?? [];
    if (tags.length) entry.g = [...new Set(tags)];
    if (analyses.length) {
      entry.a = analyses.map(({ lemma, pos, rows, tier: at }) => {
        const a = { l: lemma, pos, f: rows.map((r) => r.feats) };
        if (at !== null) a.t = at;
        const ltags = lemma !== w && engine.lemmas.get(lemma)?.flatMap((r) => r.tags);
        if (ltags && ltags.length) a.g = [...new Set(ltags)];
        return a;
      });
    }
    lexicon.push(JSON.stringify(entry));
  }

  const valid = [...t1, ...t2, ...t3].sort();

  return {
    t1, t2, t3, valid, lexicon,
    stats: {
      curatedLemmas: engine.lemmas.size,
      curatedForms: engine.forms.size,
      removals: engine.removals.size,
      t1: t1.length,
      t2: t2.length,
      t3: t3.length,
      valid: valid.length,
    },
  };
}

function writeOutput({ t1, t2, t3, valid, lexicon, stats }) {
  const dist = join(ptbr, "dist");
  writeFileSync(join(dist, "t1.txt"), t1.join("\n") + "\n");
  writeFileSync(join(dist, "t2.txt"), t2.join("\n") + "\n");
  writeFileSync(join(dist, "t3.txt"), t3.join("\n") + "\n");
  writeFileSync(join(dist, "words.txt"), valid.join("\n") + "\n");
  writeFileSync(join(dist, "lexicon.jsonl"), lexicon.join("\n") + "\n");
  // No timestamp: keep manifest deterministic so rebuilds are idempotent.
  writeFileSync(join(dist, "manifest.json"), JSON.stringify(stats, null, 2) + "\n");
}

// Run as a script: build and write dist/.
if (import.meta.url === pathToFileURL(argv[1]).href) {
  const result = await build();
  writeOutput(result);
  console.log("wordlists pt-br built:", result.stats);
}
