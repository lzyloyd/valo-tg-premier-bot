---
name: import-wuvochka-boss
description: Pull one boss's location/summary/counter-teams/detailed strategy into the Вувочка mini-app (src/miniapp-public/wuvochka/bosses.json), rephrased from Game8. Use when adding/updating a boss entry, e.g. "/import-wuvochka-boss <monsterId>".
---

# Import a Вувочка boss page from Game8

Runs live in this conversation (Browser tool + judgment for rephrasing) — not a script.

**Input:** `<monsterId>` — an Encore monster id. Look it up (name, category, element,
resistantTo, art filename, Game8 URL) in `scratch/boss-roster-final.json` (43-entry master
roster built 2026-09-24 by cross-referencing Encore's `/api/en/monster` Overlord/Calamity list
against Game8's "List of All Bosses" page — regenerate it the same way if it's missing).

## 0. Source policy — Game8 only, rephrased

Text comes **only** from the boss's Game8 URL (`game8Url` in the roster entry). Facts (numbers,
attack names, drop names) can be copied as-is; any editorial prose (strategy tips, phase
descriptions) must be **rephrased in your own words** — same policy as prydwen content
elsewhere in this project (see memory `feedback_prydwen_content_policy`). Never quote more than
a short phrase verbatim.

## 1. Scrape the Game8 guide page

Navigate the Browser tool to `game8Url`. The real article is `.p-archiveContent__main`, not
`<main>` (that tag is a hidden membership-upsell modal elsewhere on the page — `get_page_text`
will grab the wrong thing; query `.p-archiveContent__main` directly, e.g.
`document.querySelector('.p-archiveContent__main').innerText`). A cookie-consent dialog appears
on a fresh session — click "Отклонить все"/"Decline" once if present.

Pull, if present:
- **Location**: where to find the boss in the overworld / how to unlock the fight.
- **How to Beat**: the strategy section — usually several named tips (e.g. "Beware of X's Y
  attack", "Don't waste stamina while flying") each with a short explanation; phase transitions;
  specific dodge/parry timing. This is the richest section — keep the structure (one guide
  section per named tip) when rephrasing.
- **Team comps / suggested approach**: sometimes a dedicated section, sometimes folded into the
  strategy tips (e.g. "aerial characters have an advantage") — pull whichever exists.

**Category-specific notes:**
- `category: "world"` and `"weekly"` bosses have a full "Location and Guide" (or "Boss Fight and
  Location") page with real strategy content — expect all 3 pull targets above.
- `category: "nightmare"` bosses' Game8 pages are titled "Echo and Skills" / "How to Unlock and
  Skills" — they're about the echo drop, not a fresh strategy writeup, because it's the same
  fight as the base boss (just tougher, better echo rewards). For these: keep `summary` short
  ("тот же бой, что и обычный <base name>, но сложнее — даёт улучшенные эхо"), set
  `counterTeams` and `guide` to point at the base boss rather than re-deriving from nothing
  (e.g. `guide: [{title: "Механика боя", text: "Полностью повторяет обычного <base name> — см. его страницу за подробностями по стадиям."}]`). Don't fabricate a fake phase breakdown for
  these.

## 2. Resistant element (already resolved, don't re-derive)

`resistantTo` in the roster entry is already computed from Encore's `Properties.DamageResistanceElementN`
(the element with the highest RES value = the one the boss resists). Use it as-is: "старайтесь
не бить боссом стихии `element`, есть эхо-персонажи `resistantTo` — по нему босс проседает
меньше всего, берите другие стихии." Don't re-scrape or guess this from Game8's prose.

## 3. Translate, condense, structure

- Write everything in Russian, in your own words (see step 0). Keep the boss's own name
  untranslated (matches how character names stay in English elsewhere in this app, e.g.
  "Hiyuki", "Aemeath").
- `summary`: 2–4 sentences, plain-language "how to beat this boss" overview — not a re-list of
  every guide tip, the gist a player needs before walking in.
- `counterTeams`: a short array of strings (2–5 entries) — concrete suggestions ("персонажи с
  сильной аэро-атакой — босс много летает", "не берите стихию `resistantTo`") rather than
  generic filler.
- `guide`: array of `{title, text}` — one entry per named strategy tip from Game8's "How to
  Beat" section, title short (translate Game8's own tip heading), text 2–4 sentences.

## 4. Write the entry

Add/update `bosses.json[monsterId]` (create the file with `{}` if it doesn't exist yet). Shape:

```json
{
  "name": "Tempest Mephis",
  "category": "world",
  "element": "electro",
  "resistantTo": "electro",
  "icon": "330000010.webp",
  "location": "...",
  "summary": "...",
  "counterTeams": ["...", "..."],
  "guide": [{"title": "...", "text": "..."}]
}
```

`icon` is copied verbatim from the roster entry's `art` field (just the filename, e.g. `330000010.webp` — the app resolves it under `/wuwa-assets/bosses/`). Never re-derive it. This art is the boss's own Overlord/Calamity Echo splash art from Encore's `/api/en/echo` catalog (clean square image, no Game8 screenshot captions) — already downloaded for 42/43 bosses as of 2026-09-24; only "Scar" (340000050) has no matching Echo entry and keeps a Game8 location-screenshot fallback.

Do **not** touch `boss-modes.json` — that's the separate current-season Tower/Wastes/DPM
roster, refreshed independently (see project memory `project_wuvochka_boss_modes` for how).

Art is already downloaded to `src/miniapp-public/wuwa-assets/bosses/<monsterId>.<ext>` (see
`art` field in the roster entry) — don't re-fetch it, just reference the existing file.

## 5. Test locally, then version/commit/deploy

Same mechanics as `import-wuvochka-character` steps 5–6: PowerShell static server
(`scratch/static-server.ps1`, `HttpListener` loop over `src/miniapp-public`, fresh port, delete
when done), open in the Browser tool, `openBoss('<monsterId>')` via `javascript_exec`, check all
4 blocks render and match what was scraped, check `read_console_messages` for anything beyond
the two expected local-only profile errors. Then bump `app-version`, commit
`bosses.json` (+ `boss-modes.json`/`index.html` if this batch touched them) with
`Co-Authored-By`, push, SSH-deploy to `tgbot-vps`, curl-verify the version string.

When running as part of a parallel batch (multiple bosses at once): each agent writes ONLY to
its own scratch file `scratch/import-boss-<monsterId>.json` (the entry shape from step 4) and
does **not** touch `bosses.json`, `index.html`, or run steps 5–6 itself — the orchestrating
session merges all drafts into `bosses.json`, does one local test, one version bump, one commit,
one deploy per batch (same discipline as the character-import pipeline).

## Don't

- Don't invent phase mechanics or attack names for a boss Game8 doesn't cover in depth — if the
  page is thin (just location + drops, no real strategy section), keep `guide` short and honest
  rather than padding it.
- Don't reproduce Game8's prose closely enough to count as a quote — always restructure into
  your own sentences, per the content policy.
- Don't fabricate `resistantTo` or `element` — always take them from the roster entry (sourced
  from Encore's raw stats), never guess from flavor text.
