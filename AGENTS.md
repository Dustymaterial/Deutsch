# Deutsch Daily Deck — project guidance

## Project purpose

Deutsch Daily Deck is a local-first, mobile-friendly vocabulary companion for a learner studying German through an external course such as the vhs-Lernportal. It helps capture the learner's own selected course vocabulary, organize it by lesson, and practise it between course activities; it is not an official vhs-Lernportal product or a replacement for instruction. Its goal is durable, usable vocabulary—not maximizing taps, streaks, or time in the app.

## Learning philosophy

- Treat active recall and spaced practice as the core learning loop. Typed production and multiple-choice recognition can supplement recall, but must not be presented as equivalent to mastery. Keep mode outcomes distinguishable; recognition and typed production currently schedule correct answers as Hard and misses as Again.
- Teach a useful lexical unit, not an isolated translation. For nouns, preserve and practise article and plural; for every item, prefer accurate, natural example sentences and translations.
- Increase challenge gradually and mix practice types where useful. Avoid overwhelming new-card volume, trick questions, ambiguous distractors, and penalties that discourage honest answers.
- Start with Recall when locally saved reviews are due, otherwise Learn when unseen active words exist; retain the completion screen if neither exists. Never switch modes automatically during a visit as progress syncs or reviews become due.
- Learn mode introduces unseen active words in the main card area through guided discovery, browsing, and saved learning; its view and filters are accessed from the top ellipsis menu. Optional checks and session-only skips do not score, schedule, or consume the daily allowance. Adding a word to reviews schedules its first review for ten minutes later and consumes the shared daily new-word target, with explicit confirmation beyond the target; only an actual answer or rating records a review.
- App settings provide optional, skippable study pauses: by default, 60 seconds after three distinct words added to reviews or completed in any review mode, including repeat loops. Do not count saves, skips, views, or gentle checks; show quiz feedback before starting a pending pause. Persist settings, count, and deadline locally, use wall-clock deadlines across reloads and background tabs, and never change scores or review scheduling. Settings changes reset the count. Keep the allowed values, tests, and README explanation aligned when tuning this heuristic; do not claim the defaults are optimal.
- Give immediate, kind, specific feedback. Explain what was correct and what to revisit; let learners report which detail was difficult.
- Adapt conservatively from repeated evidence. Show why a suggestion was made and keep it optional; do not silently rewrite the curriculum or schedule.
- Let learners set a current level, target level/date, and daily intensity. Use these goals to recommend transparent new-card and review limits, but keep review intervals deterministic and do not imply vocabulary practice alone guarantees CEFR progress.
- Present study-time ranges as broad estimates with a reputable source and clear caveats. Never convert a card quota or streak into a claim of language proficiency.
- Prefer trustworthy, curated content. Imported or generated material must be validated before it becomes study content; label limitations rather than claiming unverified CEFR accuracy.
- Keep third-party vocabulary data separate from app code and preserve its source attribution, license, and any share-alike requirements when filtering or adapting it.
- Prefer verified, attributed external human pronunciation recordings when available, with a German device-voice fallback and a clear unavailable state. Offer playback in Learn and only after revealing or submitting an answer in review modes. Playback must be initiated by the learner; disclose the external request, show the recording's author, source, license, and modification status, and never bundle or app-cache audio. Coverage is currently limited to five verified nouns; do not imply otherwise.
- Let learners organize their own course vocabulary by source, unit, and theme. Do not scrape, reproduce, or claim affiliation with third-party course content; support manual entry and user-prepared imports.
- Respect attention and learner wellbeing: calm interface, short focused sessions, no shame, streak pressure, manipulative rewards, or unsupported claims about learning speed.

## Product and engineering principles

- Evaluate product and UX decisions through engineering, linguistics, and psychology perspectives.
- Keep the card deck as the primary, uncluttered experience. Secondary controls should remain small and purposeful.
- Explain the app's purpose in the first-visit introduction and the About menu without implying it replaces a course or guarantees proficiency. Keep the introduction dismissible and local to the browser.
- Make Learn words and examples, revealed Recall words and examples, and submitted quiz answers available to copy with subtle, accessible icon controls. Keep the text selectable; copying must not reveal or hide an answer, and clipboard failures must be reported.
- Word-level example highlights are a limited, manually verified prototype in Learn and revealed or submitted answers. Match only the exact German and English sentence pair; never guess word alignments for other examples.
- Keep scrollbars hidden inside cards and let Learn and revealed Recall cards expand for longer content.
- Keep Add a word, Tune session, and Goal & pace in anchored panels; outside clicks must not discard unfinished entries or goal edits. Tune session changes apply immediately.
- Keep scheduling deterministic, testable, local, and independent from AI or network services.
- Store progress locally by default. Never require a backend for core study; add sync or a database only for a clear user need and with explicit privacy/security design.
- Preserve saved Learn state through local storage, backups, and optional account sync, independently of review scheduling. A first review must supersede an older saved-learning state even when the save and review occurred on different devices.
- Let learners search reviewed words in the selected study set, inspect recent review details and reset one word or the set. Resetting review progress requires explicit confirmation, affects shared words, and must not let older synced reviews reappear.
- Preserve user data during migrations and imports. Backups must be understandable, validated, and non-destructive by default.
- Maintain accessible keyboard and screen-reader interactions, responsive mobile layouts, reduced-motion support, and offline behavior.
- Show form validation beside its field and keep floating menus aligned without shifting nearby controls. Use the top-right toast for meaningful action feedback, not Learn saves or individual review or quiz responses; do not report failed storage as a successful save, and keep error notices dismissible.
- Keep vocabulary fields and learning signals explicit. Do not infer correctness for granular details from a whole-card rating alone.
- Add focused tests for scheduler transitions, imports, and any learning behavior that changes. Run `npm test`, `npm run lint`, and `npm run build` for relevant changes.
