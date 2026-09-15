---
name: import-wuvochka-character
description: Pull a character's real Build/Gameplay/Review/Kit data from prydwen.gg into the Вувочка mini-app (src/miniapp-public/wuvochka/*.json), matching the schema already used for Aemeath (id 1210) and Jingran (id 1212). Use when the user asks to add/update a character page, e.g. "/import-wuvochka-character <slug> <charId>".
---

# Import a Вувочка character page from prydwen.gg

Runs live in this conversation (needs the Browser tool + judgment for translation) — it is
not a script. Follow it like a checklist; skip steps that don't apply (e.g. no calc variants).

**Inputs:** `<slug>` (prydwen URL slug, e.g. `jingran`) and `<charId>` (numeric id from
`src/miniapp-public/wuwa-assets/characters/index.json`). If the user only gives a name, find
the slug by checking `https://www.prydwen.gg/wuthering-waves/characters/<guess>` and the id by
grepping the character's name in that index.json.

## 0. Make sure the character/weapons/echoes actually exist in our asset data

Encore API (`wuwa-assets/*/index.json`) can lag a patch by a few days. Before scraping:
- Grep the character's name in `src/miniapp-public/wuwa-assets/characters/index.json`. If
  missing, re-run `node scripts/fetch-wuwa-assets.mjs` (re-runnable, safe) and check again.
  If still missing, stop and tell the user — don't fabricate an id.
- Note the character's element/weaponType/rarity from that entry; you'll cross-check prydwen
  agrees.

## 1. Scrape prydwen.gg — all tabs are in the DOM at once, just hidden

Navigate the Browser tool to `https://www.prydwen.gg/wuthering-waves/characters/<slug>`.

Key fact learned the hard way: prydwen's Kit/Review/Build/Gameplay/Calculations tab panels
all render into the DOM on load — only one is visually active, the rest are hidden. Two
consequences:
- `get_page_text` / `.innerText` only returns the **currently active** tab's text (innerText
  skips hidden elements). To read a different tab's content, either click that tab's DOM
  element first, or query the underlying container and read `.innerText` from it directly
  (works if the panel is deprioritized visually but not literally `display:none` — check
  both; if a query comes back empty/short, click the tab and retry).
- Plain `curl`/`fetch` of the URL gets a ~5KB client-rendered shell with none of this text —
  a real JS-executing browser (this tool) is required. Don't try to script this with a plain
  HTTP client.

Practical extraction pattern (`javascript_tool`, `javascript_exec`): find the smallest element
whose `textContent` contains a distinctive heading (`/i.test(e.textContent)`), sort matches by
length, then walk up `parentElement` a few times until the container includes the next
section's heading too — then read `.innerText`. This is more reliable than guessing class
names, since prydwen's markup changes between characters. All of this works with pure DOM
text extraction — you don't need a visible/active tab or a working screenshot for it, and
shouldn't reach for one; screenshots on this site are unreliable when the target content
isn't the currently-active tab (scroll_to on a hidden panel silently doesn't move the visible
viewport) and a first-visit cookie-consent dialog can eat a screenshot attempt too — click the
"Do not consent" option once if it appears, then go back to DOM queries rather than fighting
the screenshot tool further.

