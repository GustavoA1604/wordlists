// Step 2 (network) of closing the verb-conjugation gap: fetch correct conjugations
// (including stem-changing irregulars a rule-based generator cannot produce) from an
// online conjugator, and surface 5-letter forms that are missing from the export AND
// from the local ueda-dicio dictionary.
//
// Source: conjugacao.com.br. Each form is a <span class="f">...</span> (irregular
// forms additionally carry the "irregular" class). Pages are cached under
// pt-br/_conjcache/ (gitignored) so reruns do not refetch; delete a file to refresh.
//
// Target verbs: by default, the verbs whose REGULAR 5-letter forms are missing from
// both dist and ueda-dicio (i.e. exactly where the dictionary is silent and naive
// generation is unreliable). Override with --verbs=<file> (one infinitive per line).
//
// Output (pt-br/review/):
//   verb-network-candidates-${LEN}.txt        flat list of proposed additions
//   verb-network-candidates-${LEN}.annotated.tsv  form, verb, irregular, freq score
//
// Usage:
//   node pt-br/fetch-conjugations.js [--len=5] [--verbs=path] [--limit=N] [--delay=800]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr, readCurated } from "../lib/sources.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const LEN = args.len ? Number(args.len) : 5;
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const DELAY = args.delay ? Number(args.delay) : 800; // ms between live fetches
const isLen = (w) => w.length === LEN;
const src = (f) => join(ptbr, "sources", f);
const cacheDir = join(ptbr, "_conjcache");

function lines(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
function normLines(path) {
  return lines(path).map(normalizeWord).filter(Boolean);
}
function curatedSet(name) {
  return new Set(readCurated(name).map(normalizeWord).filter(Boolean));
}

const valid = new Set(lines(join(ptbr, "dist", "words.txt")));
const removed = curatedSet("valid-removals.txt");
const added = curatedSet("valid-additions.txt");
const decided = new Set([...valid, ...removed, ...added]);
const dicio = new Set(normLines(src("ueda-dicio.txt")));

const score = new Map();
for (const line of lines(src("fserb-icf.txt"))) {
  const [raw, s] = line.split(",");
  const w = normalizeWord(raw);
  if (w && !score.has(w)) score.set(w, parseFloat(s));
}

// Default target verbs: those with a regular 5-letter form missing from dist AND dicio.
function defaultTargets() {
  const ueda = new Set([...normLines(src("ueda-palavras.txt")), ...dicio]);
  const END = {
    ar: [
      "o",
      "as",
      "a",
      "ava",
      "amos",
      "ei",
      "ou",
      "ara",
      "aria",
      "asse",
      "ado",
      "emos",
      "aram",
      "arao",
    ],
    er: [
      "o",
      "es",
      "e",
      "ia",
      "emos",
      "eu",
      "era",
      "eria",
      "esse",
      "ido",
      "eram",
      "erao",
      "erei",
    ],
    ir: [
      "o",
      "es",
      "e",
      "imos",
      "iu",
      "ira",
      "iria",
      "isse",
      "ido",
      "iram",
      "irao",
      "irei",
      "is",
    ],
  };
  const ger = { ar: "ando", er: "endo", ir: "indo" };
  const targets = new Set();
  for (const inf of ueda) {
    if (!/(ar|er|ir)$/.test(inf) || inf.length < 3) continue;
    const c = inf.slice(-2),
      s = inf.slice(0, -2);
    if (!dicio.has(s + ger[c])) continue; // verb test: gerund exists
    for (const e of END[c]) {
      const f = s + e;
      if (
        f.length === LEN &&
        !valid.has(f) &&
        !removed.has(f) &&
        !dicio.has(f)
      ) {
        targets.add(inf);
        break;
      }
    }
  }
  return [...targets].sort();
}

const targets = (
  args.verbs
    ? lines(args.verbs).map(normalizeWord).filter(Boolean)
    : defaultTargets()
).slice(0, LIMIT);

mkdirSync(cacheDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getHtml(verb) {
  const file = join(cacheDir, `${verb}.html`);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const url = `https://www.conjugacao.com.br/verbo-${verb}/`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (wordlists conjugation gap audit)",
        },
      });
      if (res.status === 404) {
        writeFileSync(file, "");
        return "";
      } // not a verb / no page
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

// Every conjugated form: <span class="f ...">FORM</span>. Returns [{raw, irregular}].
function parseForms(html) {
  const out = [];
  const re = /<span class="f([^"]*)">([^<]+)<\/span>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ raw: m[2].trim(), irregular: /\birregular\b/.test(m[1]) });
  }
  return out;
}

const proposals = new Map(); // normalized form -> {verb, irregular, score}
let fetched = 0,
  fromCache = 0,
  withPage = 0;

for (const verb of targets) {
  const cached = existsSync(join(cacheDir, `${verb}.html`));
  const html = await getHtml(verb);
  if (cached) fromCache++;
  else fetched++;
  if (!html) continue;
  withPage++;
  for (const { raw, irregular } of parseForms(html)) {
    const w = normalizeWord(raw);
    if (!w || !isLen(w) || decided.has(w)) continue;
    if (!proposals.has(w)) {
      proposals.set(w, {
        verb,
        irregular,
        score: score.has(w) ? score.get(w) : Infinity,
      });
    }
  }
  if ((fetched + fromCache) % 25 === 0) {
    console.error(
      `  ...${fetched + fromCache}/${targets.length} verbs (${proposals.size} candidates so far)`,
    );
  }
}

const rows = [...proposals.entries()]
  .map(([w, m]) => ({ w, ...m }))
  .sort((a, b) => a.score - b.score || a.w.localeCompare(b.w));

const reviewDir = join(ptbr, "review");
mkdirSync(reviewDir, { recursive: true });
writeFileSync(
  join(reviewDir, `verb-network-candidates-${LEN}.txt`),
  rows.map((r) => r.w).join("\n") + "\n",
);
writeFileSync(
  join(reviewDir, `verb-network-candidates-${LEN}.annotated.tsv`),
  "word\tscore\tirregular\tverb\n" +
    rows
      .map((r) =>
        [
          r.w,
          r.score === Infinity ? "" : r.score.toFixed(4),
          r.irregular ? "y" : "",
          r.verb,
        ].join("\t"),
      )
      .join("\n") +
    "\n",
);

console.log(
  `\nTarget verbs: ${targets.length} (fetched ${fetched}, cached ${fromCache}, with a page ${withPage})`,
);
console.log(
  `New ${LEN}-letter forms missing from both dist and ueda-dicio: ${rows.length}`,
);
console.log(
  `  irregular forms among them: ${rows.filter((r) => r.irregular).length}`,
);
console.log(`  -> review/verb-network-candidates-${LEN}.txt`);
console.log(`\nAll candidates:`);
console.log("  " + rows.map((r) => r.w).join(" "));
