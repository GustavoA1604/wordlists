# Sources

Provenance and licensing for the raw inputs in `pt-br/sources/`.

| File                  | Origin                                                                                                                                                 | Feeds                                                                                                               | License                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `finder.js`           | [g-pg/wordle-finder](https://github.com/g-pg/wordle-finder) `src/data/words.js`                                                                        | valid base                                                                                                          | see upstream repo                                                     |
| `omret.json`          | [vhfarias/omret](https://github.com/vhfarias/omret) `database/wordList.json`                                                                           | common base (answer candidates)                                                                                     | see upstream repo                                                     |
| `fserb-icf.txt`       | [fserb/pt-br](https://github.com/fserb/pt-br) `icf`                                                                                                    | candidate queue ranking (`word,score`, lower = more frequent)                                                       | see upstream                                                          |
| `silviotamaso.txt`    | [silviotamaso/PTBR-dic](https://github.com/silviotamaso/PTBR-dic)                                                                                      | candidate queue (curated "used in Brazil" list)                                                                     | see upstream                                                          |
| `ueda-palavras.txt`   | [Ueda PT-BR dictionaries](https://www.ime.usp.br/~pf/dicios/)                                                                                          | PT-dictionary safeguard for the English filter; otherwise NOT merged                                                | see upstream                                                          |
| `ueda-dicio.txt`      | [Ueda PT-BR dictionaries](https://www.ime.usp.br/~pf/dicios/)                                                                                          | PT-dictionary safeguard for the English filter; otherwise NOT merged                                                | see upstream                                                          |
| `morphobr.tsv.gz`     | [LR-POR/MorphoBr](https://github.com/LR-POR/MorphoBr) compiled by `compile-morphobr.js`                                                                | morphological ground truth: form -> lemma/POS/features (drives tiering rules and `dist/lexicon.jsonl`)              | Apache-2.0                                                            |
| `wiktionary.jsonl.gz` | [kaikki.org](https://kaikki.org/ptwiktionary/) Wiktextract dump of [pt.wiktionary.org](https://pt.wiktionary.org), compiled by `compile-wiktionary.js` | definitions: word -> glosses per POS, purely descriptive (`dist/lexicon.jsonl` `d` field); plays no part in tiering | CC-BY-SA (+ GFDL), see [pt.wiktionary.org](https://pt.wiktionary.org) |

### Filter resources (used by `gen-candidates.js`, never added as words)

| File                       | Origin                                                                        | Role                                                              | License      |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------ |
| `english-words.txt`        | [dwyl/english-words](https://github.com/dwyl/english-words) `words_alpha.txt` | flag pure-English words (in English but not in the PT dictionary) | Unlicense    |
| `prenomes-ibge.csv`        | [datasets-br/prenomes](https://github.com/datasets-br/prenomes) (IBGE census) | flag people's first names (above a frequency threshold)           | see upstream |
| `world-cities.csv`         | [datasets/world-cities](https://github.com/datasets/world-cities)             | rescue place names from the English filter                        | see upstream |
| `places-paises.txt`        | [fserb/pt-br](https://github.com/fserb/pt-br) `listas/paises`                 | rescue PT country names                                           | see upstream |
| `places-municipios-br.txt` | [fserb/pt-br](https://github.com/fserb/pt-br) `listas/municipios-br`          | rescue Brazilian municipality names                               | see upstream |

## Notes

- The tier bases: t1 = `omret` + top-5k of `fserb-icf`; t2 = `silviotamaso` +
  top-15k of `fserb-icf`; t3 = `finder` + ranks 15k-20k of `fserb-icf`. On top of
  the bases, the engine expands the paradigms of in-game lemmas using
  `morphobr.tsv.gz` and applies the curated decisions (see README "How tiering
  works").
- Broad sources beyond those slices are NOT auto-merged: no broad source is clean
  enough (brand names and anglicisms by frequency, archaic/obscure words by
  dictionary). New words enter through the review queue (`npm run candidates`)
  and are recorded with `npm run move`.
- The Ueda dictionaries are not merged as words. They serve as the broad
  PT-dictionary safeguard for the English filter in `gen-candidates.js` and as a
  comparison baseline in `analyze.js`.
- Other candidate sources evaluated but not adopted as word sources: fserb-lexico
  (web lexicon, still noisy), AlfredoFilho/Palavras_PT-BR (huge, very noisy).
  Unitex-PB data entered indirectly: MorphoBr (adopted for morphology, not as a
  word source) is built on it.
- Use `npm run analyze` to compare any new source (drop a `*.txt`/`*.js`/`*.json`
  file in `pt-br/_candidates/`) against the current export before adopting it.
