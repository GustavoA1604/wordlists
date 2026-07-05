import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "../pt-br/build.js";
import { readCurated } from "../lib/sources.js";
import { normalizeWord } from "../lib/normalize.js";

const result = await build();

test("words are plain a-z tokens", () => {
  for (const w of [...result.t1, ...result.t2, ...result.t3]) {
    assert.match(w, /^[a-z]+$/, `unexpected token: ${w}`);
  }
});

test("lists are sorted and duplicate-free", () => {
  for (const list of [result.t1, result.t2, result.t3, result.valid]) {
    const sorted = [...list].sort();
    assert.deepEqual(list, sorted);
    assert.equal(new Set(list).size, list.length);
  }
});

test("tiers are mutually exclusive", () => {
  const t1Set = new Set(result.t1);
  const t2Set = new Set(result.t2);
  const t3Set = new Set(result.t3);
  for (const w of result.t2) assert.ok(!t1Set.has(w), `word in t1 and t2: ${w}`);
  for (const w of result.t3) assert.ok(!t1Set.has(w), `word in t1 and t3: ${w}`);
  for (const w of result.t3) assert.ok(!t2Set.has(w), `word in t2 and t3: ${w}`);
  assert.equal(t1Set.size + t2Set.size + t3Set.size, result.valid.length);
});

test("words.txt is the union of all tiers", () => {
  const fromTiers = new Set([...result.t1, ...result.t2, ...result.t3]);
  const validSet = new Set(result.valid);
  for (const w of fromTiers) assert.ok(validSet.has(w), `tier word missing from valid: ${w}`);
  assert.equal(fromTiers.size, validSet.size);
});

test("curated t1 additions land in t1", () => {
  const t1Set = new Set(result.t1);
  for (const raw of readCurated("t1.txt")) {
    const w = normalizeWord(raw);
    if (w) assert.ok(t1Set.has(w), `t1 addition missing from t1: ${w}`);
  }
});

test("curated removals are absent from all tiers", () => {
  const validSet = new Set(result.valid);
  for (const raw of readCurated("removals.txt")) {
    const w = normalizeWord(raw);
    if (w) assert.ok(!validSet.has(w), `removal still present: ${w}`);
  }
});
