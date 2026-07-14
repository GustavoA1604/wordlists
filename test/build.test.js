import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "../pt-br/build.js";
import { readCurated } from "../lib/sources.js";
import { readLemmas, readForms } from "../pt-br/engine.js";
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
  for (const w of result.t2)
    assert.ok(!t1Set.has(w), `word in t1 and t2: ${w}`);
  for (const w of result.t3)
    assert.ok(!t1Set.has(w), `word in t1 and t3: ${w}`);
  for (const w of result.t3)
    assert.ok(!t2Set.has(w), `word in t2 and t3: ${w}`);
  assert.equal(t1Set.size + t2Set.size + t3Set.size, result.valid.length);
});

test("words.txt is the union of all tiers", () => {
  const fromTiers = new Set([...result.t1, ...result.t2, ...result.t3]);
  const validSet = new Set(result.valid);
  for (const w of fromTiers)
    assert.ok(validSet.has(w), `tier word missing from valid: ${w}`);
  assert.equal(fromTiers.size, validSet.size);
});

test("lexicon has exactly one line per valid word, tiers consistent", () => {
  assert.equal(result.lexicon.length, result.valid.length);
  const tierOf = new Map();
  for (const [t, list] of [
    [1, result.t1],
    [2, result.t2],
    [3, result.t3],
  ]) {
    for (const w of list) tierOf.set(w, t);
  }
  const seen = new Set();
  for (const line of result.lexicon) {
    const e = JSON.parse(line);
    assert.ok(!seen.has(e.w), `duplicate lexicon entry: ${e.w}`);
    seen.add(e.w);
    assert.equal(e.t, tierOf.get(e.w), `lexicon tier mismatch for ${e.w}`);
    for (const a of e.a ?? []) {
      assert.match(a.l, /^[a-z]+$/, `bad lemma for ${e.w}: ${a.l}`);
      assert.ok(
        ["N", "V", "A", "ADV"].includes(a.pos),
        `bad pos for ${e.w}: ${a.pos}`,
      );
      assert.ok(
        Array.isArray(a.f) && a.f.length > 0,
        `missing feats for ${e.w}`,
      );
    }
  }
});

test("lexicon definitions are well-formed when present", () => {
  for (const line of result.lexicon) {
    const e = JSON.parse(line);
    for (const d of e.d ?? []) {
      assert.ok(
        typeof d.pos === "string" && d.pos.length > 0,
        `missing pos in definition for ${e.w}`,
      );
      assert.ok(
        Array.isArray(d.g) && d.g.length > 0,
        `missing glosses in definition for ${e.w}`,
      );
      for (const g of d.g)
        assert.ok(g.trim().length > 0, `blank gloss for ${e.w}`);
    }
  }
});

test("curated lemma decisions are honored", () => {
  const tierOf = new Map();
  for (const [t, list] of [
    [1, result.t1],
    [2, result.t2],
    [3, result.t3],
  ]) {
    for (const w of list) tierOf.set(w, t);
  }
  const validSet = new Set(result.valid);
  for (const [lemma, rows] of readLemmas()) {
    for (const { tier } of rows) {
      if (tier === "x")
        assert.ok(!validSet.has(lemma), `tier-x lemma still valid: ${lemma}`);
      else
        assert.equal(
          tierOf.get(lemma),
          tier,
          `lemma row not honored: ${lemma}`,
        );
    }
  }
});

test("curated form overrides are honored", () => {
  const tierOf = new Map();
  for (const [t, list] of [
    [1, result.t1],
    [2, result.t2],
    [3, result.t3],
  ]) {
    for (const w of list) tierOf.set(w, t);
  }
  const validSet = new Set(result.valid);
  for (const [form, { tier }] of readForms()) {
    if (tier === "x")
      assert.ok(!validSet.has(form), `tier-x form still valid: ${form}`);
    else
      assert.equal(
        tierOf.get(form),
        tier,
        `form override not honored: ${form}`,
      );
  }
});

test("curated removals are absent from all tiers", () => {
  const validSet = new Set(result.valid);
  for (const raw of readCurated("removals.txt")) {
    const w = normalizeWord(raw);
    if (w) assert.ok(!validSet.has(w), `removal still present: ${w}`);
  }
});
