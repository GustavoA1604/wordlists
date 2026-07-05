// Audits every 3/4/5-letter verb currently in the wordlist and makes sure its full
// conjugation paradigm (all moods/tenses, any resulting word length) is present
// somewhere in the tiers. Missing forms are classified:
//
//   - any Imperativo form (regardless of person)       -> curated/t3.txt
//   - tu / vós (true 2nd person, singular and plural)  -> curated/t3.txt
//   - eu / ele / nós / eles (1st and 3rd person)       -> curated/t2.txt
//
// "você"/"vocês" rows are skipped: they conjugate identically to ele/eles (Brazilian
// Portuguese address form, not a distinct verb form) so they never add new words.
//
// Ground truth per verb comes from conjugacao.com.br (handles irregular stems that a
// rule-based conjugator can't produce). Pages are cached under pt-br/_conjcache/
// (gitignored); delete a file to refetch. A 404 means the candidate isn't a real verb
// and is skipped.
//
// Usage: node pt-br/verb-conjugation-audit.js [--limit=N] [--delay=800]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr } from "../lib/sources.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const DELAY = args.delay ? Number(args.delay) : 800;
const cacheDir = join(ptbr, "_conjcache");
const reviewDir = join(ptbr, "review");

function lines(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

// ── candidate infinitives: 3/4/5-letter words already valid, ending ar/er/ir ──────

const valid = new Set(lines(join(ptbr, "dist", "words.txt")));
const candidates = [...valid]
  .filter((w) => [3, 4, 5].includes(w.length) && /(ar|er|ir)$/.test(w))
  .sort()
  .slice(0, LIMIT);

console.log(`Candidate infinitives (3/4/5 letters, ar/er/ir): ${candidates.length}`);

// ── fetch + cache ──────────────────────────────────────────────────────────────

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

// ── parse a verb page into { form -> Set(person) } ────────────────────────────

const PRONOUN_RE = /\b(eu|tu|ele|nós|vós|eles|você|vocês)\b/i;
const PERSON_OF = {
  eu: "13", tu: "2", ele: "13", nós: "13", vós: "2", eles: "13",
  você: null, vocês: null, // duplicates of ele/eles; contribute no new info
};

// Mood sections are marked by <h3 class="verb-tense verb-tense--title">MOOD</h3>;
// splitting on that marker isolates each mood's cells regardless of the two-column
// layout that packs Imperativo and Infinitivo side by side in the same row.
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
        if (!person) continue; // você/vocês: duplicate of ele/eles, skip
        if (!forms.has(form)) forms.set(form, { persons: new Set(), imperative: false });
        const entry = forms.get(form);
        entry.persons.add(person);
        if (isImperative) entry.imperative = true;
      }
    }
  }
  return forms;
}

// ── main crawl ─────────────────────────────────────────────────────────────────

const t2Missing = new Map(); // form -> Set(verbs)
const t3Missing = new Map();
const notVerbs = [];
const verbsChecked = [];
let fetched = 0, fromCache = 0;

for (const verb of candidates) {
  const cached = existsSync(join(cacheDir, `${verb}.html`));
  const html = await getHtml(verb);
  cached ? fromCache++ : fetched++;
  if (!html) {
    notVerbs.push(verb);
    continue;
  }
  const forms = parseForms(html);
  if (forms.size === 0) {
    notVerbs.push(verb);
    continue;
  }
  verbsChecked.push(verb);
  for (const [form, persons] of forms) {
    if (valid.has(form)) continue; // already present somewhere in the tiers
    // 2nd-person-EXCLUSIVE forms -> t3; anything touched by 1st/3rd -> t2.
    const isSecondOnly = persons.size === 1 && persons.has("2");
    const bucket = isSecondOnly ? t3Missing : t2Missing;
    if (!bucket.has(form)) bucket.set(form, new Set());
    bucket.get(form).add(verb);
  }
  if ((fetched + fromCache) % 40 === 0) {
    console.error(`  ...${fetched + fromCache}/${candidates.length} (fetched ${fetched}, cached ${fromCache})`);
  }
}

console.log(`\nConfirmed verbs: ${verbsChecked.length}`);
console.log(`Not verbs (404 or no table): ${notVerbs.length}`);
console.log(`Missing forms -> t2 (1st/3rd person): ${t2Missing.size}`);
console.log(`Missing forms -> t3 (2nd person only): ${t3Missing.size}`);

mkdirSync(reviewDir, { recursive: true });
function writeReport(name, map) {
  const rows = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  writeFileSync(
    join(reviewDir, name),
    rows.map(([form, verbs]) => `${form}\t${[...verbs].join(",")}`).join("\n") + "\n",
  );
}
writeReport("verb-audit-t2-missing.tsv", t2Missing);
writeReport("verb-audit-t3-missing.tsv", t3Missing);
writeFileSync(join(reviewDir, "verb-audit-not-verbs.txt"), notVerbs.sort().join("\n") + "\n");
writeFileSync(join(reviewDir, "verb-audit-verbs-checked.txt"), verbsChecked.sort().join("\n") + "\n");

console.log(`\n-> review/verb-audit-t2-missing.tsv`);
console.log(`-> review/verb-audit-t3-missing.tsv`);
console.log(`-> review/verb-audit-not-verbs.txt`);
console.log(`-> review/verb-audit-verbs-checked.txt`);