Pull these sections (skip ones that don't exist for this character):
- **Review tab**: Ratings (ToA/WW tier — cross-check against `tierlist.json`, don't re-derive
  by hand), Pros & Cons, and the full review prose (usually: intro + a couple of "Key
  Mechanics: ..." subsections + "Gameplay Loop"/"Rotation Mechanics" + "Meta Position &
  Conclusion").
- **Build tab**: Best Weapons (ranked list with % score + note), Best Echo Sets (set + main
  echo item), Best Echo Stats (cost slots + stat), Best Endgame Stats, Skill Priority.
- **Gameplay and teams tab**: Rotation(s) (steps), Synergies, Example Teams. For team
  composition, don't guess from flat `img[alt]` order across the whole page — teams can
  outnumber their own headings (Rebecca's page had 4 real teams under headers "Best Team",
  "Edgerunners Team", "Phoebe Team", "Alternative Heavy Attack Teams", where only "Best Team"
  looked like a ribbon at first glance) and alt-order alone can't tell where one ends and the
  next begins. Instead query the real structure directly:
  `document.querySelectorAll('.team-showcase .team-row')` — each `.team-row` is one team, its
  preceding `.team-header` sibling is the team's title, and each of its 3 `.column` children
  is one slot: `col.querySelector('.big')` holds the recommended pick's `img[alt]` (slot 0 may
  have more than one `.big` img if several DPS are equally viable — our schema only renders
  `slots[0][0]` as the hero, so pick the first and mention the rest in the team's `text`), and
  `col.querySelector('.small')` holds the flexible alternates' `img[alt]`s in order. A
  `.team-notes` element between two `.team-row`s is a note that belongs to the row right
  before it.
- **Calculations tab**: scenario (rotation time), the "done using added buffs from" teammates
  (weapon/set/main-echo per teammate), sequence table (S0–S6 dmg/dps/%), damage-source
  breakdown. If there's more than one calc variant (rare — Aemeath has Tune Rupture / Fusion
  Burst), get each. The build used for calcs is usually hidden behind a "Character build" /
  "Details about the calculations" expandable — click it (even via `.click()` on a hidden
  element works) before reading, since it has the *exact* cost-slot stats used, which can
  differ slightly from the general Build tab's advice.
- **Kit tab**: the `.tabs-skills` element's parent has children in a fixed order — the 3
  after `.tabs-skills` itself are Active / Passive / Concerto panels (in that order,
  regardless of which has `.active` in its class). Read `.innerText` on each directly; no
  need to click. Also grab "Minor Fortes (Total)" (2 short stat lines). Skip "Upgrade
  Materials" and "Stats" sections — we deliberately don't carry these (see project decision:
  materials card was removed for both Aemeath and Jingran, no fabricated data).

## 2. Cross-reference every name to a real id/icon

Never invent an id or icon path. For every weapon, teammate, echo set, and echo item named on
prydwen, look it up by exact name in:
- `src/miniapp-public/wuwa-assets/characters/index.json` (teammates, the subject character)
- `src/miniapp-public/wuwa-assets/weapons/index.json` (weapons)
- `src/miniapp-public/wuvochka/echo-data.json` (`.sets[].name` for echo sets incl. `.badge`
  icon path, `.items[].name` for echo items incl. `.icon`)

If a name doesn't match anything (typo on prydwen's side, or a genuinely new echo/weapon not
yet in our data), stop and flag it — don't guess an id.

## 3. Translate and condense — don't paste English 1:1

- Follow `feedback_wuvochka_terminology` memory for fixed term translations (e.g. Crit Rate →
  «Крит. шанс»). Add any newly-confirmed terms there if the user corrects you.
- Numbers (%, HP thresholds, S0–S6 damage/dps) are copied verbatim — never translate or round
  numbers.
- Drop joke/meme asides prydwen sometimes puts in Pros ("must pull because reasons", etc.) —
  keep only substantive points.
- Review prose: condense to the same 4-part shape already used for both existing characters —
  one untitled intro paragraph, then 1–2 titled sections drawn from whatever the source's own
  subheadings were (e.g. "Ключевые механики", "Ротация"), then "Итог" for the meta
  conclusion. Each section 2–4 sentences, not a paraphrase of every sentence in the source.

## 4. Write the four JSON files

Diff your draft's shape against Aemeath (`1210`) and Jingran (`1212`) in each file — they are
the canonical schema examples. Summary (see those entries for exact field names):

- **`builds.json[charId]`**: `variants` (only if there's more than one build/calc variant;
  each needs `id`, `name`, `teammates[]` with `charId`/`weaponId`/`echoSet`/`echoItemIcon`/
  `echoItemName`), `weapons[]` (`id`, `scores.{variantId: number|null}`, `note`), `echoSet`,
  `echoSetNote`, `echoMainItems[]` (`name`,`icon`,`note`), `echoStatPriority[]`
  (`slot`,`stat`), `stats[]` (`label`,`value`), `skillPriority[]` (strings).
