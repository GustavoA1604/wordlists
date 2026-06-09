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
