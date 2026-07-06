// One-off maintenance pass, run twice for two related jobs:
//
//   node pt-br/reassign-verb-tiers.js --add=arar
//     Adds a new verb's infinitive and all of its conjugated forms to the
//     dictionary. The infinitive's tier comes from its natural source/frequency
//     membership (t3 if none matches); every conjugated form then follows the
//     same person/imperative split used below.
//
//   node pt-br/reassign-verb-tiers.js --sweep --minlen=6 --maxlen=8
//     Re-tiers the EXISTING conjugated forms of verbs whose infinitive is
//     already valid and minlen-maxlen letters long:
//       - verb currently in t1 or t2: imperative (any person) and 2nd-person
//         exclusive (tu/vos) forms move to t3; every other form moves to t2.
//       - verb currently in t3: every form (any person) moves to t3.
//     The bare infinitive itself is left alone (it is the headword, not a
//     conjugated form).
//
// Ground truth per verb comes from conjugacao.com.br (cached under the
// gitignored pt-br/_conjcache/; delete a file to refetch). Mirrors the
// mood/person parsing in verb-conjugation-audit.js.
//
// Usage: node pt-br/reassign-verb-tiers.js [--add=verb | --sweep] [--minlen=6]
//   [--maxlen=8] [--limit=N] [--delay=800] [--dry-run]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr, readCurated } from "../lib/sources.js";
import { bases } from "./build.js";

const args = Object.fromEntries(
  argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const DRY_RUN = argv.includes("--dry-run");
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const DELAY = args.delay ? Number(args.delay) : 800;
const MINLEN = args.minlen ? Number(args.minlen) : 6;
const MAXLEN = args.maxlen ? Number(args.maxlen) : 8;
const cacheDir = join(ptbr, "_conjcache");

function lines(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// ── curated file read/write (mirrors lint-curated.js) ─────────────────────

const CURATED_FILES = ["t1.txt", "t2.txt", "t3.txt"];
const removals = new Set(readCurated("removals.txt").map(normalizeWord).filter(Boolean));
function parseCurated(name) {
  const raw = readFileSync(join(ptbr, "curated", name), "utf8");
  const raw_lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = raw_lines.find((l) => l.startsWith("#")) ?? "";
  const words = new Set(
    raw_lines.filter((l) => !l.startsWith("#")).map(normalizeWord).filter(Boolean),
  );
  return { header, words };
}
const curated = Object.fromEntries(CURATED_FILES.map((f) => [f, parseCurated(f)]));

function writeCurated() {
  if (DRY_RUN) return;
  for (const f of CURATED_FILES) {
    const { header, words } = curated[f];
    const sorted = [...words].sort();
    writeFileSync(join(ptbr, "curated", f), [header, ...sorted, ""].join("\n"), "utf8");
  }
}

/** Force `word` into exactly `target` ("t1.txt"|"t2.txt"|"t3.txt"), removing any other override. */
function moveTo(word, target) {
  if (removals.has(word)) return; // respect an explicit prior removal decision
  for (const f of CURATED_FILES) {
    if (f === target) curated[f].words.add(word);
    else curated[f].words.delete(word);
  }
}

// ── current effective tier (dist/, i.e. after existing overrides) ─────────

const valid = new Set(lines(join(ptbr, "dist", "words.txt")));
const distTier = new Map();
for (const [file, tier] of [["t1.txt", "t1"], ["t2.txt", "t2"], ["t3.txt", "t3"]]) {
  for (const w of lines(join(ptbr, "dist", file))) distTier.set(w, tier);
}

// ── fetch + parse a verb page (mood/person aware, same as verb-conjugation-audit.js) ─

mkdirSync(cacheDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getHtml(verb) {
  const file = join(cacheDir, `${verb}.html`);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const url = `https://www.conjugacao.com.br/verbo-${verb}/`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (wordlists conjugation gap audit)" },
      });
      if (res.status === 404) {
        writeFileSync(file, "");
        return "";
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      writeFileSync(file, html);
      await sleep(DELAY);
      return html;
    } catch (e) {
      if (attempt === 3) {
        console.error(`  ! ${verb}: ${e.message}`);
        return "";
      }
      await sleep(DELAY * attempt * 2);
    }
  }
  return "";
}

const PRONOUN_RE = /\b(eu|tu|ele|nós|vós|eles|você|vocês)\b/i;
const PERSON_OF = {
  eu: "13", tu: "2", ele: "13", nós: "13", vós: "2", eles: "13",
  você: null, vocês: null, // duplicates of ele/eles; contribute no new info
};

function parseForms(html) {
  const start = html.indexOf('id="conjugacao"');
  const end = html.indexOf("caption-irregular", start);
  if (start < 0) return new Map();
  const block = html.slice(start, end < 0 ? undefined : end);

  const forms = new Map(); // normalized form -> { persons: Set<"2"|"13">, imperative: bool }
  for (const section of block.split('<h3 class="verb-tense verb-tense--title">').slice(1)) {
    const mood = section.match(/^([^<]+)</)?.[1]?.trim();
    const isImperative = mood === "Imperativo";
    for (const rowHtml of section.split(/<\/p>/)) {
      for (const cell of rowHtml.split("<br>")) {
        const formMatch = cell.match(/<span class="f[^"]*">([^<]+)<\/span>/);
        if (!formMatch) continue;
        const form = normalizeWord(formMatch[1]);
        if (!form) continue;
        const plain = cell.replace(/<[^>]+>/g, " ");
        const pronounMatch = plain.match(PRONOUN_RE);
        if (!pronounMatch) continue;
        const person = PERSON_OF[pronounMatch[1].toLowerCase()];
        if (!person) continue;
        if (!forms.has(form)) forms.set(form, { persons: new Set(), imperative: false });
        const entry = forms.get(form);
        entry.persons.add(person);
        if (isImperative) entry.imperative = true;
      }
    }
  }
  return forms;
}

