// Scrapes encore.moe for the FULL rules of the current Tower of Adversity /
// Whimpering Wastes / Doubled Pawn Matrix rotation (buffs, target scores,
// floor/stage enemy lists, per-boss notes, character buffs) and writes
// data/wuvochka-mode-details.json. This is straight game data (not editorial
// prose), so it's carried over close to verbatim rather than rephrased.
//
// Parsing approach: encore.moe's markup is plain Tailwind utility classes with
// no semantic hooks, so instead of depending on that structure this reads the
// rendered page's plain text (like fetch-boss-modes.mjs does for boss
// presence) and splits it on the game's own stable UI strings ("Tower Buffs",
// "Targets", "Cost: N", "Stage N", "Suggested Buff", ...). The one thing that
// genuinely requires DOM access is switching between the area/level/variant
// tabs, which are client-side state, not separate URLs (Tower's 3 zones are
// the exception — those ARE a ?area= query param). Two Tailwind class
// combinations reliably identify the two tab-row levels across all three page
// types: `div.inline-flex.rounded-xl` (top-level: Tower zone / Wastes area /
// DPM variant) and `div.inline-flex.rounded-lg` (second-level: Wastes
// difficulty number). If encore.moe ever reworks its frontend these selectors
// break — same risk the existing boss-mode scraper already accepts.
//
// Run manually: node scripts/fetch-mode-details.mjs
// Normally only runs when scripts/fetch-boss-modes.mjs's daily 00:00 UTC scrape
// sees the season/phase label change (see the call from there) — this scrape
// is much heavier (dozens of tab switches) so it's skipped on days nothing
// actually rotated.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'data', 'wuvochka-mode-details.json');
const ICON_DIR = path.join(__dirname, '..', 'data', 'wuvochka-enemy-icons');
const MONSTER_API = 'https://api-v2.encore.moe/api/en/monster';
const ITEM_API = 'https://api-v2.encore.moe/api/en/item';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function lines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

function toNumber(line) {
  return Number(line.replace(/[^\d]/g, ''));
}

async function mainText(page) {
  return page.evaluate(() => document.querySelector('main')?.innerText || '');
}

async function topTabLabels(page) {
  return page.$$eval('main div.inline-flex.rounded-xl button', (btns) => btns.map((b) => b.textContent.trim()));
}

async function subTabLabels(page) {
  return page.$$eval('main div.inline-flex.rounded-lg button', (btns) => btns.map((b) => b.textContent.trim()));
}

