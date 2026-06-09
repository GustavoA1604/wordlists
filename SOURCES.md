# Sources

Provenance and licensing for the raw inputs in `pt-br/sources/`.

| File | Origin | Feeds | License |
| --- | --- | --- | --- |
| `finder.js` | [g-pg/wordle-finder](https://github.com/g-pg/wordle-finder) `src/data/words.js` | valid base | see upstream repo |
| `omret.json` | [vhfarias/omret](https://github.com/vhfarias/omret) `database/wordList.json` | common base (answer candidates) | see upstream repo |
| `ueda-palavras.txt` | [Ueda PT-BR dictionaries](https://www.ime.usp.br/~pf/dicios/) | available, NOT yet merged | see upstream |
| `ueda-dicio.txt` | [Ueda PT-BR dictionaries](https://www.ime.usp.br/~pf/dicios/) | available, NOT yet merged | see upstream |

## Notes

- The current `valid` base is `finder` plus the `omret` common words. This
  reproduces the lists entrelinhas shipped before this repo existed (5,584 valid /
  2,016 common at 5 letters).
- The Ueda dictionaries are committed and available via `loadUedaSources()` in
  `lib/sources.js`, but are intentionally NOT merged into the default base: merging
  them roughly doubles the 5-letter pool and would change every consuming game.
  They are the obvious extension point when expanding coverage (e.g. for longer-word
  games), gated behind explicit curation review.
- Future candidate sources (not yet added): fserb/pt-br (frequency scores),
  datasets-br/unitex-pt-br (inflections), OpenSubtitles frequency lists.
