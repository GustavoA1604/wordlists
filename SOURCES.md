# Sources

Provenance and licensing for the raw inputs in `pt-br/sources/`.

| File                | Origin                                                                          | Feeds                                                                | License           |
| ------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------- |
| `finder.js`         | [g-pg/wordle-finder](https://github.com/g-pg/wordle-finder) `src/data/words.js` | valid base                                                           | see upstream repo |
| `omret.json`        | [vhfarias/omret](https://github.com/vhfarias/omret) `database/wordList.json`    | common base (answer candidates)                                      | see upstream repo |
| `fserb-icf.txt`     | [fserb/pt-br](https://github.com/fserb/pt-br) `icf`                             | candidate queue ranking (`word,score`, lower = more frequent)        | see upstream      |
| `silviotamaso.txt`  | [silviotamaso/PTBR-dic](https://github.com/silviotamaso/PTBR-dic)               | candidate queue (curated "used in Brazil" list)                      | see upstream      |
| `ueda-palavras.txt` | [Ueda PT-BR dictionaries](https://www.ime.usp.br/~pf/dicios/)                   | PT-dictionary safeguard for the English filter; otherwise NOT merged | see upstream      |
| `ueda-dicio.txt`    | [Ueda PT-BR dictionaries](https://www.ime.usp.br/~pf/dicios/)                   | PT-dictionary safeguard for the English filter; otherwise NOT merged | see upstream      |
| `morphobr.tsv.gz`   | [LR-POR/MorphoBr](https://github.com/LR-POR/MorphoBr) compiled by `compile-morphobr.js` | morphological ground truth: form -> lemma/POS/features (drives tiering rules and `dist/lexicon.jsonl`) | Apache-2.0        |

### Filter resources (used by `gen-candidates.js`, never added as words)

| File                       | Origin                                                                        | Role                                                              | License      |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------ |
| `english-words.txt`        | [dwyl/english-words](https://github.com/dwyl/english-words) `words_alpha.txt` | flag pure-English words (in English but not in the PT dictionary) | Unlicense    |
| `prenomes-ibge.csv`        | [datasets-br/prenomes](https://github.com/datasets-br/prenomes) (IBGE census) | flag people's first names (above a frequency threshold)           | see upstream |
| `world-cities.csv`         | [datasets/world-cities](https://github.com/datasets/world-cities)             | rescue place names from the English filter                        | see upstream |
| `places-paises.txt`        | [fserb/pt-br](https://github.com/fserb/pt-br) `listas/paises`                 | rescue PT country names                                           | see upstream |
| `places-municipios-br.txt` | [fserb/pt-br](https://github.com/fserb/pt-br) `listas/municipios-br`          | rescue Brazilian municipality names                               | see upstream |

## Notes

- The current `valid` base is `finder` plus the `omret` common words. This
  reproduces the lists entrelinhas shipped before this repo existed (5,584 valid /
  2,016 common at 5 letters).
- `fserb-icf.txt` and `silviotamaso.txt` are NOT merged into the build base. They
  feed the review queue (`npm run candidates`): no broad source is clean enough to
  auto-accept (each carries its own noise: brand names and anglicisms by frequency,
  archaic/obscure words by dictionary). New words enter `valid` only after manual
  review into `curated/valid-additions.txt`.
- The Ueda dictionaries are committed and available via `loadUedaSources()` in
  `lib/sources.js`, but are not wired into anything yet. They are the extension point
  for a strict "is this a real word" game or longer-word coverage.
- Other candidate sources evaluated but not adopted: fserb-lexico (web lexicon, still
  noisy), AlfredoFilho/Palavras_PT-BR (huge, very noisy), datasets-br/unitex-pt-br.
- Use `npm run analyze` to compare any new source (drop a `*.txt`/`*.js`/`*.json`
  file in `pt-br/_candidates/`) against the current export before adopting it.