async function clickTab(page, containerSelector, label) {
  await page.evaluate(
    (containerSelector, label) => {
      const btns = Array.from(document.querySelectorAll('main ' + containerSelector + ' button'));
      const btn = btns.find((b) => b.textContent.trim() === label);
      if (btn) btn.click();
    },
    containerSelector,
    label,
  );
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function currentNumber(page, listUrl, pattern) {
  await page.goto(listUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
  const nums = hrefs.map((h) => (h ? h.match(pattern) : null)).filter(Boolean).map((m) => Number(m[1]));
  if (!nums.length) throw new Error(`no numbered links found at ${listUrl}`);
  return Math.max(...nums);
}

// ---------- Russian translation of buff/mechanic descriptions ----------
//
// This is straight game data, so unlike Game8 boss-guide prose it isn't
// rephrased — it's translated close to 1:1. Kuro reuses a small, stable set
// of sentence templates for these buffs across seasons (only the numbers and
// element names change), so each rule below is a regex over one template
// with the varying parts captured, not a hardcoded exact string — it keeps
// matching after a season rotates in new values. Policy: element names
// (Aero, Fusion, ...) and mode-specific proper-noun mechanics (Ember, Vigor,
// Concerto Energy, Tune Break/Strain, Mistune, Crisis Response, Escalation)
// stay in English, same as how character/weapon/boss names stay English
// elsewhere in this app — only the surrounding descriptive sentence is
// translated. A line that matches nothing here is left in English rather
// than dropped, so an unseen new template degrades gracefully instead of
// silently disappearing (and shows up as English in the app, which is the
// visible signal that this list needs a new rule).
const TRANSLATE_EXACT = new Map([
  ['Clear the challenge', 'Пройти испытание'],
  ['When entering a Challenge, Concerto Energy is restored to 100%', 'При входе в испытание Concerto Energy восстанавливается до 100%'],
  ['When entering a Challenge, Resonance Energy is restored to 100%', 'При входе в испытание Resonance Energy восстанавливается до 100%'],
  ['Negative Statuses:', 'Негативные статусы:'],
  ['Tune break:', 'Tune break:'],
  ['Dealing damage or defeating enemies restores Ember.', 'Нанесение урона или добивание врагов восстанавливает Ember.'],
  [
    "When hit by a Resonator's skill, enemies in the Mistune state take an instance of Tune Break DMG and then exit the Mistune state.",
    'Когда враг в состоянии Mistune получает удар навыком Резонатора, он получает урон Tune Break и выходит из состояния Mistune.',
  ],
  [
    'All Tokens have unlimited uses while inside the Infinite Torrents.',
    'Внутри Infinite Torrents все токены можно использовать неограниченное число раз.',
  ],
  // DPM buff-block titles and the suggested-buff category word.
  ['General Enhancement', 'Общее усиление'],
  ['Enhancement: Negative Status', 'Усиление: негативные статусы'],
  ['Enhancement: Echo Skill', 'Усиление: Навык эхо'],
  ['Enhancement: Tune Break', 'Усиление: Tune Break'],
  ['General', 'Общий'],
]);

const TRANSLATE_RULES = [
  [/^Clear the challenge with at least (\d+)s left$/, (m) => `Пройти испытание, оставив не менее ${m[1]}с на таймере`],
  [/^Enemy (\w+) RES decreases by (\d+)%$/, (m) => `Резист врагов к стихии ${m[1]} снижен на ${m[2]}%`],
  [
    /^Resonators ignore (\d+)% of the enemy's DEF when dealing damage\. When enemies are affected by Negative Statuses, their DMG taken is Amplified by (\d+)%\.$/,
    (m) => `Резонаторы игнорируют ${m[1]}% защиты врага при нанесении урона. Пока враг под негативным статусом, получаемый им урон усилен на ${m[2]}%.`,
  ],
  [
    /^Enemies' (\w+) RES and (\w+) RES are decreased by (\d+)%, and their (\w+) RES and (\w+) RES are increased by (\d+)%\.$/,
    (m) => `Резист врагов к ${m[1]} и ${m[2]} снижен на ${m[3]}%, а к ${m[4]} и ${m[5]} — повышен на ${m[6]}%.`,
  ],
  [
    /^ATK is increased by (\d+)%\. Resonators gain (\d+)% All DMG Bonus for (\d+)s upon casting Intro Skill\.$/,
    (m) => `АТК увеличена на ${m[1]}%. Резонаторы получают +${m[2]}% ко всему урону на ${m[3]}с при использовании Навыка вступления.`,
  ],
  [
    /^(\d+)s after the battle starts, after a Resonator's attacks hit an enemy, that enemy takes (\d+)% more total DMG\. This value increases by (\d+)% every (\d+)s, up to a maximum of (\d+)%\.$/,
    (m) => `Через ${m[1]}с после начала боя враг, получивший удар от Резонатора, начинает получать на ${m[2]}% больше суммарного урона. Значение растёт на ${m[3]}% каждые ${m[4]}с, вплоть до ${m[5]}%.`,
  ],
  [
    /^Enemies' All-Attribute RES is increased by (\d+)%\. The (\w+) or (\w+) DMG taken by the enemies are not effected by this effect\.$/,
    (m) => `Резист врагов ко всем стихиям повышен на ${m[1]}%. На получаемый урон ${m[2]} и ${m[3]} этот эффект не действует.`,
  ],
  [
    /^Enemies take (\d+)% more total DMG and (\d+)% more total (\w+) DMG\. Resonators gain (\d+)% (\w+) DMG Bonus for (\d+)s upon gaining Shield, stacking up to (\d+) times\. Retriggering the effect resets its duration\.$/,
    (m) => `Враги получают на ${m[1]}% больше суммарного урона и на ${m[2]}% больше урона ${m[3]}. Резонаторы получают +${m[4]}% к урону ${m[5]} на ${m[6]}с при получении щита, до ${m[7]} стаков. Повторное срабатывание обновляет длительность.`,
  ],
  [
    /^Casting Intro Skill increases ATK by (\d+)% for (\d+)s\. Casting Resonance Skill grants (\d+)% Resonance Liberation DMG Bonus for (\d+)s\. Retriggering these effects resets their durations\.$/,
    (m) => `Использование Навыка вступления повышает АТК на ${m[1]}% на ${m[2]}с. Использование Навыка резонанса даёт +${m[3]}% к урону Разрыва резонанса на ${m[4]}с. Повторное срабатывание обновляет длительность обоих эффектов.`,
  ],
  [
    /^The Burning Waves state starts when Ember is full, which lasts for (\d+)s\. During this state, attacks that hit enemies cause them to take (\d+)% more Total DMG for (\d+)s\.$/,
    (m) => `Когда Ember заполнен, начинается состояние Burning Waves длительностью ${m[1]}с. Пока оно активно, попадания по врагам заставляют их получать на ${m[2]}% больше урона в течение ${m[3]}с.`,
  ],
  [/^Total DMG taken by enemies is increased by (\d+)%\.$/, (m) => `Получаемый врагами суммарный урон увеличен на ${m[1]}%.`],
  [
    /^Enemies take (\d+)% more total DMG\. Enemies take (\d+)% more total Heavy Attack DMG\.$/,
    (m) => `Враги получают на ${m[1]}% больше суммарного урона и на ${m[2]}% больше урона от тяжёлых атак.`,
  ],
  [
    /^When inflicted with Negative Statuses, the target's total DMG taken is increased by (\d+)% for (\d+)s\. Enemies take (\d+)% more total (\w+) Chafe DMG\.$/,
    (m) => `При наложении негативного статуса цель получает на ${m[1]}% больше суммарного урона в течение ${m[2]}с. Враги получают на ${m[3]}% больше урона ${m[4]} Chafe.`,
  ],
  [
    /^Total Echo Skill DMG is increased by (\d+)%\. Total Havoc DMG is increased by (\d+)%\. Total Resonance Skill DMG is increased by (\d+)%\.$/,
    (m) => `Суммарный урон от Навыка эхо увеличен на ${m[1]}%. Суммарный урон Havoc увеличен на ${m[2]}%. Суммарный урон от Навыка резонанса увеличен на ${m[3]}%.`,
  ],
  [
    /^When a Resonator inflicts Tunability - Shifting, the total DMG dealt by all Resonators in the team is increased by (\d+)% for (\d+)s\.$/,
    (m) => `Когда Резонатор накладывает Tunability - Shifting, суммарный урон всех Резонаторов в отряде увеличен на ${m[1]}% на ${m[2]}с.`,
  ],
  [
    /^When a Resonator inflicts Tune Strain - Shifting, their total DMG is increased by (\d+)% for (\d+)s\.$/,
    (m) => `Когда Резонатор накладывает Tune Strain - Shifting, его суммарный урон увеличен на ${m[1]}% на ${m[2]}с.`,
  ],
  [
    /^- (.+) takes (\d+)% more total DMG for (\d+)s when inflicted with (\w+) Bane, stacking up to (\d+) times\.$/,
    (m) => `- ${m[1]} получает на ${m[2]}% больше суммарного урона в течение ${m[3]}с при наложении ${m[4]} Bane, до ${m[5]} стаков.`,
  ],
  [
    /^- (.+) takes (\d+)% more total DMG for (\d+)s when a (\w+) Bane stack on it is consumed\.$/,
    (m) => `- ${m[1]} получает на ${m[2]}% больше суммарного урона в течение ${m[3]}с при расходовании стака ${m[4]} Bane.`,
  ],
  [
    /^- (.+) takes (\d+)% more total DMG when affected by Tune Strain - Shifting or Tune Strain - Interfered\. The max limit of Tune Strain - Interfered on \1 is increased by (\d+)\. While affected by Tune Strain - Shifting, taking Treak Break additionally inflicts (\d+) stacks of Tune Strain - Interfered by the Resonators\. This effect can only be triggered once every battle\.$/,
    (m) => `- ${m[1]} получает на ${m[2]}% больше суммарного урона при Tune Strain - Shifting или Tune Strain - Interfered. Максимум стаков Tune Strain - Interfered на ${m[1]} увеличен на ${m[3]}. Пока активен Tune Strain - Shifting, получение Treak Break дополнительно накладывает ${m[4]} стак(а) Tune Strain - Interfered от Резонаторов. Эффект срабатывает не чаще раза за бой.`,
  ],
  [
    /^Resonators gain additional Vigor \(S2 Phase (\d+) only\)\.$/,
    (m) => `Резонаторы получают дополнительный Vigor (только S2, фаза ${m[1]}).`,
  ],
  [
    /^Resonators deal (\d+)% more total DMG\. Casting Resonance Liberation grants the Resonators in the team (\d+)% Resonance Skill DMG Bonus for (\d+)s\.$/,
    (m) => `Резонаторы наносят на ${m[1]}% больше суммарного урона. Использование Разрыва резонанса даёт отряду +${m[2]}% к урону Навыка резонанса на ${m[3]}с.`,
  ],
  [
    /^Resonators deal (\d+)% more total DMG\. Casting Resonance Liberation grants the Resonators in the team (\d+)% Resonance Liberation DMG Bonus for (\d+)s\.$/,
    (m) => `Резонаторы наносят на ${m[1]}% больше суммарного урона. Использование Разрыва резонанса даёт отряду +${m[2]}% к урону Разрыва резонанса на ${m[3]}с.`,
  ],
  [/^Resonators deal (\d+)% more total DMG\.$/, (m) => `Резонаторы наносят на ${m[1]}% больше суммарного урона.`],
  [
    /^Resonator's total DMG dealt is increased by (\d+)%\. Upon casting Resonance Liberation, Resonators in the team gain a (\d+)% increase in (\w+) DMG Bonus for (\d+)s\.$/,
    (m) => `Суммарный наносимый урон Резонатора увеличен на ${m[1]}%. При использовании Разрыва резонанса отряд получает +${m[2]}% к урону ${m[3]} на ${m[4]}с.`,
  ],
  // DPM escalation-buff tooltip descriptions (see fetchEscalationTooltips()).
  // Boss names are captured, not hardcoded, since these repeat per-boss with
  // only the name (and occasionally the numbers) changing.
  [
    /^Upon defeating (?:an? )?(.+), all Resonators in the current team become immune to all DMG and interruptions for (\d+)s\.$/,
    (m) => `После победы над ${m[1]} все Резонаторы в отряде становятся неуязвимы ко всему урону и прерываниям на ${m[2]}с.`,
  ],
  [
    /^For (\d+)s after defeating (?:an? )?(.+), all Resonators in the team are immune to all types of damage and interruptions\.$/,
    (m) => `В течение ${m[1]}с после победы над ${m[2]} все Резонаторы в отряде неуязвимы ко всем видам урона и прерываниям.`,
  ],
  [
    /^The Vibration Strength Reduction Rate against (.+) is reduced by (\d+)%\. Counterattacks restore (\d+) points of Resonance Energy on hit and additionally reduces the Vibration Strength of the target by (\d+)% of its maximum\.$/,
    (m) => `Против ${m[1]} Vibration Strength Reduction Rate снижена на ${m[2]}%. Контратаки восстанавливают ${m[3]} очков Resonance Energy при попадании и дополнительно снижают Vibration Strength цели на ${m[4]}% от максимума.`,
  ],
  [
    /^(.+) has its ATK increased by (\d+)%\. Dodge Counter restores (\d+) points of Resonance Energy on hit and additionally reduces the target's Vibration Strength by (\d+)% of its maximum\. CD: (\d+)s\.$/,
    (m) => `АТК ${m[1]} увеличена на ${m[2]}%. Контратака уклонением восстанавливает ${m[3]} очков Resonance Energy при попадании и дополнительно снижает Vibration Strength цели на ${m[4]}% от максимума. КД: ${m[5]}с.`,
  ],
  [
    /^Vibration Strength Reduction taken by (.+) is reduced by (\d+)%\. When \1 is in mid-air, it deals (\d+)% more DMG\. If it's affected by Negative Statuses or Tunability - Shifting, Resonators' Vibration Strength Reduction Rate is increased by (\d+)%\.$/,
    (m) => `Получаемое ${m[1]} снижение Vibration Strength уменьшено на ${m[2]}%. Пока ${m[1]} в воздухе, он наносит на ${m[3]}% больше урона. Если он под негативным статусом или Tunability - Shifting, Vibration Strength Reduction Rate Резонаторов увеличена на ${m[4]}%.`,
  ],
  [
    /^Counterattack increases the target's Off-Tune Level by (\d+)% of the maximum and reduces their Vibration Strength by (\d+)% of the maximum on hit\.$/,
    (m) => `Контратака увеличивает Off-Tune Level цели на ${m[1]}% от максимума и снижает её Vibration Strength на ${m[2]}% от максимума при попадании.`,
  ],
  [
    /^(.+) has equal RES to all attribute DMG\. Dealing damage to it yields ([\d.]+)x points\. \[For (\w+) only\] Defeating \1 additionally grants (\d+) points\.$/,
    (m) => `${m[1]} имеет одинаковый резист ко всем стихиям. Урон по нему даёт ${m[2]}x очков. [Только ${m[3]}] Победа над ${m[1]} дополнительно даёт ${m[4]} очков.`,
  ],
  // Wastes token effect lines (see fetchTokenDetail()).
  [/^Amplifies all Attribute DMG by (\d+)%\.$/, (m) => `Усиливает урон всех стихий на ${m[1]}%.`],
  [
    /^Gaining Shield grants the Resonator (\d+)% (\w+) DMG Bonus and increases their total Heavy Attack DMG by ([\d.]+)% for (\d+)s, stacking up to (\d+) times\. Retriggering this effect refreshes the duration\.$/,
    (m) => `Получение щита даёт Резонатору +${m[1]}% к урону ${m[2]} и увеличивает суммарный урон от тяжёлых атак на ${m[3]}% на ${m[4]}с, до ${m[5]} стаков. Повторное срабатывание обновляет длительность.`,
  ],
  [/^Enemies take (\d+)% more total (\w+) DMG\.$/, (m) => `Враги получают на ${m[1]}% больше урона ${m[2]}.`],
  [
    /^Resonators deal (\d+)% more total (\w+) DMG for (\d+)s upon casting Intro Skill\.$/,
    (m) => `Резонаторы наносят на ${m[1]}% больше урона ${m[2]} в течение ${m[3]}с после использования Навыка вступления.`,
  ],
  [
    /^Inflicting Tune Strain - Shifting increases the Resonator's total DMG dealt by (\d+)% for (\d+)s\.$/,
    (m) => `Наложение Tune Strain - Shifting увеличивает суммарный наносимый урон Резонатора на ${m[1]}% на ${m[2]}с.`,
  ],
  [
    /^Dealing Tune Break DMG grants (\d+)% All-Attribute DMG Bonus plus an additional (\d+)% (\w+) DMG Bonus to all Resonators in the team for (\d+)s\.$/,
    (m) => `Нанесение урона Tune Break даёт всему отряду +${m[1]}% к урону всех стихий и ещё +${m[2]}% к урону ${m[3]} на ${m[4]}с.`,
  ],
  [
    /^This Token can be used up to (\d+) times in (.+)\.$/,
    (m) => `Этот токен можно использовать до ${m[1]} раз(а) в режиме «${m[2] === 'Whimpering Wastes' ? 'Тщетные Пустоши' : m[2]}».`,
  ],
];

function translateLine(line) {
  if (TRANSLATE_EXACT.has(line)) return TRANSLATE_EXACT.get(line);
  for (const [re, fn] of TRANSLATE_RULES) {
    const m = line.match(re);
    if (m) return fn(m);
  }
  return null;
}

function translateOrKeep(line) {
  return translateLine(line) ?? line;
}

// ---------- Tower of Adversity ----------

function parseFloorGroups(L, start, end) {
  const groups = [];
  let current = null;
  for (let i = start; i < end; i++) {
    const m = L[i].match(/^Floors: (.+)$/);
    if (m) {
      current = { floors: m[1], lines: [] };
      groups.push(current);
    } else if (current) {
      current.lines.push(L[i]);
    }
  }
  return groups;
}

function parseTowerArea(text) {
  const L = lines(text);
  const buffsIdx = L.indexOf('Tower Buffs');
  const targetsIdx = L.indexOf('Targets', buffsIdx + 1);
  const buffs = buffsIdx >= 0 && targetsIdx > buffsIdx ? parseFloorGroups(L, buffsIdx + 1, targetsIdx) : [];
  let costStart = targetsIdx >= 0 ? targetsIdx + 1 : L.length;
  while (costStart < L.length && !/^Cost: \d+$/.test(L[costStart])) costStart++;
  const targets = targetsIdx >= 0 ? parseFloorGroups(L, targetsIdx + 1, costStart) : [];

  const floors = [];
  let i = costStart;
  while (i < L.length) {
    const costMatch = L[i].match(/^Cost: (\d+)$/);
    if (!costMatch) break;
    const cost = Number(costMatch[1]);
    i++;
    const floorMatch = L[i] ? L[i].match(/^Floor (\d+)$/) : null;
    const floor = floorMatch ? Number(floorMatch[1]) : null;
    if (floorMatch) i++;
    const enemies = [];
    while (i < L.length && !/^Cost: \d+$/.test(L[i])) {
      enemies.push(L[i]);
      i++;
    }
    floors.push({ floor, cost, enemies });
  }
  return { buffs, targets, floors };
}

async function scrapeTower(page, season) {
  const zoneDefs = [
    { key: 'resonant', area: 1 },
    { key: 'hazard', area: 2 },
    { key: 'echoing', area: 3 },
  ];
  const areas = [];
  for (const def of zoneDefs) {
    await page.goto(`https://encore.moe/toa/${season}?area=${def.area}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const labels = await topTabLabels(page);
    const title = labels[def.area - 1] || def.key;
    const parsed = parseTowerArea(await mainText(page));
    areas.push({ key: def.key, title, ...parsed });
  }
  return { label: `Season ${season}`, areas };
}

// ---------- Whimpering Wastes ----------

function parseWastesLevel(text, skipLabels) {
  const L = lines(text);
  const seasonIdx = L.findIndex((l) => /^Season \d+$/.test(l));
  let i = seasonIdx >= 0 ? seasonIdx + 1 : 0;
  while (i < L.length && skipLabels.has(L[i])) i++;

  const mechanicName = L[i] || null;
  i++;
  const mechanicLines = [];
  while (i < L.length && L[i] !== 'Tokens' && L[i] !== 'Target Scores') {
    mechanicLines.push(L[i]);
    i++;
  }
  const tokens = [];
  if (L[i] === 'Tokens') {
    i++;
    while (i < L.length && L[i] !== 'Target Scores') {
      tokens.push(L[i]);
      i++;
    }
  }
  const targetScores = [];
  if (L[i] === 'Target Scores') {
    i++;
    while (i < L.length && /^[\d\s.,]+$/.test(L[i]) && !/^Stage \d+$/.test(L[i])) {
      targetScores.push(toNumber(L[i]));
      i++;
    }
  }
  const stages = [];
  while (i < L.length) {
    const m = L[i].match(/^Stage (\d+)$/);
    if (!m) break;
    const stage = Number(m[1]);
    i++;
    let note = null;
    if (L[i] && L[i].startsWith('When ')) {
      note = L[i];
      i++;
    }
    // Some stages call out a recommended damage type just above the enemy
    // grid, rendered as a lone "<Element> RES" line (e.g. "Fusion RES") —
    // that's the stage's weakness hint, not an enemy name.
    let weakness = null;
    if (L[i] && /^[A-Za-z]+ RES$/.test(L[i])) {
      weakness = L[i];
      i++;
    }
    const enemies = [];
    while (i < L.length && !/^Stage \d+$/.test(L[i])) {
      enemies.push(L[i]);
      i++;
    }
    stages.push({ stage, note, weakness, enemies });
  }
  return { mechanicName, mechanicLines, tokens, targetScores, stages };
}

async function scrapeWastes(page, season) {
  await page.goto(`https://encore.moe/whiwa/${season}`, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const areaLabels = await topTabLabels(page);
  const effectiveAreas = areaLabels.length ? areaLabels : [null];

  const areas = [];
  for (const areaLabel of effectiveAreas) {
    if (areaLabel) await clickTab(page, 'div.inline-flex.rounded-xl', areaLabel);
    const levelLabels = await subTabLabels(page);
    const effectiveLevels = levelLabels.length ? levelLabels : [null];
    const skipLabels = new Set([...areaLabels, ...levelLabels]);

    const levels = [];
    for (const levelLabel of effectiveLevels) {
      if (levelLabel) await clickTab(page, 'div.inline-flex.rounded-lg', levelLabel);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const parsed = parseWastesLevel(await mainText(page), skipLabels);
      levels.push({ level: levelLabel ? Number(levelLabel) || levelLabel : null, ...parsed });
    }
    areas.push({ title: areaLabel, levels });
  }
  return { label: `Season ${season}`, areas };
}

// ---------- Doubled Pawn Matrix ----------

function parseTitledBlocks(L, start, end) {
  const blocks = [];
  let current = null;
  for (let i = start; i < end; i++) {
    if (!L[i].endsWith('.')) {
      current = { title: L[i], lines: [] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(L[i]);
    }
  }
  return blocks;
}

function parseDpmVariant(text) {
  const L = lines(text);
  const endsLine = L.find((l) => /^Ends: /.test(l));
  const ends = endsLine ? endsLine.replace(/^Ends: /, '') : null;

  const buffsIdx = L.indexOf('Buffs');
  const scoresIdx = L.indexOf('Target Scores', buffsIdx + 1);
  const buffs = buffsIdx >= 0 && scoresIdx > buffsIdx ? parseTitledBlocks(L, buffsIdx + 1, scoresIdx) : [];

  let i = scoresIdx >= 0 ? scoresIdx + 1 : L.length;
  const targetScores = [];
  while (i < L.length && /^[\d\s.,]+$/.test(L[i])) {
    targetScores.push(toNumber(L[i]));
    i++;
  }
  if (L[i] === 'Info') i++;
  while (i < L.length && /^Round \d+$/.test(L[i])) i++;

  const charBuffsIdx = L.indexOf('Character Buffs', i);
  const bossesEnd = charBuffsIdx >= 0 ? charBuffsIdx : L.length;
  const bosses = [];
  let j = i;
  while (j < bossesEnd) {
    const name = L[j];
    j++;
    const tags = [];
    while (j < bossesEnd && L[j] !== 'Suggested Buff') {
      tags.push(L[j]);
      j++;
    }
    j++; // skip 'Suggested Buff' label
    let resistantTo = null;
    if (tags.length && / RES$/.test(tags[0])) resistantTo = tags.shift();
    // "Escalation" isn't itself a tag — it's the heading of a small group of
    // named escalation buffs that follow it (one shared "Crisis Response -
    // Pressing Advantage" plus, in multi-round variants, a boss-specific
    // "Escalation - <name>"). Pull those out into their own field instead of
    // listing "Escalation" as a flat tag alongside its own children.
    let escalationBuffs = [];
    if (tags.length && tags[0] === 'Escalation') {
      escalationBuffs = tags.slice(1);
      tags.length = 0;
    }
    // The line right after 'Suggested Buff' IS the buff category — either a
    // plain word ("General") or a heading like "Negative Statuses:" that's
    // followed by explanatory `-` bullets. Either way it's the suggested
    // buff's name; the bullets (when present) are just extra detail on it,
    // not a replacement for showing which buff is suggested.
    let suggestedBuff = null;
    const notes = [];
    if (j < bossesEnd) {
      suggestedBuff = L[j];
      const hasNotes = L[j].endsWith(':');
      j++;
      if (hasNotes) {
        while (j < bossesEnd && L[j].startsWith('-')) {
          notes.push(L[j]);
          j++;
        }
      }
    }
    bosses.push({ name, resistantTo, escalationBuffs, tags, suggestedBuff, notes });
  }

  const characterBuffs =
    charBuffsIdx >= 0
      ? parseTitledBlocks(L, charBuffsIdx + 1, L.length).map((b) => ({ name: b.title, text: b.lines.join(' ') }))
      : [];

  return { ends, buffs, targetScores, bosses, characterBuffs };
}

// "Crisis Response - Pressing Advantage" and "Escalation - <name>" render as
// small pill buttons with no visible description on the page — the actual
// text only exists in a hover tooltip the site renders into a fixed-position
// div, so this hovers each pill with Puppeteer and reads that div rather
// than something present in the static text. The tooltip names the boss
// directly (e.g. "after defeating Mourning Aix"), so it has to be captured
// per boss instance rather than cached by buff name — the same buff name
// carries a different description for each boss.
async function fetchEscalationTooltips(page, bosses) {
  const handles = await page.$$('main button.shadow-sm');
  const pillTexts = await Promise.all(handles.map((h) => h.evaluate((el) => el.textContent.trim())));
  let ptr = 0;
  for (const boss of bosses) {
    const details = [];
    for (const name of boss.escalationBuffs) {
      while (ptr < pillTexts.length && pillTexts[ptr] !== name) ptr++;
      if (ptr >= pillTexts.length) {
        details.push({ name, description: null });
        continue;
      }
      const handle = handles[ptr];
      await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      // Occasionally the first hover after a scroll doesn't register a
      // mouseenter (the tooltip is a JS hover-state component, not a native
      // title attribute) — one retry with a longer wait clears that up.
      let tooltipText = null;
      for (let attempt = 0; attempt < 2 && !tooltipText; attempt++) {
        await handle.hover();
        await new Promise((resolve) => setTimeout(resolve, 300));
        tooltipText = await page.evaluate(() => {
          const el = document.querySelector('div.fixed.pointer-events-none');
          if (!el) return null;
          return el.innerText.split('\n').slice(1).join(' ').trim() || null;
        });
      }
      details.push({ name, description: tooltipText ? translateOrKeep(tooltipText) : null });
      ptr++;
    }
    boss.escalationBuffs = details;
  }
}

async function scrapeDpm(page, dpmId) {
  await page.goto(`https://encore.moe/dpmatrix/${dpmId}`, { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const label = (await page.title()).split('|')[0].trim();
  const variantLabels = await topTabLabels(page);
  const effectiveVariants = variantLabels.length ? variantLabels : [null];

  const variants = [];
  for (const variantLabel of effectiveVariants) {
    if (variantLabel) await clickTab(page, 'div.inline-flex.rounded-xl', variantLabel);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const parsed = parseDpmVariant(await mainText(page));
    try {
      await fetchEscalationTooltips(page, parsed.bosses);
    } catch (err) {
      // Same graceful-degrade policy as the icon/token fetches: the text
      // data above is already complete and correct, so a tooltip hiccup
      // shouldn't lose it — just leave descriptions null this run.
      console.error('[fetch-mode-details] escalation tooltip fetch failed:', err);
      parsed.bosses.forEach((b) => {
        b.escalationBuffs = b.escalationBuffs.map((e) => (typeof e === 'string' ? { name: e, description: null } : e));
      });
    }
    variants.push({ title: variantLabel, ...parsed });
  }
  return { label, variants };
}

// ---------- Enemy/boss head icons ----------
//
// api-v2.encore.moe/api/en/monster's own `Icon` field points at a dead host
// (`api.encore.moe`, .png) — the site's own rendered <img> tags resolve to
// `api-v2.encore.moe`, .webp instead (found by inspecting encore.moe/monster
// live rather than trusting the API field literally). Same monster id, just
// a different host+extension, confirmed working for several samples.
function toIconUrl(rawIcon) {
  return rawIcon.replace('api.encore.moe', 'api-v2.encore.moe').replace(/\.png$/, '.webp');
}

async function fetchMonsterIndex() {
  const res = await fetch(MONSTER_API);
  const data = await res.json();
  const index = new Map();
  for (const m of data.monsterList || []) {
    index.set(m.Name, { id: m.Id, iconUrl: toIconUrl(m.Icon) });
  }
  return index;
}

async function downloadIcon(id, iconUrl) {
  const dest = path.join(ICON_DIR, `${id}.webp`);
  const exists = await fs.access(dest).then(() => true).catch(() => false);
  if (exists) return;
  const res = await fetch(iconUrl);
  if (!res.ok) return;
  await fs.mkdir(ICON_DIR, { recursive: true });
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

// Replaces bare enemy-name strings with `{name, id}` (id: null when the name
// isn't a known monster) throughout the tower/wastes trees, and adds an `id`
// field onto each DPM boss — then downloads any not-yet-cached icon for every
// id referenced, so the frontend can just point an <img> at
// /wuvochka/enemy-icons/<id>.webp.
async function attachEnemyIcons(result, monsterIndex) {
  const withId = (name) => ({ name, id: monsterIndex.get(name)?.id ?? null });

  for (const area of result.tower.areas) {
    for (const floor of area.floors) floor.enemies = floor.enemies.map(withId);
  }
  for (const area of result.wastes.areas) {
    for (const level of area.levels) {
      for (const stage of level.stages) stage.enemies = stage.enemies.map(withId);
    }
  }
  for (const variant of result.dpm.variants) {
    for (const boss of variant.bosses) boss.id = monsterIndex.get(boss.name)?.id ?? null;
  }

  const ids = new Map();
  for (const [name, info] of monsterIndex) ids.set(info.id, info.iconUrl);
  const referenced = new Set();
  const collect = (obj) => {
    if (typeof obj.id === 'number') referenced.add(obj.id);
  };
  result.tower.areas.forEach((a) => a.floors.forEach((f) => f.enemies.forEach(collect)));
  result.wastes.areas.forEach((a) => a.levels.forEach((l) => l.stages.forEach((s) => s.enemies.forEach(collect))));
  result.dpm.variants.forEach((v) => v.bosses.forEach(collect));

  for (const id of referenced) {
    const iconUrl = ids.get(id);
    if (iconUrl) await downloadIcon(id, iconUrl);
  }
}

// ---------- Wastes token details ----------
//
// The rendered Wastes page only ever shows a token's name+icon, not what it
// does — that lives on encore.moe's own per-item page (e.g. /item/71500018),
// rendered from `AttributesDescription` on `api-v2.encore.moe/api/en/item/<id>`
// (a plain JSON GET, no Puppeteer needed here). It's simple HTML (`<br>` line
// breaks, a `<span style=...>` around the occasional highlighted number) —
// stripped down to plain lines and run through the same translateLine() rules
// as everything else.
function stripItemHtml(html) {
  return html
    .split(/<br\s*\/?>/i)
    .map((line) => line.replace(/<[^>]+>/g, '').trim())
    .filter(Boolean);
}

async function fetchItemIndex() {
  const res = await fetch(ITEM_API);
  const data = await res.json();
  const index = new Map();
  for (const it of data.itemList || []) {
    index.set(it.Name, { id: it.Id, iconUrl: toIconUrl(it.Icon) });
  }
  return index;
}

async function fetchTokenDetail(name, itemIndex) {
  const info = itemIndex.get(name);
  if (!info) return { name, id: null, effect: [] };
  const res = await fetch(`${ITEM_API}/${info.id}`);
  const data = await res.json();
  const effect = stripItemHtml(data.AttributesDescription || '').map(translateOrKeep);
  await downloadIcon(info.id, info.iconUrl);
  return { name, id: info.id, effect };
}

// Replaces each level's bare token-name strings with `{name, id, effect}`,
// fetching each distinct token once (the same handful of tokens repeat
// across areas/levels within a rotation) and reusing its own icon-download
// cache/dir — tokens and monsters don't share ids, but neither do their
// filenames collide since both are just `<id>.webp` in the same directory.
async function attachTokenDetails(result) {
  const itemIndex = await fetchItemIndex();
  const cache = new Map();
  for (const area of result.wastes.areas) {
    for (const level of area.levels) {
      const resolved = [];
      for (const name of level.tokens) {
        if (!cache.has(name)) cache.set(name, await fetchTokenDetail(name, itemIndex));
        resolved.push(cache.get(name));
      }
      level.tokens = resolved;
    }
  }
}

// ---------- Entry points ----------

function translateModeDetails(result) {
  for (const area of result.tower.areas) {
    area.buffs.forEach((g) => { g.lines = g.lines.map(translateOrKeep); });
    area.targets.forEach((g) => { g.lines = g.lines.map(translateOrKeep); });
  }
  for (const area of result.wastes.areas) {
    for (const level of area.levels) {
      level.mechanicLines = level.mechanicLines.map(translateOrKeep);
      level.stages.forEach((s) => {
        if (s.note) s.note = translateOrKeep(s.note);
      });
    }
  }
  for (const variant of result.dpm.variants) {
    variant.buffs.forEach((b) => {
      b.title = translateOrKeep(b.title);
      b.lines = b.lines.map(translateOrKeep);
    });
    variant.bosses.forEach((b) => {
      b.notes = b.notes.map(translateOrKeep);
      if (b.suggestedBuff) b.suggestedBuff = translateOrKeep(b.suggestedBuff);
    });
    variant.characterBuffs.forEach((c) => {
      c.text = translateOrKeep(c.text);
    });
  }
}

export async function scrapeModeDetails(page, { towerSeason, wastesSeason, dpmId }) {
  const tower = await scrapeTower(page, towerSeason);
  const wastes = await scrapeWastes(page, wastesSeason);
  const dpm = await scrapeDpm(page, dpmId);
  const result = { updated: new Date().toISOString().slice(0, 10), tower, wastes, dpm };
  translateModeDetails(result);
  try {
    const monsterIndex = await fetchMonsterIndex();
    await attachEnemyIcons(result, monsterIndex);
  } catch (err) {
    // Icons are a nice-to-have on top of the text data above, which is
    // already complete and correct at this point — don't lose that over an
    // icon-fetch hiccup.
    console.error('[fetch-mode-details] enemy icon fetch failed, continuing without icons:', err);
  }
  try {
    await attachTokenDetails(result);
  } catch (err) {
    console.error('[fetch-mode-details] token detail fetch failed, leaving tokens as bare names:', err);
  }
  return result;
}

export async function writeModeDetails(result) {
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(result, null, 1));
  console.log('[fetch-mode-details] wrote', OUT_PATH);
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  try {
    const towerSeason = await currentNumber(page, 'https://encore.moe/toa', /\/toa\/(\d+)/);
    const wastesSeason = await currentNumber(page, 'https://encore.moe/whiwa', /\/whiwa\/(\d+)/);
    const dpmId = await currentNumber(page, 'https://encore.moe/dpmatrix', /\/dpmatrix\/(\d+)/);
    const result = await scrapeModeDetails(page, { towerSeason, wastesSeason, dpmId });
    await writeModeDetails(result);
  } finally {
    await browser.close();
  }
}

// Only auto-run when invoked directly (`node scripts/fetch-mode-details.mjs`),
// not when fetch-boss-modes.mjs imports scrapeModeDetails from this file.
if (path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error('[fetch-mode-details] failed, leaving previous data/wuvochka-mode-details.json untouched:', err);
    process.exit(1);
  });
}