function targetTier(verbTier, info) {
  if (verbTier === "t3") return "t3";
  const isSecondOnly = info.persons.size === 1 && info.persons.has("2");
  return info.imperative || isSecondOnly ? "t3" : "t2";
}

// ── job: --add=verb ─────────────────────────────────────────────────────

async function runAdd(verb) {
  const html = await getHtml(verb);
  if (!html) {
    console.error(`"${verb}" has no conjugation page (not a recognized verb).`);
    return;
  }
  const forms = parseForms(html);
  if (forms.size === 0) {
    console.error(`"${verb}" page had no parseable conjugation table.`);
    return;
  }

  const { t1Base, t2Base, t3Base } = await bases();
  const t1BaseSet = new Set(t1Base);
  const t2BaseSet = new Set(t2Base);
  const verbTier = curated["t1.txt"].words.has(verb) ? "t1"
    : curated["t2.txt"].words.has(verb) ? "t2"
    : curated["t3.txt"].words.has(verb) ? "t3"
    : t1BaseSet.has(verb) ? "t1"
    : t2BaseSet.has(verb) ? "t2"
    : "t3";

  console.log(`"${verb}" -> ${verbTier} (${valid.has(verb) ? "already valid" : "new"})`);
  if (!valid.has(verb)) moveTo(verb, `${verbTier}.txt`);

  let added = 0, skipped = 0;
  for (const [form, info] of forms) {
    if (form === verb) continue;
    if (valid.has(form) || removals.has(form)) {
      // Already a dictionary entry (likely a homograph, e.g. "arara" the bird
      // vs. "arara" the verb form) or explicitly force-excluded - adding a new
      // verb must not retier an existing word or resurrect a removal.
      skipped++;
      continue;
    }
    const target = targetTier(verbTier, info);
    moveTo(form, `${target}.txt`);
    added++;
    console.log(`  ${form} -> ${target} (new)`);
  }
  console.log(`\n${added} new forms added, ${skipped} forms skipped (already valid words).`);
}

// ── job: --sweep ────────────────────────────────────────────────────────

async function runSweep() {
  const candidates = [...valid]
    .filter((w) => w.length >= MINLEN && w.length <= MAXLEN && /(ar|er|ir)$/.test(w))
    .sort()
    .slice(0, LIMIT);
  console.log(`Candidate infinitives (${MINLEN}-${MAXLEN} letters, ar/er/ir): ${candidates.length}`);

  let fetched = 0, fromCache = 0, notVerbs = 0, verbsChecked = 0, moved = 0;
  const moveLog = ["form\tverb\tfrom\tto"];

  for (const verb of candidates) {
    const cached = existsSync(join(cacheDir, `${verb}.html`));
    const html = await getHtml(verb);
    cached ? fromCache++ : fetched++;
    if (!html) { notVerbs++; continue; }
    const forms = parseForms(html);
    if (forms.size === 0) { notVerbs++; continue; }
    verbsChecked++;

    const verbTier = distTier.get(verb);
    if (!verbTier) continue; // shouldn't happen: verb came from `valid`

    for (const [form, info] of forms) {
      if (form === verb) continue;
      if (!valid.has(form)) continue; // only retier existing entries
      const cur = distTier.get(form);
      if (cur === "t1") continue; // already common enough to stand on its own; likely a homograph (e.g. "ajuda" the noun vs. a form of "ajudar")
      const target = targetTier(verbTier, info);
      if (cur === target) continue;
      moveTo(form, `${target}.txt`);
      moved++;
      moveLog.push(`${form}\t${verb}\t${cur}\t${target}`);
    }
    if ((fetched + fromCache) % 40 === 0) {
      console.error(`  ...${fetched + fromCache}/${candidates.length} (fetched ${fetched}, cached ${fromCache}, moved so far ${moved})`);
    }
  }

  console.log(`\nVerbs checked: ${verbsChecked}, not verbs: ${notVerbs}`);
  console.log(`Forms retiered: ${moved}`);
  mkdirSync(join(ptbr, "review"), { recursive: true });
  writeFileSync(join(ptbr, "review", "verb-tier-sweep-moves.tsv"), moveLog.join("\n") + "\n");
  console.log(`-> review/verb-tier-sweep-moves.tsv`);
}

// ── main ────────────────────────────────────────────────────────────────

if (args.add) {
  await runAdd(normalizeWord(args.add));
} else if (argv.includes("--sweep")) {
  await runSweep();
} else {
  console.error("Usage: node pt-br/reassign-verb-tiers.js [--add=verb | --sweep] [--minlen=6] [--maxlen=8] [--limit=N] [--dry-run]");
  process.exit(1);
}

writeCurated();
console.log(DRY_RUN ? "\n(dry-run: curated files not written)" : "\nCurated files updated.");
