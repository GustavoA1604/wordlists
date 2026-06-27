// Generate a frequency-ranked review queue of candidate words to add, with noise
// (pure-English words and people's first names) routed into separate set-aside
// files instead of the main queue.
//
// Pipeline per candidate (new 5-letter words from fserb-icf + silviotamaso, minus
// anything already valid or decided in curated/):
//   - is it a Brazilian first name (IBGE prenomes, above a frequency threshold)?
//     -> set aside as a name. Place names (texas, macau) are NOT in this list, so
//        they stay. silviotamaso membership rescues a name that is also a real word.
//   - is it a pure-English word (in the English wordlist but NOT in a traditional
//     PT dictionary, and not curated)? -> set aside as English. Assimilated loans
//     that are in the PT dictionary (mouse, jeans, bacon) stay.
//   - otherwise -> the clean queue, ranked most-frequent-first.
//
// Approve by moving keepers into curated/valid-additions.txt, then `npm run build`.
//
// Usage: node pt-br/gen-candidates.js [--len=5] [--name-min=1000]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeWord } from "../lib/normalize.js";
import { ptbr, readCurated } from "../lib/sources.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")),
);
const LEN = args.len ? Number(args.len) : 5;
const NAME_MIN = args["name-min"] ? Number(args["name-min"]) : 1000;
const isLen = (w) => w.length === LEN;
const src = (f) => join(ptbr, "sources", f);

