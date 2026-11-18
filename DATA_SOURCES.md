# Vocabulary and audio sources

Application code uses the [MIT License](./LICENSE). The vocabulary and dictionary are separate adapted works distributed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Preserve their attribution and share-alike requirements when redistributing adaptations.

## Starter vocabulary

The 2,593-card Open starter set is a filtered and reformatted subset of [slovymovy/words at revision bbef653dc3737361949403c36c822cda61cff512](https://github.com/slovymovy/words/tree/bbef653dc3737361949403c36c822cda61cff512), based on Wiktionary content processed by [Kaikki.org](https://kaikki.org/) and [Wiktextract](https://github.com/tatuylonen/wiktextract).

The adaptation combines ten topic lists with the first 3,000 unique alphabetic terms considered from the German frequency list, retaining source-labeled A1/A2 senses with English meanings and translated examples. It deduplicates lexical entries, reformats fields for the app, and adds core/topic tags. There are 919 source-labeled A1 and 1,674 A2 cards. Core vocabulary covers 2,171 cards and overlaps the topics: Health, Clothes, Food, Feelings, Family, Nature, Time and numbers, School, Travel and Work.

This is independent supplemental vocabulary, not a vhs-Lernportal or Goethe course list. Source labels, glosses and examples are not independently validated and can contain errors. Upstream requests this academic citation: Tatu Ylonen, “Wiktextract: Wiktionary as Machine-Readable Structured Data,” LREC 2022.

## Dictionary

[src/data/german-dictionary.json](./src/data/german-dictionary.json) adapts German entries from English Wiktionary as extracted by Wiktextract and published by [Kaikki.org](https://kaikki.org/dictionary/German/). The file records its source date, license and modifications. Frequency selection/ranking uses the same pinned slovymovy list.

The adaptation keeps about 22,800 single-word entries at rank 30,000 or better, up to four short glosses, noun article/plural, translated examples where supplied, and roughly 128,000 inflected lookup forms. It removes inflected-form headword entries and obsolete, archaic or historical senses, and trims bracketed clarifications. About one in five entries has an example. Wiktionary content is available under CC BY-SA 4.0 and GFDL; this adapted subset uses CC BY-SA 4.0.

Dictionary glosses are short and context-free, not sentence translations. Unrecorded senses, compounds, names and variants can be missing. The separate dictionary downloads on first use and can then work offline; it is not part of the startup app bundle.

## Pronunciation and examples

Human pronunciation coverage is limited to five verified nouns: Haus, Gesundheit, Wasser, Buch and Familie. Each applicable card links its Wikimedia Commons source, author and CC BY-SA 3.0 license and states that the recording is unchanged. These recordings omit articles. Listen requests the recording directly from Commons, which can see the request; recordings are not bundled or app-cached. Other words use a German device voice when available.

Example word highlights are a limited manually verified prototype for an exact German/English sentence pair. Other examples do not have inferred word alignments. Imported and learner-written content remains the learner's responsibility to check.

For regeneration commands and development setup, see [CONTRIBUTING.md](./CONTRIBUTING.md).
