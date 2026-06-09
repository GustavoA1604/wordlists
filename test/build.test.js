import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "../pt-br/build.js";
import { readCurated } from "../lib/sources.js";
import { normalizeWord } from "../lib/normalize.js";

const result = await build();

test("words are plain a-z tokens", () => {
  for (const w of [...result.valid, ...result.common]) {
    assert.match(w, /^[a-z]+$/, `unexpected token: ${w}`);
  }
});

test("lists are sorted and duplicate-free", () => {
  for (const list of [result.valid, result.common]) {
    const sorted = [...list].sort();
    assert.deepEqual(list, sorted);
    assert.equal(new Set(list).size, list.length);
  }
});

test("common is a subset of valid", () => {
  const validSet = new Set(result.valid);
  for (const w of result.common) {
    assert.ok(validSet.has(w), `common word missing from valid: ${w}`);
  }
});

test("curated additions are present, removals are absent", () => {
  const validSet = new Set(result.valid);
  for (const raw of readCurated("valid-additions.txt")) {
    const w = normalizeWord(raw);
    if (w) assert.ok(validSet.has(w), `addition missing: ${w}`);
  }
  for (const raw of readCurated("valid-removals.txt")) {
    const w = normalizeWord(raw);
    if (w) assert.ok(!validSet.has(w), `removal still present: ${w}`);
  }
});