function lines(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
function normSet(path, filter = isLen) {
  return new Set(
    lines(path)
      .map(normalizeWord)
      .filter((w) => w && filter(w)),
  );
}
function curatedSet(name) {
  return new Set(readCurated(name).map(normalizeWord).filter(Boolean));
}

// Already-decided words: currently valid (post-curation export) plus anything we
// explicitly added or removed by hand. None of these should reappear in the queue.
const valid = new Set(lines(join(ptbr, "dist", "words.txt")));
const added = curatedSet("valid-additions.txt");
const removed = curatedSet("valid-removals.txt");
const decided = new Set([...valid, ...added, ...removed]);

// icf: "word,score", lower score = more frequent. Keep the best score per word.
const score = new Map();
for (const line of lines(src("fserb-icf.txt"))) {
  const [raw, s] = line.split(",");
  const w = normalizeWord(raw);
  if (w && isLen(w) && !score.has(w)) score.set(w, parseFloat(s));
}

const silvio = normSet(src("silviotamaso.txt"));

// English filter: word is "pure English" if it is in the English wordlist but not in
// a traditional PT dictionary (Ueda). Optional: skipped if the file is absent.
const english = existsSync(src("english-words.txt"))
  ? normSet(src("english-words.txt"))
  : new Set();
const ptDict = english.size
  ? new Set([
      ...normSet(src("ueda-palavras.txt")),
      ...normSet(src("ueda-dicio.txt")),
    ])
  : new Set();

// Place names: rescue foreign places (texas, paris) that are also English words, so
// the English filter does not strip them. Built from a world gazetteer (city, country
// and subcountry/state names) plus PT country and Brazilian municipality lists.
const places = new Set();
// Only add a place when the WHOLE name is a single 5-letter word (normalizeWord
// rejects anything with a space/hyphen). Tokenizing multi-word names would leak
// common English substrings like "green" (Bowling Green) or "queen" (Queen Creek).
function addPlace(field) {
  const n = normalizeWord(field);
  if (n && isLen(n)) places.add(n);
}
if (existsSync(src("world-cities.csv"))) {
  for (const line of lines(src("world-cities.csv")).slice(1)) {
    const c = line.split(",");
    addPlace(c[0]); // city
    addPlace(c[1]); // country
    addPlace(c[2]); // subcountry / state
  }
}
for (const f of ["places-paises.txt", "places-municipios-br.txt"]) {
  if (existsSync(src(f))) for (const line of lines(src(f))) addPlace(line);
}

// People's first names: IBGE prenomes (csv: Name,count1,count2,...). Keep only names
// above NAME_MIN total occurrences, so rare names that are really common words slip
// through to review rather than being set aside.
const names = new Set();
if (existsSync(src("prenomes-ibge.csv"))) {
  for (const line of lines(src("prenomes-ibge.csv")).slice(1)) {
    const cols = line.split(",");
    const w = normalizeWord(cols[0]);
    if (!w || !isLen(w)) continue;
    const total = cols.slice(1).reduce((a, x) => a + (parseInt(x, 10) || 0), 0);
    if (total >= NAME_MIN) names.add(w);
  }
}

const queue = [...new Set([...score.keys(), ...silvio])]
  .filter((w) => !decided.has(w))
  .map((w) => ({
    w,
    score: score.has(w) ? score.get(w) : Infinity,
    silvio: silvio.has(w),
    english: english.has(w),
    ptDict: ptDict.has(w),
    name: names.has(w),
    place: places.has(w),
  }))
  .sort((a, b) => a.score - b.score || a.w.localeCompare(b.w));

// Classify. silviotamaso (curated) rescues from both set-aside buckets; a place name
// rescues from the English bucket (but first names stay filtered even if also a place).
for (const c of queue) {
  if (c.name && !c.silvio) c.bucket = "name";
  else if (c.english && !c.ptDict && !c.silvio && !c.place)
    c.bucket = "english";
  else c.bucket = "clean";
}

const reviewDir = join(ptbr, "review");
mkdirSync(reviewDir, { recursive: true });
const pick = (b) => queue.filter((c) => c.bucket === b).map((c) => c.w);
const cleanScored = queue
  .filter((c) => c.bucket === "clean" && c.score !== Infinity)
  .map((c) => c.w);

writeFileSync(
  join(reviewDir, `candidates-icf-ranked-${LEN}.txt`),
  cleanScored.join("\n") + "\n",
);
writeFileSync(
  join(reviewDir, `candidates-silviotamaso-${LEN}.txt`),
  queue
    .filter((c) => c.bucket === "clean" && c.silvio)
    .map((c) => c.w)
    .join("\n") + "\n",
);
writeFileSync(
  join(reviewDir, `setaside-names-${LEN}.txt`),
  pick("name").join("\n") + "\n",
);
writeFileSync(
  join(reviewDir, `setaside-english-${LEN}.txt`),
  pick("english").join("\n") + "\n",
);
writeFileSync(
  join(reviewDir, `candidates-${LEN}.annotated.tsv`),
  "word\ticf_score\tsilvio\tenglish\tpt_dict\tname\tplace\tbucket\n" +
    queue
      .map((c) =>
        [
          c.w,
          c.score === Infinity ? "" : c.score.toFixed(4),
          c.silvio ? "y" : "",
          c.english ? "y" : "",
          c.ptDict ? "y" : "",
          c.name ? "y" : "",
          c.place ? "y" : "",
          c.bucket,
        ].join("\t"),
      )
      .join("\n") +
    "\n",
);

console.log(
  `Candidate queue (${LEN}-letter). Excluded already-decided: ${valid.size} valid, ${added.size} added, ${removed.size} removed.`,
);
console.log(
  `Filters: english wordlist ${english.size ? "on" : "off"}, names>=${NAME_MIN} (${names.size} ${LEN}-letter names), places rescue (${places.size} ${LEN}-letter place tokens).`,
);
console.log(`  clean queue (ranked):   ${cleanScored.length}`);
console.log(
  `  set aside as names:     ${pick("name").length}  -> review/setaside-names-${LEN}.txt`,
);
console.log(
  `  set aside as english:   ${pick("english").length}  -> review/setaside-english-${LEN}.txt`,
);
console.log(`\nClean queue, top 50 by frequency:`);
console.log("  " + cleanScored.slice(0, 50).join(" "));
