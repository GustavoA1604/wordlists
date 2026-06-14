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
  sources/      raw upstream inputs (committed; see SOURCES.md)
  curated/      hand-maintained overrides (the maintenance surface)
  build.js      pipeline: sources + curation -> dist/
  dist/         generated output, committed (consumers read this; no build needed)
    words.txt   master valid pool, all lengths, normalized, sorted, unique
    common.txt  common/everyday subset (answer candidates), subset of words.txt
    manifest.json  build stats
test/           invariant tests (node --test)
```

## Building

```bash
npm run build    # regenerate pt-br/dist/ from sources + curated overrides
npm test         # check invariants (a-z only, sorted, unique, common ⊆ valid)
```

`dist/` is committed, so consumers that pin this repo as a submodule do not need
to run the build.

## Maintaining the dictionary

Add or remove words by editing the override files in `pt-br/curated/` (one word
per line, `#` for comments), then re-run `npm run build`:

- `valid-additions.txt` - force a word into the valid pool.
- `valid-removals.txt` - force a word out of the valid pool (cascades out of common too).
- `common-additions.txt` - force a word into the common pool (implies valid).
- `common-removals.txt` - drop a word from common only (it stays valid).

Overrides survive source updates: regenerating from upstream never wipes your
manual curation. Words are stored without accents (`a`-`z` only).

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
rest:

- **pure English** (in the English wordlist but not in the Ueda PT dictionary) ->
  set aside. Assimilated loans that are in the PT dictionary (`mouse`, `jeans`) stay.
- **first names** (IBGE prenomes above `--name-min`) -> set aside. Place names are
  not first names, so `texas`/`macau` stay; a place that is also a first name
  (`paris`, `sofia`) is set aside but easy to rescue.
- **place names** (world gazetteer + PT country/municipality lists) rescue foreign
  places from the English filter.
- `silviotamaso` membership rescues a word from either set-aside bucket.

Outputs in `pt-br/review/`:

- `candidates-icf-ranked-5.txt` - the clean queue, most frequent first.
- `setaside-english-5.txt`, `setaside-names-5.txt` - filtered-out words, kept for
  audit (scan them for the occasional real word or wanted place).
- `candidates-5.annotated.tsv` - every candidate with all flags (score, silvio,
  english, pt_dict, name, place, bucket).

Review the top of the clean queue, move keepers into `curated/valid-additions.txt`,
then `npm run build`. Re-running `npm run candidates` shrinks the queue as you curate.
The `pt-br/review/` and `pt-br/_candidates/` dirs are gitignored (regenerated artifacts).

To evaluate a brand-new source, drop a `*.txt` / `*.js` / `*.json` into
`pt-br/_candidates/` and run `npm run analyze` to see how many (and which) words it
would add versus the current export.

## Auditing the verb-conjugation gap

Verbs can be missing some of their conjugations. Two scripts audit that gap (results
go to the gitignored `pt-br/review/`):

```bash
npm run verb-gap                 # local: diff ueda-dicio against the export
npm run verb-gap:network         # network: fetch correct (incl. irregular) forms
```

- `verb-gap` (local) treats the pre-inflected `sources/ueda-dicio.txt` as ground truth
  and lists target-length words it has that the export lacks, annotating names/places
  so verb forms are easy to pick out. For the current 5-letter export this finds
  nothing: every 5-letter dicio word is already valid or in `valid-removals.txt`.
- `verb-gap:network` fetches conjugations from conjugacao.com.br (cached under the
  gitignored `pt-br/_conjcache/`) for verbs whose forms `ueda-dicio` is silent on,
  i.e. exactly where a rule-based generator is unreliable. It then keeps only forms
  missing from both the export and `ueda-dicio`. An audit over the 5-letter export
  confirmed the gap is essentially closed: it surfaced only a handful of genuine but
  obscure forms (the rest was the site mechanically conjugating non-verbs, which
  `ueda-dicio` correctly omits). Use `--len=N` for other lengths if a game ever needs
  non-5-letter words, which is where the real conjugation volume lives.

## Normalization

Every word is NFD-decomposed, stripped of combining accent marks, lowercased, and
kept only if it is purely `a`-`z` (drops spaces, hyphens, digits, proper nouns).
Length is never constrained here; that is a per-game concern.

## Style

No em dashes (`-`) anywhere: user-facing text, comments, or docs. Use a colon,
comma, parentheses, or a period. A spaced hyphen is fine as an inline separator.

## License

Repo code: MIT. Word data is governed by each upstream source's own license; see
`SOURCES.md`.
