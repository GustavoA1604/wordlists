// Loaders for the raw PT-BR sources and the curated override files.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ptbr = join(here, "..", "pt-br");

function readLines(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** A curated override file: one word per line, `#` comments and blanks ignored. */
export function readCurated(name) {
  const lines = readLines(join(ptbr, "curated", name));
  return lines.filter((l) => !l.startsWith("#"));
}

/** Raw words from the broad "valid"-class source (wordle-finder, all lengths). */
export async function loadValidSources() {
  const finderUrl = pathToFileURL(join(ptbr, "sources", "finder.js")).href;
  return (await import(finderUrl)).words;
}

/**
 * The Ueda dictionaries: available in sources/ but NOT merged into the default
 * valid base yet (merging them would roughly double the 5-letter pool and change
 * every consuming game). Exposed for future, opt-in expansion. See SOURCES.md.
 */
export function loadUedaSources() {
  return [
    ...readLines(join(ptbr, "sources", "ueda-palavras.txt")),
    ...readLines(join(ptbr, "sources", "ueda-dicio.txt")),
  ];
}

/** Raw words from the "common"-class source (curated everyday vocabulary). */
export function loadCommonSources() {
  const omret = JSON.parse(
    readFileSync(join(ptbr, "sources", "omret.json"), "utf8"),
  );
  // omret maps normalized -> accented; either side normalizes to the same token.
  return Object.keys(omret);
}

export { ptbr };
