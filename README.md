# Deutsch Daily Deck

A calm German vocabulary trainer for learners using a course such as the [vhs-Lernportal](https://www.vhs-lernportal.de/). It helps organize a learner's own vocabulary notes by lesson and build **usable recall**, not just familiarity with translations. It complements course instruction; it is not an official vhs-Lernportal product or a replacement for the course.

Studying is a solo activity by default, and learning is easier with company. Verified learners can **invite companions** for private one-to-one chat, shared words, tap-to-translate and gentle sentence corrections. Everything social is optional, consent-based and free of streaks, rankings and notification pressure. Learners can also join or create small **groups**, open spaces for questions and resources. Groups are opt-in, have simple rules and reporting, and stay separate from private chats.

![Deutsch Daily Deck showing a German vocabulary card and account setup](./public/Deck.PNG)

Fresh installs include **2,593 German vocabulary cards**, organized into frequency-ranked core vocabulary and ten topical sets. The source supplies A1/A2 labels (919 A1 and 1,674 A2); these are supplemental, not vhs-Lernportal or Goethe course lists, and the labels are not independently validated. You can add your own course words or import a larger set. Study on this device or optionally create an account to sync your deck and goal across devices.

On your first visit, a brief introduction explains what Deutsch Deck is, how companions work and what it isn't; you can revisit it under **··· → About Deutsch Deck**.
The footer links to the GitHub project and this documentation.

## Start the app

Requirements: Node.js 22.12 or newer.

Local study works without an account server. To enable account creation and cloud sync, copy `.env.example` to `.env` and set `MONGODB_URI` to your full MongoDB Atlas connection string, including username and password, with the database path `/deutsch`. URL-encode special characters in the credentials and put query options after a single `?`. The server explicitly uses only the `deutsch` database, where it creates `users`, `progress`, `relationships`, and `sessions` collections. Use a rotated database user restricted to that database, not one with broad access to other databases. Set `SESSION_SECRET` to a random secret of at least 32 characters (for example, generate one with `openssl rand -base64 32`). The `.env` file is ignored by git and the MongoDB URI is only read by the server, not sent to the browser.

Set `MAILJET_API_KEY`, `MAILJET_SECRET_KEY`, and `SENDER_EMAIL` on the server to send account codes and optional companion request notifications. Verify the sender or domain with Mailjet. Without these settings, existing accounts can still sign in, but new registrations and code requests are unavailable; companion requests remain visible in the app. Mailjet receives the recipient address and email content, including the recipient's avatar and, as applicable, the one-time code or sender's username. Never put credentials in the client or commit them.

Set `MODERATOR_USER_IDS` to a comma-separated list of trusted accounts' MongoDB user IDs to give them the **Moderation** view. Do not use usernames: they can change.

The development command starts both the Vite app and account API:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

If port 3001 is already in use, start the services separately with matching alternatives, for example `PORT=3002 node server/index.js --local` and `DEUTSCH_API_PORT=3002 npx vite`. Vite reads `DEUTSCH_API_PORT` (or `PORT`) from the shell or `.env` to keep its API proxy pointed at the account server.

For production, build the client and run the server with `NODE_ENV=production` and the same database/session environment variables:

```sh
npm run build
npm start
```

To try the production build locally, including the installable/offline app shell, use `npm run build` followed by `npm run preview`.

The production service worker needs a secure context: HTTPS when hosted, or localhost during local development. The first online visit caches the app shell; it cannot provide content that was never downloaded.
The starter vocabulary downloads when needed for a new deck, a starter-pack action, or the companion workspace; a returning learner with a valid saved deck does not need it for startup. Offline use of those features requires the starter pack to have been downloaded and cached previously.

## Deploy on Render

The repository includes a Render Blueprint in `render.yaml`. Create a Render Blueprint instance from this repository and provide a full `MONGODB_URI` whose path names `/deutsch`, plus the Mailjet settings and verified sender address. Use a rotated MongoDB user restricted to the `deutsch` database. Render generates `SESSION_SECRET` automatically. The service also sets `NODE_ENV=production` and trusts Render's HTTPS proxy for secure session cookies.

The Blueprint builds with `npm ci --include=dev && npm run build`, starts with `npm start`, and checks `/api/health`. Keep database credentials and secrets in Render's environment settings, never in the repository. Account creation and cloud sync require valid MongoDB settings; local study still works without them.

## License

The application code is licensed under the MIT License; see [`LICENSE`](./LICENSE). The bundled starter vocabulary data and the tap-to-translate dictionary are separate works licensed under CC BY-SA 4.0, as described above.

## How to study

On opening the app, Recall starts when locally saved reviews are due; otherwise, Learn opens if there are unseen words. If neither is available, the completion screen shows when to return. You can choose another mode at any time, and syncing or new reviews becoming due won't switch your current mode.

### Study pauses

By default, the app offers a 60-second pause after three distinct words are added to reviews in Learn or completed in Recall, Choose, or Produce, including the optional repeat loop. A word counts only once between pauses; viewing, saving, skipping, and gentle checks do not count. Quiz feedback stays visible until you continue, then the pause begins. A bar shows the remaining time. You can skip any pause, and the same activity resumes without changing scores or review schedules.

Open **··· → App settings** to turn pauses off or choose a frequency of 3, 5, or 10 words and a duration of 30 seconds, 60 seconds, or 2 minutes. Changing settings resets the current count. Settings, count, and any active pause are stored on this device, not synced or included in deck backups. The timer uses an end timestamp, so time away from the tab counts; on return or reload it resumes or finishes according to the clock. A reload during a pause restores the study mode, although the exact card and Learn filters may change. If a reload interrupts quiz feedback, the pending pause starts on reopening. Storage errors are reported.

These intervals are adjustable starting points, not scientifically established optima. To refine the behavior, change the allowed values and default in `src/studyPause.ts` and the matching App settings choices, update the tests and this explanation, and preserve the distinction between pause timing and review scheduling.

### Your activity

The completion screen shows the last 12 weeks; open **··· → Your activity** for 53 weeks and select a day for its breakdown. Each distinct word counts once per local calendar day when added to reviews or reviewed, including repeat practice. The added and reviewed figures can overlap. Saving, skipping, viewing, and gentle checks do not count. Activity reflects participation, not mastery.

Daily activity stays with each word, survives review resets, and is included in deck backups and optional account sync. Importing a backup merges activity for matching card IDs without overwriting existing cards. Available older reviews and scheduled additions are reconstructed from saved history, but older activity may be incomplete, especially after resets or repeat practice. Previously reconstructed dates use the device's current time zone; newly recorded days keep the local day on which they occurred.

In **··· → Tune session**, open **View reviewed words** to search the selected set, inspect recent reviews and the next review time, or reset an individual word. You can also reset review progress for the entire selected set. After confirmation, affected words become new again and their review history, scores, and schedules are erased. Words shared with other sets are reset there too; vocabulary content remains. Download a backup first if you want to keep a copy of the old history.

### Learn unfamiliar words

Select **Learn** (or **Learn new words** when the session is complete) to explore unseen active cards before reviewing them. Open **··· → Learn settings** to choose Guided, Browse, or Continue learning and filter by topic or level. Each card shows its meaning, example, and noun details where available. The optional gentle multiple-choice check hides the word until you answer and gives feedback without scoring or scheduling. Skip excludes a word from Guided for this Learn session.

**Save** bookmarks a word in **Continue learning** without scheduling it, recording an answer, counting toward your daily new-word target, or adding activity. It stays on this device and syncs with your account when signed in. Saving does not exclude it from the new cards in other study modes; reviewing it there removes it from Continue learning. If there is no other saved word to move to, **Next word** lets you know and offers Guided or Browse instead. Topic and level filters still apply.

Use **Previous** to revisit words seen in this Learn session; **Next word** retraces that path before continuing. Skipped words remain excluded from Guided unless revisited through the path. Words already added to reviews are shown read-only, with copy and Listen still available. Revisiting does not change review schedules, scores, or pause counts. History resets when you change the learning view or filters, or leave Learn.

Choose **Add to reviews** when ready. The word is due in 10 minutes and joins the review queue; if you leave, it remains due when you return. It is removed from Continue learning, counts toward the shared daily new-word target and activity, but does not record an answer or score. If the target is complete, you can explicitly add the word anyway. The first review is recorded when you submit an answer or rating.

Use the copy icon beside a German word or example. In Recall, these are available after revealing the answer; in Choose and Produce, the answer can be copied after submission. Noun words include their article.

In Learn and after revealing or submitting an answer, one starter example offers a trial of word-by-word highlights: select an underlined German word to highlight its English match. Other examples remain unchanged until their matches are verified.

**Listen** is available in Learn and after an answer is revealed or submitted. It uses a human recording for a small, verified set of words (Haus, Gesundheit, Wasser, Buch, and Familie); these recordings speak the word without its article. On clicking Listen, the browser requests the recording directly from Wikimedia Commons, which can see the request. The source, author, and CC BY-SA 3.0 license are linked on each applicable card; recordings are unchanged. The app does not bundle, download for offline use, or app-cache them. For other words, or if playback fails, it uses an available German device voice. Device voice availability and connectivity requirements depend on the browser and device; if unavailable, the app says so.

### Recall

1. **Look at the prompt before revealing it.** For nouns, the article is hidden so you can retrieve it rather than merely reread it. Try to recall the plural and meaning too.
2. **Reveal the answer** to check the noun article, plural, meaning, and example sentence with translation. Verb cards show their meaning and an example.
3. If useful, open **“Missed a detail?”** and mark whether the article, plural, meaning, or example was difficult. This is optional and helps the app notice repeated patterns; it does not silently change your schedule.
4. Choose how recall felt:
   - **Again** means you could not retrieve it; the card returns in about 10 minutes.
   - **Hard** means you got it with effort.
   - **Good** means you recalled it normally.
   - **Easy** means it came quickly.

   Each rating button previews the next interval. Be honest rather than choosing a higher rating to clear cards faster.
5. Work through the due cards and the new-card allowance for your selected intensity. Due reviews come first; future cards are not brought forward just to fill the set. Your daily new-card allowance is shared across study sets and sessions.

### Produce and Choose modes

Use **Produce** to see an English meaning and type the German word or phrase from memory. Include the article for nouns. Answers ignore case, repeated spaces, and punctuation at the edges, but require the saved German spelling; unrecorded synonyms are not automatically accepted. It gives the saved form and example as feedback and keeps a separate production score. Correct typed answers are scheduled as Hard; misses are Again.

Use **Choose** to practise recognition: select the German word (including the article for nouns) from four options. It gives immediate feedback, reveals the example, and keeps a separate cumulative recognition score.

Correct choices are recorded as **Hard**, not Good: options provide cues, so a correct selection is easier than producing the answer unaided. A wrong choice is recorded as **Again** and returns sooner. Recognition, typed production, and self-rated recall remain distinguishable in saved review history; none alone proves language mastery. Distractors prefer the current study set, matching word type and level when possible. If that set is too small, the app clearly notes that some options come from other study sets; it only disables the quiz when the full deck still lacks enough distinct choices.

### Built-in starter topics

The **Open starter** study set has 2,593 deduplicated cards: frequency-ranked core vocabulary plus Health, Clothes, Food, Feelings, Family, Nature, Time and numbers, School, Travel, and Work. The core tag covers 2,171 cards; topic tags overlap it. Open **··· → Tune session** to choose a study set, view progress, adjust the goal, or narrow by source-supplied A1/A2 labels. These themes are independent vocabulary practice; they do not represent vhs-Lernportal lesson content. Add your own lesson tags to keep course-specific words separate. Fresh installs start with this pack. Existing saved decks are not replaced; use **··· → Add open starter words** to add it without losing review history. Duplicate cards are skipped.

The starter data is a filtered and reformatted subset of [slovymovy/words at the pinned source revision](https://github.com/slovymovy/words/tree/bbef653dc3737361949403c36c822cda61cff512), based on Wiktionary content processed by [Kaikki.org](https://kaikki.org/) and [Wiktextract](https://github.com/tatuylonen/wiktextract). In addition to ten topic lists, the generator considers the first 3,000 unique alphabetic terms in the source German frequency list and keeps only source-labeled A1/A2 senses with English meanings and translated examples. The upstream data is licensed **CC BY-SA 4.0**; this adapted vocabulary subset is distributed under the same license. The code and the data have separate licensing. Source attribution and the license are in [the source repository](https://github.com/slovymovy/words) and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Its labels and translations can contain errors, so check important items against your course or a trusted dictionary. For academic citation, the upstream project requests: Tatu Ylonen, “Wiktextract: Wiktionary as Machine-Readable Structured Data,” LREC 2022.

The tap-to-translate dictionary (`src/data/german-dictionary.json`) is generated by `npm run data:dictionary` from the German entries of English Wiktionary as extracted by [Wiktextract](https://github.com/tatuylonen/wiktextract) and published by [Kaikki.org](https://kaikki.org/dictionary/German/) (the file used is dated in the dictionary's `sourceDate` field). Word frequency, used only to choose which words to keep and to rank them, comes from the same pinned [slovymovy/words frequency list](https://github.com/slovymovy/words/tree/bbef653dc3737361949403c36c822cda61cff512) as the starter data. The dictionary keeps about 22,800 single-word entries at frequency rank 30,000 or better, each with up to four short English glosses, a noun's main article and plural, an example sentence with translation where Wiktionary has one (about one in five), and single-word inflected forms. Inflected-form entries and obsolete, archaic and historical senses are left out, and bracketed clarifications are trimmed from glosses. The build downloads about 100 MB (1.1 GB uncompressed) once and caches it in a temporary folder; `DICTIONARY_MAX_RANK` adjusts how many words are kept. Wiktionary content is licensed **CC BY-SA 4.0** (and GFDL); this adapted subset is distributed under CC BY-SA 4.0 and carries its source and license in the file. Glosses can be wrong or incomplete for a given context, so check important items against your course or a trusted dictionary.

## Review scheduling (for contributors)

The rules live in [`src/scheduler.ts`](./src/scheduler.ts). The scheduler is a deterministic, SM-2-inspired heuristic: it uses the card’s previous interval, ease factor, repetition count, lapses, and the learner’s result to choose the next due time. It is not AI/ML, FSRS, or a model of measured memory strength, and its intervals have not been tuned to guarantee retention or mastery.

New cards start with interval `0`, zero repetitions and lapses, and ease `2.5`. After a response, the scheduler applies these rules (rounding interval-day calculations to the nearest whole day):

| Rating | Next interval | State change |
| --- | --- | --- |
| **Again** | 10 minutes | Reset repetitions to `0`; add a lapse and an incorrect response; reduce ease by `0.2`, with a floor of `1.3`. |
| **Hard** | `1` day on the first success; otherwise `max(1, round(previous interval × 1.2))` | Add a repetition and correct response; reduce ease by `0.1`, floor `1.3`. |
| **Good** | `1` day on the first success; otherwise `max(1, round(previous interval × previous ease))` | Add a repetition and correct response; increase ease by `0.05`, capped at `3`. |
| **Easy** | `3` days on the first success; otherwise `max(2, round(previous interval × previous ease × 1.4))` | Add a repetition and correct response; increase ease by `0.1`, capped at `3`. |

Intervals of one or more days are added using local calendar dates. Each scheduled response appends a history event with its timestamp, rating, resulting interval/ease, mode, and any optional “Missed a detail?” fields. Recall uses the learner’s rating. A correct **Choose** or **Produce** response is scheduled as **Hard**; an incorrect answer is **Again**. Those modes are recorded distinctly, and quiz correctness is stored separately from self-rated recall.

Session selection takes active cards already due first, ordered by oldest due time (then more lapses, then oldest review); it then adds unseen cards up to the session and daily limits. The new-card allowance is shared across study sets and counts each card’s first review event once on the local calendar day. The optional “continue beyond today’s target” action only bypasses the limit for the current app visit/day; it does not change a card’s schedule. “Review today’s words again” is a practice-only loop: it does not append history, affect quiz scores, or reschedule cards.

The weak-pattern notice is another deterministic heuristic, not automatic adaptation: it considers active-card review history and optional self-reported difficulty flags. A field is surfaced only after at least five observations, three flags across at least two cards, and a flag rate of 35% or more; the highest flag rate wins. It informs the learner but does not change future prompts or intervals.

## Set a goal and daily pace

Open **Goal & pace** to set your current CEFR level, target level, target date, and vocabulary intensity. Save changes with **Save goal**. The editable default is an intensive B1 goal about 90 days away; choose your actual starting level and timeline rather than treating that example as a prediction.

| Pace | New cards per day | Due reviews per set | Approximate planning time |
| --- | ---: | ---: | ---: |
| Steady | Up to 5 | Up to 30 | 15 minutes |
| Focused | Up to 10 | Up to 50 | 30 minutes |
| Intensive | Up to 15 | Up to 80 | 50 minutes |

These are adjustable daily new-card ceilings, not required quotas; reviews of cards already learned remain available, and a small deck may not have enough new cards to fill the limit. Due reviews are prioritized within each set. The goal date and CEFR levels show a broad planning estimate based on Goethe-Institut guided-course hour ranges. The ranges vary substantially and are only a rough signal; they do not account for your previous study, aptitude, or independent practice. A B1 goal includes listening, reading, speaking, and writing. Vocabulary cards support those skills but cannot replace them or promise a CEFR result. Read the [Goethe-Institut's course-hour guidance](https://www.goethe.de/ins/gb/en/sta/lon/kur/faq.html).

There is no universal best number of new words per day. A practical start is **5–10 new cards daily** with honest retrieval and due reviews; for an intensive plan, try **10–15** only if you can keep up with reviews and still use the vocabulary in listening, reading, speaking, and writing. Reduce new cards if your due queue grows or recall quality drops. Research supports spaced practice for second-language learning, but study design and retention goals affect results; a card count alone is not a measure of proficiency. See the [second-language spacing meta-analysis](https://doi.org/10.1111/lang.12479).

## Add a word in the app

Select **Add a word** in the top bar. If a tag-based study set is selected, its tag is prefilled so new words stay with that lesson. Provide:

- The German word or phrase (enter a noun without its article; choose the article separately).
- The type and A1/A2 level.
- An English meaning.
- A short natural German example and its English translation.
- For nouns, the article is required; add the plural when known.
- Course and lesson tags separated by `|`, for example `vhs-Lernportal|Lektion 2|Essen`.

Prefer one clear, common meaning per card. If a word has several unrelated meanings, make separate cards with distinct examples. Keep example sentences short and grammatical. Do not label a word A1/A2 unless you have checked a reliable course or vocabulary source.

## Prepare and import a vocabulary set

Open the **··· deck menu → Get spreadsheet template** or **Get JSON template** (or download the [CSV template](./public/deck-template.csv) or [JSON template](./public/deck-template.json) directly). Add your own selected words from a vhs-Lernportal lesson, with the lesson recorded in `tags`, then choose **··· → Import vocabulary or backup**. The app does not log in to, scrape, or copy material from the vhs-Lernportal.

### Spreadsheet / CSV

The CSV header must include these columns:

| Column | Required? | What to enter |
| --- | --- | --- |
| `word` | Yes | German word without its article for nouns, or a phrase |
| `category` | Yes | `noun`, `verb`, `adjective`, `adverb`, `numeral`, or `phrase` |
| `article` | For nouns | Exactly `der`, `die`, or `das`; leave blank for other types |
| `meaning` | Yes | A concise English meaning |
| `example` | Yes | A natural German sentence |
| `plural` | No | The complete plural form, e.g. `die Wohnungen` |
| `translation` | No | English translation of the example |
| `level` | No | `A1` or `A2`; defaults to `A1` |
| `tags` | No | Optional tags separated by `|`, e.g. `vhs-Lernportal|Lektion 2|Essen` |

You may reorder columns, but keep the header names. Save/export as **CSV UTF-8**. A spreadsheet should quote cells containing commas or line breaks; standard doubled quotes inside a quoted cell are supported. Keep one vocabulary item per row.

Small example:

```csv
word,category,article,meaning,plural,example,translation,level,tags
Wohnung,noun,die,apartment,die Wohnungen,"Die Wohnung ist sehr schön.","The apartment is very beautiful.",A1,home|housing
verstehen,verb,,to understand,,"Ich verstehe das Problem nicht.","I do not understand the problem.",A2,communication
```

### JSON

The downloadable JSON template shows the complete supported shape. A simple file can look like:

```json
{
  "format": "deutsch-vocabulary",
  "version": 1,
  "cards": [
    {
      "word": "Wohnung",
      "category": "noun",
      "article": "die",
      "meaning": "apartment",
      "plural": "die Wohnungen",
      "example": "Die Wohnung ist sehr schön.",
      "translation": "The apartment is very beautiful.",
      "level": "A1",
      "tags": ["home", "housing"]
    }
  ]
}
```

Each entry needs `word`, `category`, `meaning`, and `example`; nouns also need `article`. `plural`, `translation`, `level`, and `tags` are optional. `tags` is a JSON array of strings. Put the course and lesson in separate tags (for example `["vhs-Lernportal", "Lektion 2"]`); the **Study set** selector can then practise all tagged words or one lesson at a time. JSON files may also be a bare array of these entries.

### What import does

- **Vocabulary imports start fresh:** imported words receive new review state and begin as unseen cards.
- **Backups preserve progress:** **Download backup** exports scheduler state and review history. Importing that file restores only cards not already present.
- **Import is additive:** existing cards are never overwritten. Identical words (same type, article, prompt, and meaning) and repeated IDs are skipped.
- Newly imported words appear in the next study set, not in the middle of the current one.
- An invalid file is rejected with a message; it does not replace your deck.

Use the JSON backup to move your deck manually between browser profiles or devices. If signed in, local changes are also synced to your account.

## Keep vocabulary useful

- Include the article with every noun and the plural when you can verify it.
- Use the exact German spelling, including umlauts (`ä`, `ö`, `ü`) and `ß`.
- Prefer a natural sentence over an artificial sentence built just to contain the word.
- Give a concise translation of the example, not another unrelated definition.
- Use consistent tags for course and lesson grouping (for example `vhs-Lernportal`, `Lektion 2`) plus themes such as `food` or `travel`. Open **··· → Tune session** to select a tag and limit the session; the daily new-card quota is shared across the whole deck.
- Check imported material for accuracy. The app does not independently verify translations, grammar, sources, or CEFR levels.

## Learning companions

Companions are optional and need a verified, signed-in account and a connection to the account service; individual study still works offline and never depends on them. Open the companion workspace from the pink chat button on the deck and in Learn, or from **Account → Learning companions**. The workspace replaces the study content; on a phone it is a single column, and the browser or device **Back** button closes an open chat before leaving the workspace. Companions see only usernames, avatars, shared vocabulary, received-word notes, and the messages in their private conversation, never email addresses or study progress.

### Connecting

- Search for an exact username (case-insensitive) and send a request. Incoming and sent requests are shown separately; the other learner can accept or decline, and you can cancel a sent request or remove a companion.
- Blocking ends the connection and prevents requests or chat in either direction; unblocking does not restore it. Once unblocked, learners can send a new request without a waiting period.
- You can send one gentle, manual reminder per companion per 24 hours. It appears in their panel until acknowledged and is never scheduled automatically.

### Chatting

- Messages are private 1:1 plain text, up to 2,000 characters, and refresh automatically while a conversation is open (background tabs pause refresh). Opening a conversation shows its header immediately, then starts at its newest message. Recently opened private and group chats can show a saved copy while they update; message controls wait for the refresh. A first-ever open still requires the network. Chat messages are not emailed.
- Open chats use an authenticated server-sent event connection to receive refresh hints from a MongoDB replica set or Atlas change stream. Each app server shares one database stream across its connected chats; sessions and chat access are checked again before each hint. The connection retries after a failure, and five-second polling remains the fallback. Proxies must allow long-lived event streams. This is not durable replay: a reconnect refreshes the latest page, while changes to older loaded pages and some deletions may remain stale until reopened. Latency and capacity targets have not yet been verified on real devices or under production load.
- **Saved chats on this device** are enabled by default to speed up reopening. The browser stores up to 50 recent messages for each of 20 private and 20 group conversations per account, and does not display saved pages older than 24 hours. Old pages may remain in browser storage until overwritten or cleared. Saved content may briefly be stale, including content later removed or access later revoked; opening a chat rechecks it with the server and clears the displayed copy if the initial check fails. The workspace and directory still require a network connection. In companion tools, turn off **Save recent chats on this device** on a shared device to clear these copies; signing out or switching accounts also clears that account's copies. Browser storage errors are shown, and clearing browser site data removes all saved copies. These copies are not encrypted against other people using the same browser profile.
- For verified accounts, the community interface and directories are prefetched after sign-in. A short-lived, account-scoped in-memory directory makes reopening faster while the server refreshes it; directory previews and counts can briefly be stale. Signing out or changing accounts clears it. The first open can still require the network if prefetching has not finished, and loading failures are reported. The starter vocabulary for message lookup is downloaded when a conversation opens, rather than delaying the workspace.
- Device Back closes the account menu before going back through an open chat and the companion workspace.
- Device Back also dismisses the add-word, session, goal, activity, app settings, About, and Learn settings panels. Other menus and study modes do not yet all have Back handling.
- **Reply** to a message; the reply shows a quote of the original, color-coded per replied-to message. **React** with one of five emoji; each learner has at most one reaction per message and can remove it.
- **Share a word** under the message box sends a word card from your deck (word, meaning, example, any plural) that the recipient can add with **Add to deck**.
- For 10 minutes after sending you can **edit** a text message or **unsend** any message. Edited messages show “edited”; an unsent message becomes “Message unsent”, its text, word card, reactions and review are removed, and replies that quoted it show the same. A copy already retained in a moderation report is not removed.
- The search icon in the conversation header finds words or phrases ignoring case and accents (so “uber” finds “über”) across messages, word cards and reviews. It scans the latest 1,000 messages you can see, lists the 30 most recent matches, and scrolls to the one you choose, loading earlier messages if needed.
- **Delete conversation** removes it from your list and clears its earlier messages for you; the other companion keeps their copy, and a new message can make it appear again.
- You can report a received message for spam, harassment, inappropriate content, or another concern; reports retain the message and any details you provide for moderation handling.

### Tap to translate

Tap any word in a message, or use **Look up words** under it to pick from its words. Lookup works in both directions and sends nothing about the message anywhere:

- **German word:** checks your deck, then the bundled open starter vocabulary, then a larger bundled dictionary (about 22,800 frequent words and 128,000 word forms; a separate file of about 1.2 MB compressed that is downloaded when you first look up a word, then kept for offline use). It recognizes inflected forms (*ging* and *gelernt* for *gehen*, *Häuser* for *Haus*, *kleinen* for *klein*) and shows the base word, English meaning, article, plural and, where available, an example.
- **English word:** lists matching German words (for example *update*, *beautiful*, *working*), best meaning and most frequent first. When a word could be either language, the more common reading is shown first and a **German word / English word** switch lets you choose.
- **Add to deck** is offered for nouns, verbs, adjectives, adverbs and numbers. Only about one in five dictionary words has an example sentence, so otherwise you write your own first.
- It does not translate sentences, and meanings are short single-word glosses that can miss context. Words it does not know (names, compounds, spelling variants) offer links to Wiktionary and dict.cc, which open only when you choose them.

### Sentence check

A companion can review a text message with **Suggest edit** or **Looks good**. A suggestion shows their sentence with only the changed words highlighted (new words in green, replaced words faint), up to three optional reason chips (verb position, verb form, article, case ending, spelling, word choice, word order, tense, punctuation, more natural) and an optional note of up to 200 characters. The author can answer **Thanks** or **Add to my deck**, which saves the corrected sentence as a phrase card after they enter its English meaning; the reviewer sees the response. A message has one review and cannot be edited afterwards. Reviews are optional, count toward the message limit below, and never change anyone's scores or schedule.

### Shared words

Choose an active word in your deck to share it with a connected companion, with an optional note of up to 240 characters. The recipient sees a preview and chooses **Add to my deck** or **Not now**; shared words never enter their deck automatically. Adding creates a fresh card with no copied review history or schedule, and keeps the sender and note as source attribution. Shares expire after 30 days.

### Groups

Groups are open spaces for any verified learner, separate from private chat. Open them from the **Groups** tab in the companion workspace.

- **Create and join.** Any verified learner can create up to **3 groups** (a name and an optional description), and others can find and join them. A group holds up to 100 members and a learner can be in up to 20. Delete a group to free a slot.
- **Open or closed.** The creator can close a group so nobody new can join; members stay and can keep talking. The creator can open it again.
- **Listed or unlisted.** Owners can hide a group from Discover and members can copy an invitation link. Anyone with the link can join while the group is open, after signing in with a verified account and accepting the rules. Treat the link as a secret; switching the group back to listed invalidates it, and hiding it again creates a new link. Removed members still cannot rejoin.
- **Rules first.** Before a learner's first create or join, they read and agree to short group rules. Verified learners can create, join and post without an account-age waiting period.
- **Messages.** Text up to 1,000 characters with replies, reactions and shared word cards. Messages are visible to every member, so a note in the group says so. Learners can edit their own text for 10 minutes, until it is reviewed, and unsend their messages at any time. At most two links per message or word card, no repeated message within a minute, a short pause between messages and 60 messages or reviews per hour.
- **Look up and search.** Tap a word or use the word lookup button to look it up and optionally save it to your deck, just as in companion chat. Group search ignores case and accents and checks the latest 1,000 messages and their visible reviews, showing up to 30 matches; only members can search, and hidden or unsent content is excluded.
- **Sentence reviews.** Members can suggest edits or mark another member's text as looking good. Each member can review a message once; multiple reviews appear beneath it. The author can say thanks or save a suggested sentence to their deck. Reviews count toward the hourly message limit and can be reported or hidden separately from the original message.
- **Group activity.** Joined groups show the latest visible message and an unread count (up to 99+), shared across devices. Recent messages are marked read when the group is visible and the chat is near the bottom; unread counts include other members' visible messages since joining, excluding hidden or unsent messages. Message previews are available only to members.
- **Mentions.** Type `@` and a group member's username in a text message. Your group list shows pending mentions; open **@** in a group to review and manually clear them. Opening a chat or reading messages does not clear them. Mentions in hidden, unsent, expired, or edited messages that no longer mention you disappear; leaving and rejoining does not restore mentions from before your latest join.
- **Scroll to latest.** In either kind of chat, a floating button returns to the newest messages after you scroll up.
- **Typing.** A short-lived indicator shows other members or a companion when they type. Draft text is not sent until they send the message; indicators expire automatically and can take a few seconds to update.
- **Owners.** A group's creator can edit its name and description, hide a message, remove a member (who cannot rejoin), close or open the group, or delete it. Members see a chat notice when the name changes; the latest 1,000 notices are retained with the group. Select the group name to see its description, creation date, member count, and count of visible messages (excluding hidden and unsent messages).
- **Reporting and moderation.** Any member can report another member's message or review. Three reports from different members hide the reported item automatically. Reports from groups and from private chats appear in the **Moderation** view for the accounts listed in `MODERATOR_USER_IDS`, who can dismiss, hide the reported item or suspend the learner from groups for 1 to 90 days. Closed reports are deleted 90 days later, and group messages are deleted after one year.
- **Privacy.** Members see only usernames and avatars. Group messages and reviews are never sent to a third-party or AI service.

### Confirmation, limits and email

- Actions that remove data, cannot easily be undone, or affect another learner ask for confirmation in a dialog first: deleting a conversation or group, unsending or hiding a message, removing a group member, closing a group, suspending a learner, blocking, removing, unblocking, declining or cancelling a request, sending a reminder, sharing a word, setting a shared word aside, resetting review progress, replacing your deck or adding the starter pack, and signing out.
- Limits: 300 companion actions per account per 15 minutes (read-only refreshes do not count); 60 messages per account per hour, including word cards and reviews; ten requests and ten word shares per account per hour; one reminder per companion per 24 hours.
- Companion activity emails (requests, shared-word notices, and reminders) are on by default and can be turned off in the companion workspace. At most five notification emails are sent to a recipient per hour. Delivery is not guaranteed, and shared-word emails do not include the word or note. Requests and activity remain visible in the app if email is disabled or fails.

## Data, privacy, and recovery

- Cards, saved learning progress, schedule, and review history are stored in this browser's local storage for this app origin. When signed in, they are also synced to the configured MongoDB database.
- Clearing site data, changing browser profiles, or switching devices can remove or separate progress. Download backups regularly if the deck matters to you.
- Account data is stored in the `deutsch` MongoDB database when account sync is configured. The browser only receives an HTTP-only session cookie; the database URI remains on the server.
- New accounts require a six-digit email code before signing in. Existing accounts can continue signing in and can verify their email from the account menu. Codes expire after 10 minutes, can be used once, and have attempt and resend limits. Never share a code.
- Use **Forgot password?** for email-code recovery, or **Change password** when signed in. A reset invalidates existing sessions; a signed-in change keeps the current session and invalidates the others. Code requests return the same response whether an account exists or not; delivery failures are logged on the server. Keep a local backup.
- If account sync is not configured, studying, adding cards, importing, and backups continue to work locally.
- Companion chat history, word shares and reports are stored with account data on the server and are never sent to a third-party translation or AI service. Tap-to-translate runs entirely in the browser; the only outside requests are links to Wiktionary or dict.cc that open when you click them.
- If saved data cannot be read, the app warns and avoids overwriting it. Export/recovery tooling is intentionally kept separate from silent resets.

## Development checks

```sh
npm test
npm run lint
npm run build
```

See [AGENTS.md](./AGENTS.md) for the project's learning philosophy and implementation guidance. After changing API routes, restart the API server (`npm run dev` restarts it automatically on file changes). The API integration tests run against an in-memory database stand-in, so they need no MongoDB connection. To refresh the bundled open starter data from its source, run `npm run data:starter-pack`; to refresh the tap-to-translate dictionary, run `npm run data:dictionary` (both require internet access; the dictionary build caches its large download in a temporary folder and reuses it while the source file is unchanged).