- **`gameplay.json[charId]`**: `rotationsNote`, `rotations[]` (`title`,`note`,`steps[]`),
  `synergies[]` (`charIds[]`,`title`,`text`), `teams[]` (`title`,`slots` — array of arrays of
  charIds, slot 0 = the main DPS as a single-element array), `calculations` (`scenario`,
  `note` — must say buffs ARE included if teammates are listed, don't say "solo" if it isn't
  — this exact mistake was caught and fixed for Aemeath once already —, `variants[]` with
  `id`,`name`,`characterBuild` (`weaponId`,`echoSet`,`mainEcho`,`costSlots[]`,`substats`
  string),`sequences[]` (`seq`,`dmg`,`dps`,`pct`), `damageSources[]` (`label`,`value`,`pct` —
  percentages should sum to ~100).
- **`reviews.json[charId]`**: `f2pStars` (1–5, your own editorial judgment — the only
  hand-authored rating; ToA/WW stars are computed at render time from `tierlist.json`, don't
  add them here), `pros[]`, `cons[]` (plain strings), `sections[]` (`title` optional — omit
  for the intro block —, `text`).
- **`kit.json[charId]`**: `skills.active[]` / `.passive[]` / `.concerto[]` (each
  `{name, desc}`), `minorFortes[]` (strings, `<b>` tags allowed for the stat value like the
  existing entries).

If the character has no tier-list entry yet in `tierlist.json`, that's a separate task (real
tier placement needs its own prydwen tier-list scrape) — mention it to the user rather than
guessing a tier.

## 5. Test locally before touching the live server

Node/Python aren't available in this environment — use the PowerShell static-file-server
recipe (see recent git history for `scratch/static-server.ps1` if it's been deleted, or ask —
it's a short `HttpListener` loop serving `src/miniapp-public`). Steps each time:
1. Write the script to `scratch/static-server.ps1`, pick a fresh port, start it with
   `PowerShell` + `run_in_background` isn't needed — use `Start-Process ... -WindowStyle Hidden`.
2. Open it with the Browser tool, `openChar(<charId>)` via `javascript_exec`, click through all
   5 subtabs, diff the numbers you see against what you scraped.
3. Watch for the recurring stale-tab bug: editing a file mid-session sometimes pops a new
   `file://.../index.html` browser tab via a PostToolUse hook — check `tabs_context` and close
   any stray `file://` tab before continuing, or your next navigate/click can land on the
   wrong tab.
4. Check `read_console_messages` for anything beyond the two expected local-only errors
   (profile fetch 404/JSON-parse failure — there's no backend when testing standalone).
5. Stop the PowerShell server and delete `scratch/static-server.ps1` when done.

## 6. Version, commit, deploy

- Bump `<span class="app-version">` in `index.html`'s header: a full new character page is a
  "major" change → +0.1 per `feedback_wuvochka_versioning` memory (e.g. v2.6 → v2.7).
- Commit `src/miniapp-public/wuvochka/*.json` + `index.html` together with a message
  summarizing what was added, ending with the required `Co-Authored-By` line.
- `git push origin main`, then
  `ssh tgbot-vps "cd /opt/tg-results-bot && git pull && systemctl restart tg-results-bot && sleep 2 && systemctl is-active tg-results-bot"`,
  then confirm via
  `curl -s https://team-ovt.duckdns.org/wuvochka/index.html | grep -o 'app-version">[^<]*<'`.

## Don't

- Don't touch `scratch/wuvochka-concept.html` — it's an abandoned prototype, production
  (`src/miniapp-public/wuvochka/`) is the only source of truth (existing project note).
- Don't fabricate materials, stats-at-90, or voice actor data if prydwen itself says
  "not available yet" for that character — leave it out rather than inventing numbers.
- Don't hand-author ToA/WW star ratings — they're computed from `tierlist.json` at render
  time (`TIER_TO_STARS` in `index.html`); adding a `ratings` array to `reviews.json` is a
  stale schema from before that change and won't be read.
