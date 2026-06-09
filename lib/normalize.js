// Shared word-normalization helpers. Language-agnostic, length-agnostic.

const COMBINING_MARKS = /[̀-ͯ]/g;
const ASCII_LETTERS_ONLY = /^[a-z]+$/;

/**
 * Normalize a raw word into a canonical token, or return null if it is not a
 * plain alphabetic word.
 *
 * Steps: NFD decompose, strip combining accent marks, lowercase. The result is
 * kept only if it is made up solely of a-z (so spaces, hyphens, digits,
 * apostrophes and proper-noun artifacts are dropped). Length is NOT constrained
 * here: filtering by length is a game-specific concern for consumers.
 */
export function normalizeWord(raw) {
  if (typeof raw !== "string") return null;
  const word = raw
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim();
  return ASCII_LETTERS_ONLY.test(word) ? word : null;
}

/** Normalize every entry, drop nulls, dedupe, and sort (ASCII code-unit order). */
export function normalizeAll(rawWords) {
  return sortUnique(rawWords.map(normalizeWord).filter((w) => w !== null));
}

/** Dedupe and sort an array of strings in ASCII code-unit order. */
export function sortUnique(words) {
  return [...new Set(words)].sort();
}
