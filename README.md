# wordlists

Curated, source-controlled word lists for Portuguese (Brazil) word games. Built
to be reused across multiple games (not limited to 5 letters): the pipeline emits
neutral, length-agnostic output, and each game applies its own filtering.

Currently this repo serves [entrelinhas](https://github.com/) as a git submodule,
but it is structured so other languages can be added under their own folder later.

## Layout

```
lib/            shared helpers (normalize.js, sources.js)
pt-br/
  sources/      raw upstream inputs, incl. morphobr.tsv.gz (see SOURCES.md)
  curated/      hand-maintained decisions (the maintenance surface)
    lemmas.tsv    headword-level: lemma, pos, tier, tags
    forms.tsv     per-form exceptions to the rules (keep small)
    removals.txt  words excluded from the pool entirely
  engine.js     tiering engine: sources + morphology + curation -> tiers
  build.js      pipeline: engine -> dist/
  dist/         generated output, committed (consumers read this; no build needed)
    t1.txt        common/everyday tier (answer candidates)
    t2.txt        extended tier (recognized, less frequent)
    t3.txt        rare tier (obscure conjugations, archaic, technical, polemic)
    words.txt     the whole valid pool (t1+t2+t3), normalized, sorted, unique
    lexicon.jsonl one line per word: tier, analyses (lemma/POS/features), tags,
                  Wiktionary definitions
    manifest.json build stats
test/           invariant tests (node --test)
```

## Building

```bash
npm run build      # regenerate pt-br/dist/ from sources + curated decisions
npm test           # check invariants (a-z only, sorted, tiers exclusive, lexicon consistent)
npm run diff-dist  # what the rebuild actually changed, in plain text
```

`dist/` is committed, so consumers that pin this repo as a submodule do not need
to run the build.

### Reviewing a rebuild (`diff-dist`)

Because `dist/` is committed, `git diff` on it is a 300k-line wall of sorted
words that says nothing about _what changed for a word_. `diff-dist` reads the
old and new `lexicon.jsonl` instead and reports the change per word, grouped:

```
── REMOVIDAS (25) ──
- peneiros     t2   verb: primeira pessoa do singular do presente do indicativo do verbo peneirar
── CAMADA ALTERADA (2) ──
~ rebela       t2 -> t3
── DEFINIÇÃO PERDIDA (414) ──
~ arrancos     t2
    - verb: primeira pessoa do singular do presente do indicativo do verbo arrancar
```

Sections are REMOVIDAS, ADICIONADAS, CAMADA ALTERADA (tier), TAGS ALTERADAS
(`polemic`, `place`, ...), and DEFINIÇÃO PERDIDA / GANHA / ALTERADA, each sorted
by tier then alphabetically. The header carries the t1/t2/t3/total/withDefs
counts with their deltas.

```bash
npm run diff-dist                     # committed dist/ (HEAD) vs working tree
npm run diff-dist -- --base=HEAD~3    # any git revision as the baseline
npm run diff-dist -- --base=old.jsonl # or a lexicon.jsonl saved elsewhere
npm run diff-dist -- --full           # print every section in full
```

The complete report is always written to `pt-br/review/dist-diff.txt` (gitignored,
like the other review queues); only the terminal copy is cut to `--limit` rows
per section (default 25).

## How tiering works

Facts and decisions are kept apart:

- **Facts** (morphology) come from [MorphoBr](https://github.com/LR-POR/MorphoBr),
  compiled into `sources/morphobr.tsv.gz`: for each form, its lemma, word class
  (N/V/A/ADV) and features (gender/number, tense/person, degree). Never edited
  by hand. Its paradigms are generated mechanically, so the loader drops the
  few plural rows whose shape Portuguese cannot produce ("invess" for
  "inveses", "aniis" for "anis"): see `badPlural` in `lib/sources.js`.
- **Decisions** live in `curated/` and are recorded at the highest level they
  fit. A row in `lemmas.tsv` covers the whole paradigm: decide the lemma once
  and every conjugation / plural / feminine form follows on the next build.

A lemma whose headword is valid is "in the game": its full paradigm (minus
mechanical diminutives/augmentatives/superlatives) expands into the pool
automatically. The one exception is the `formonly` tag, for headwords whose
MorphoBr lemma entry is itself an artifact: see "Phantom lemmas" below.

Tiers then resolve per word, in precedence order:

1. `removals.txt` / tier `x` row: excluded.
2. `forms.tsv` override.
3. `lemmas.tsv` headword row.
4. t1 base membership (omret + top-5k frequency): stays t1. Frequency is
   trusted; rules never demote everyday words.
5. Morphology rules, taking the best (lowest) tier across a word's readings:
   - the headword itself gets the lemma's tier;
   - 2nd-person and imperative-only verb forms land in t3;
   - forms of a t3 lemma stay t3;
   - conjugations of verbs below t1 land in t3 unless the form itself is
     frequency-attested (t2 base): regular conjugations of uncommon verbs
     should not become answers;
   - every other inflection gets `max(lemma tier, 2)`.
6. Source membership fallback (t2 base -> t2, else t3).

Homographs get every reading: `acordo` is both a t1 noun and a form of
`acordar`, and `dist/lexicon.jsonl` carries all analyses with their tiers so a
POS-aware game can treat each reading differently.

Tags (`polemic`, `place`, `country`, `abbrev`, `english`, `firstname`, ...) are
recorded on curated rows and exported in the lexicon. They are informational:
the default tier policy lives in `TAG_POLICY` (engine.js), and each game can
re-map them (e.g. exclude `polemic` words entirely, keep `place` words playable).

## Maintaining the dictionary

The two everyday commands:

```bash
npm run word -- corres          # explain: analyses, tier, and why
npm run move -- porra 3 --tag=polemic     # record a decision + retier
npm run move -- corrias 3 --reason="..."  # per-form exception
npm run build                   # regenerate dist/
npm run lint-curated            # well-formedness + redundant-row report
npm run phantoms                # queue of suspect MorphoBr lemmas (see below)
```

`move` records the decision at the right level automatically: headwords (and
words with no analyses) go to `lemmas.tsv` where the whole paradigm follows;
pure inflections go to `forms.tsv` (or `removals.txt` for `x`). Use `--form` to
force a form-level decision for a headword.

File formats (tab-separated, `#` comments):

- `lemmas.tsv`: `lemma  pos  tier  tags`. Tier `1|2|3|x` (`x` = removed), or
  empty when a tag implies it. `pos` narrows a decision to one word class for
  MorphoBr lemmas, or labels a stub (`PROP`, `ABBR`, `INTJ`, `LOAN`, `-`).
- `forms.tsv`: `form  tier  reason`. Exceptions where the rules are wrong for
  one specific form; keep it small.
- `removals.txt`: one word per line, excluded from everything.

### Phantom lemmas (`formonly`)

MorphoBr also over-generates whole _lemmas_, not just the plural rows
`badPlural` drops. Where a verb form is homographic with a noun it invents the
noun: beside the real "peneira" it carries a masculine "peneiro" — in fact the
1sg present of "peneirar" — and that lemma's paradigm hands the pool the
non-word "peneiros". Because the headword string is a perfectly good word, it
passes every source and curation check, and only the rest of the paradigm is
wrong.

Tag such a headword `formonly` in `lemmas.tsv`. The word keeps its tier; its
paradigm simply stops expanding:

```
peneiro	N	2	formonly
```

This cannot be automated — regressive derivation is productive in Portuguese,
so many identically-shaped homographs are real nouns ("envio", "retiro",
"elenco", "arranco") — so it is a report rather than an engine rule:

```bash
npm run phantoms                 # -> pt-br/review/phantom-lemmas.tsv
npm run phantoms -- --max-tier=2 # only the ones a game would actually show
```

It lists nominal lemmas whose headword is also another lemma's inflected form,
that Wiktionary attests no nominal sense for, and whose paradigm contributes at
least one form nothing else in the pipeline attests — with those forms named,
ordered worst-tier first.

The `shape` column flags the two families with a recognizable signature:

- `fem-split` — a real gender pair is _one_ MorphoBr lemma carrying both M and F
  rows ("gato" → gato/gata/gatos/gatas), so a masculine-only lemma sitting
  beside a separate feminine-only lemma of the same stem is the artifact.
- `gerundive` — an `-ndo` lemma that is also some verb's gerund, handed a full
  M/F × SG/PL nominal paradigm ("admirando" → admiranda, admirandas,
  admirandos). Portuguese lexicalizes a few of these ("formando", "doutorando",
  "memorando", "tremendo"); MorphoBr generates them wholesale.

The `dicio` column is the strongest keep signal: a hit means one of the Ueda
dictionaries lists an _inflected_ form of the nominal paradigm — a word the verb
cannot produce, so it is independent evidence that the nominal lemma is real.
Those dictionaries are not part of tiering (the engine only mines them for
`englishNoise`), which is why they are worth consulting here. A miss is weak
evidence: they are incomplete, and miss real words ("crescendos",
"integrandos", "multiplicandos").

## Growing the dictionary (candidate review)

No broad source is clean enough to merge wholesale (each adds its own noise: brand
names and anglicisms by frequency, archaic words by dictionary). Instead, new words
flow through a frequency-ranked review queue with noise filtered into set-aside files:

```bash
npm run candidates                  # writes ranked queues to pt-br/review/ (5-letter)
npm run candidates -- --len=6       # other lengths for future games
npm run candidates -- --name-min=500 # looser name threshold (default 1000)
```

It reads `sources/fserb-icf.txt` (frequency scores) and `sources/silviotamaso.txt`
(curated), drops anything already valid or decided in `curated/`, then classifies the
rest (pure English, first names, place names; see the script header for details).
Review the top of the clean queue, then record keepers with `npm run move -- <word>
<tier>` (a new verb or noun brings its whole paradigm along), and `npm run build`.

To evaluate a brand-new source, drop a `*.txt` / `*.js` / `*.json` into
`pt-br/_candidates/` and run `npm run analyze` to see how many (and which) words it
would add versus the current export.

## Regenerating the MorphoBr snapshot

```bash
git clone --depth 1 https://github.com/LR-POR/MorphoBr /tmp/MorphoBr
npm run compile-morphobr -- --src=/tmp/MorphoBr
```

This rebuilds `sources/morphobr.tsv.gz` (normalized, deduped, clitics skipped).

## Regenerating the Wiktionary snapshot

```bash
curl -LO https://kaikki.org/ptwiktionary/raw-wiktextract-data.jsonl.gz
npm run compile-wiktionary -- --src=raw-wiktextract-data.jsonl.gz
```

This rebuilds `sources/wiktionary.jsonl.gz` (Portuguese-language entries only,
normalized, deduped by word+POS). kaikki.org updates its dump roughly weekly;
rerun this whenever fresher definitions are wanted. Definitions are descriptive
only: a word missing one is never excluded from the pool or retiered.

## Normalization

Every word is NFD-decomposed, stripped of combining accent marks, lowercased, and
kept only if it is purely `a`-`z` (drops spaces, hyphens, digits, proper nouns).
Length is never constrained here; that is a per-game concern for consumers.

## Consumers

- Tier files (`t1/t2/t3/words.txt`) are unchanged in format: entrelinhas and
  enquadrados keep reading them as before.
- `lexicon.jsonl` is for POS-aware and definition-aware consumers (palaxia,
  enquadrados): one JSON object per line,
  `{"w":"acordo","t":1,"a":[{"l":"acordo","pos":"N","f":["M+SG"],"t":1},{"l":"acordar","pos":"V","f":["PRS+1+SG"],"t":2}]}`
  plus optional `"g"` tags. `t` at the top level is the word's best tier; each
  analysis carries its own.
- Optional `"d"` on a lexicon entry carries definitions: an array of
  `{"pos":"noun","g":["gloss one","gloss two"]}`, one item per word class the
  word is attested in on Wiktionary. It prefers the word's own entry (many
  inflected forms have one, e.g. "flexão de X"); otherwise it falls back to its
  lemma's definitions — minus the lemma's own form-of stubs that pin it to one
  slot of a paradigm, which are false for any borrower ("arrancos" used to come
  out as "primeira pessoa do singular ... do verbo arrancar"). Stubs that name a
  base word instead ("feminino de ator", "particípio do verbo credenciar") are
  kept, since the borrower is another form of that same base; see
  `FORM_OF_GLOSS` in `pt-br/build.js`. Coverage tracks tier: ~99% of t1, ~92% of t2, ~78% of
  t3 have a definition (the remainder is mostly mechanically-generated
  MorphoBr forms with no independent headword, e.g. regular `-vel` adjectives).
  Consumers must handle absence.

## Style

No em dashes (`-`) anywhere: user-facing text, comments, or docs. Use a colon,
comma, parentheses, or a period. A spaced hyphen is fine as an inline separator.

## License

Repo code: MIT. Word data is governed by each upstream source's own license; see
`SOURCES.md` (MorphoBr data: Apache-2.0; Wiktionary-derived definitions:
CC-BY-SA, attribution required for redistribution).
