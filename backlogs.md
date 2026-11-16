# Backlog

Important work we have decided is worth doing but have not started. Keep entries short: what, why, and any constraint that shapes the solution. Move finished items to a commit message, not here.

Priority: **P1** next up · **P2** soon · **P3** when there is room.

## Translation and dictionary

- [ ] **P1 · English → German lookup.** Tapping an English word (for example “update”) currently reports “No match”. Build a reverse index from the dictionary’s English glosses (and the starter pack) so an English word offers likely German words, ranked by gloss position and frequency. Detect likely-English tokens (no German match, matches an English gloss) so the card can say “English word — possible German: …”. Offline and deterministic; no new data source needed.
- [ ] **P1 · Grow the dictionary.** The build uses the 15,000 most frequent source words and keeps about 5,900 headwords. Raise the candidate limit, then check size against the compressed budget (about 0.6 MB now). Known gaps: loanwords that Wiktionary lists but the frequency cut missed (for example *Update*), proper nouns, compounds, separable-verb forms (*fange … an*), and multi-word phrases.
- [ ] **P2 · Compound and spelling help.** Split unknown compounds (*Sprachkurs* → *Sprache* + *Kurs*) and suggest the nearest spelling for near-misses, instead of “No match”.
- [ ] **P2 · Better ranking for shared forms.** Some forms list more than one base word (for example *ging* also reaches *untergehen*). Tighten ranking and the build rules, and add a few regression words to the dictionary tests.
- [ ] **P2 · Pronunciation for looked-up words.** Reuse the existing learner-initiated audio approach where a verified recording exists; otherwise the device voice.
- [ ] **P2 · LLM-assisted explanation (opt-in).** For words and phrases the dictionary misses, or to explain a whole sentence in context. See “LLM notes” below before building.

## LLM notes (decision record)

An LLM can cover what a fixed dictionary cannot (idioms, slang, context-dependent meaning, whole-sentence translation), but it conflicts with several project principles, so it should be a clearly labelled, optional fallback, not the default:

- **Privacy.** Chat messages are private between two learners. Never send a conversation or a message automatically. Send only the tapped word or phrase plus the minimum surrounding sentence, only after the learner chooses “Explain with AI”, and say so plainly.
- **Keys and cost.** Call it from the server (never ship a key to the browser). Require a verified account, rate-limit per account, cap input length, and cache results by normalised input so repeat lookups cost nothing.
- **Trust.** Mark the answer as AI-generated and unverified. Never add it to a deck automatically; the learner reviews it first (see “Prefer trustworthy, curated content” in AGENTS.md). Prefer the dictionary whenever it has an answer.
- **Offline and core study.** Core study and the dictionary must keep working with no AI service; failures must not block anything.
- **Open questions.** Which provider and model, monthly cost ceiling, data-retention terms, and whether to show a first-use consent notice.

## Chat

- [ ] **P1 · Unread for new activity.** Corrections, reactions and “Looks good” on your messages should mark the chat as having something new; today only new messages do.
- [ ] **P2 · Per-chat mute.** Silence email notifications for one conversation without turning them all off.
- [ ] **P2 · Daily conversation starter.** A pill above the message box that inserts a prompt based on recent words.
- [ ] **P3 · Pin a message** (a good phrase or a correction) at the top of a chat.
- [ ] **P3 · Weekly recap** such as “12 messages and 4 words together”, with no streak pressure.
- [ ] **P3 · Typing and “seen” indicators**, kept subtle.
- [ ] **P3 · Search beyond 1,000 messages**, or search across all conversations.

## Account and trust

- [ ] **P1 · Delete account.** Let a learner delete their account and server data, with the confirmation dialog and a clear statement of what is removed (chat copies, shared words, reports kept for moderation).
- [ ] **P2 · Moderation tooling.** A way to review reports, with a documented retention period.
- [ ] **P2 · Export my data**, including conversations you took part in.
- [ ] **P3 · Better server error logging.** The generic handler logs only “Request failed.”; log a safe error code and route so failures can be traced.

## Learning

- [ ] **P2 · Turn corrections into practice.** Offer a gentle typed-production check on a corrected sentence a learner saved, scheduled like any other card.
- [ ] **P3 · Words from chat.** Show which saved words came from a conversation and let learners filter by “From chat”.

## Quality and engineering

- [ ] **P1 · Browser-level tests.** The preview tooling has been unreliable, so layout and interaction changes (chat, dialogs, mobile) are only verified by build, lint and unit tests. Add Playwright smoke tests for opening a chat, sending, replying, search and the confirmation dialog.
- [ ] **P2 · Split `CompanionPanel.tsx`.** It is very large. Extract the message row, composer, search panel and sidebar into components with their own state.
- [ ] **P2 · Bundle size.** The main chunk exceeds 500 kB (the starter pack is bundled). Lazy-load the starter pack the way the dictionary is loaded.
- [ ] **P2 · Accessibility pass** on tappable words, popovers and the confirmation dialog with a screen reader and keyboard only.
- [ ] **P3 · Mobile review** of the chat header, composer and dialogs on small and short screens.
