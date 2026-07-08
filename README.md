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
    lexicon.jsonl one line per word: tier, analyses (lemma/POS/features), tags
    manifest.json build stats
test/           invariant tests (node --test)
```

## Building

```bash
npm run build    # regenerate pt-br/dist/ from sources + curated decisions
npm test         # check invariants (a-z only, sorted, tiers exclusive, lexicon consistent)
```

`dist/` is committed, so consumers that pin this repo as a submodule do not need
to run the build.

## How tiering works

Facts and decisions are kept apart:

- **Facts** (morphology) come from [MorphoBr](https://github.com/LR-POR/MorphoBr),
  compiled into `sources/morphobr.tsv.gz`: for each form, its lemma, word class
  (N/V/A/ADV) and features (gender/number, tense/person, degree). Never edited
  by hand.
- **Decisions** live in `curated/` and are recorded at the highest level they
  fit. A row in `lemmas.tsv` covers the whole paradigm: decide the lemma once
  and every conjugation / plural / feminine form follows on the next build.

A lemma whose headword is valid is "in the game": its full paradigm (minus
mechanical diminutives/augmentatives/superlatives) expands into the pool
automatically. Tiers then resolve per word, in precedence order:

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

## Normalization

Every word is NFD-decomposed, stripped of combining accent marks, lowercased, and
kept only if it is purely `a`-`z` (drops spaces, hyphens, digits, proper nouns).
Length is never constrained here; that is a per-game concern for consumers.

## Consumers

- Tier files (`t1/t2/t3/words.txt`) are unchanged in format: entrelinhas and
  enquadrados keep reading them as before.
- `lexicon.jsonl` is for POS-aware consumers (palaxia): one JSON object per
  line, `{"w":"acordo","t":1,"a":[{"l":"acordo","pos":"N","f":["M+SG"],"t":1},
  {"l":"acordar","pos":"V","f":["PRS+1+SG"],"t":2}]}` plus optional `"g"` tags.
  `t` at the top level is the word's best tier; each analysis carries its own.

## Style

No em dashes (`-`) anywhere: user-facing text, comments, or docs. Use a colon,
comma, parentheses, or a period. A spaced hyphen is fine as an inline separator.

## License

Repo code: MIT. Word data is governed by each upstream source's own license; see
`SOURCES.md` (MorphoBr data: Apache-2.0).
