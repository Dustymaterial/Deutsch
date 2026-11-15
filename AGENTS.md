# Deutsch Daily Deck — project guidance

## Project purpose

Deutsch Daily Deck is a local-first, mobile-friendly vocabulary companion for a learner studying German through an external course such as the VHL Lernportal. It helps capture the learner's own selected course vocabulary, organize it by lesson, and practise it between course activities; it is not an official VHL product or a replacement for instruction. Its goal is durable, usable vocabulary—not maximizing taps, streaks, or time in the app.

## Learning philosophy

- Treat active recall and spaced practice as the core learning loop. Typed production and multiple-choice recognition can supplement recall, but must not be presented as equivalent to mastery. Keep mode outcomes distinguishable; recognition and typed production currently schedule correct answers as Hard and misses as Again.
- Teach a useful lexical unit, not an isolated translation. For nouns, preserve and practise article and plural; for every item, prefer accurate, natural example sentences and translations.
- Increase challenge gradually and mix practice types where useful. Avoid overwhelming new-card volume, trick questions, ambiguous distractors, and penalties that discourage honest answers.
- Give immediate, kind, specific feedback. Explain what was correct and what to revisit; let learners report which detail was difficult.
- Adapt conservatively from repeated evidence. Show why a suggestion was made and keep it optional; do not silently rewrite the curriculum or schedule.
- Let learners set a current level, target level/date, and daily intensity. Use these goals to recommend transparent new-card and review limits, but keep review intervals deterministic and do not imply vocabulary practice alone guarantees CEFR progress.
- Present study-time ranges as broad estimates with a reputable source and clear caveats. Never convert a card quota or streak into a claim of language proficiency.
- Prefer trustworthy, curated content. Imported or generated material must be validated before it becomes study content; label limitations rather than claiming unverified CEFR accuracy.
- Keep third-party vocabulary data separate from app code and preserve its source attribution, license, and any share-alike requirements when filtering or adapting it.
- Let learners organize their own course vocabulary by source, unit, and theme. Do not scrape, reproduce, or claim affiliation with third-party course content; support manual entry and user-prepared imports.
- Respect attention and learner wellbeing: calm interface, short focused sessions, no shame, streak pressure, manipulative rewards, or unsupported claims about learning speed.

## Product and engineering principles

- Keep the card deck as the primary, uncluttered experience. Secondary controls should remain small and purposeful.
- Keep scheduling deterministic, testable, local, and independent from AI or network services.
- Store progress locally by default. Never require a backend for core study; add sync or a database only for a clear user need and with explicit privacy/security design.
- Preserve user data during migrations and imports. Backups must be understandable, validated, and non-destructive by default.
- Maintain accessible keyboard and screen-reader interactions, responsive mobile layouts, reduced-motion support, and offline behavior.
- Keep vocabulary fields and learning signals explicit. Do not infer correctness for granular details from a whole-card rating alone.
- Add focused tests for scheduler transitions, imports, and any learning behavior that changes. Run `npm test`, `npm run lint`, and `npm run build` for relevant changes.
