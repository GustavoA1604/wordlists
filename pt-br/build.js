// PT-BR dictionary build pipeline.
//
// Merges the raw sources, applies the curated overrides, and writes neutral,
// length-agnostic output to dist/. Consumers (e.g. the entrelinhas game) read
// dist/ and apply their own game-specific filtering (length, etc.).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { normalizeAll, normalizeWord, sortUnique } from "../lib/normalize.js";
import {
  ptbr,
  loadValidSources,
  loadCommonSources,
  readCurated,
} from "../lib/sources.js";

function curatedSet(name) {
  return new Set(readCurated(name).map(normalizeWord).filter(Boolean));
}

/**
 * Uncurated, normalized base pools (no overrides applied). Shared by build() and
 * the migration script so both agree on exactly what "base" means.
 *
 * validBase includes commonBase: every common/answer word must also be a valid
 * guess (the answers-subset-of-valid invariant), matching how the original lists
 * were assembled (finder words plus the omret common words).
 */
export async function bases() {
  const commonBase = normalizeAll(loadCommonSources());
  const validBase = sortUnique([
    ...normalizeAll(await loadValidSources()),
    ...commonBase,
  ]);
  return { validBase, commonBase };
}

export async function build() {
  const { validBase, commonBase } = await bases();

  const validAdd = curatedSet("valid-additions.txt");
  const validRemove = curatedSet("valid-removals.txt");
  const commonAdd = curatedSet("common-additions.txt");
  const commonRemove = curatedSet("common-removals.txt");

  const valid = sortUnique(
    [...validBase, ...validAdd].filter((w) => !validRemove.has(w)),
  );
  const validSet = new Set(valid);

  // common must be a subset of valid: intersect enforces it, and valid removals
  // cascade out automatically.
  const common = sortUnique(
    [...commonBase, ...commonAdd]
      .filter((w) => !commonRemove.has(w))
      .filter((w) => validSet.has(w)),
  );

  return {
    valid,
    common,
    stats: {
      validBase: validBase.length,
      commonBase: commonBase.length,
      validAdditions: validAdd.size,
      validRemovals: validRemove.size,
      commonAdditions: commonAdd.size,
      commonRemovals: commonRemove.size,
      valid: valid.length,
      common: common.length,
    },
  };
}

function writeOutput({ valid, common, stats }) {
  const dist = join(ptbr, "dist");
  writeFileSync(join(dist, "words.txt"), valid.join("\n") + "\n");
  writeFileSync(join(dist, "common.txt"), common.join("\n") + "\n");
  // No timestamp: keep manifest deterministic so rebuilds are idempotent.
  writeFileSync(join(dist, "manifest.json"), JSON.stringify(stats, null, 2) + "\n");
}

// Run as a script: build and write dist/.
if (import.meta.url === pathToFileURL(argv[1]).href) {
  const result = await build();
  writeOutput(result);
  console.log("wordlists pt-br built:", result.stats);
}
