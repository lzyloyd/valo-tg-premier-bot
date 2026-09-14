import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'D:/Tg-Results-Bot';
const HTML_PATH = `${ROOT}/scratch/wuvochka-concept.html`;
const CHARACTERS = JSON.parse(readFileSync(`${ROOT}/src/miniapp-public/wuwa-assets/characters/index.json`, 'utf8')).map(
  (c) => ({ id: c.id, name: c.name, element: c.element, weaponType: c.weaponType, rarity: c.rarity }),
);

const WEAPON_FACTS = {
  21020016: {
    name: 'Blazing Brilliance',
    weaponType: 'Sword',
    rarity: 5,
    passiveName: 'Crimson Phoenix',
    passiveDesc:
      'АТК увеличивается на 12%/15%/18%/21%/24%. При нанесении урона персонаж получает 1 заряд эффекта «Пылающее перо» (не чаще раза в 0.5с), а при использовании навыка резонанса — сразу 5 зарядов. Каждый заряд даёт 4%/5%/6%/7%/8% доп. урона навыка резонанса, максимум 14 зарядов. По достижении максимума все заряды снимаются через 12 секунд.',
    flavor:
      'Выковано из самой сути и перьев легендарной птицы — этот клинок пылает светом, что заливает мир своим сиянием. С каждой вспышкой огня он обращает всё на своём пути в пепел.',
  },
  21020015: {
    name: 'Emerald of Genesis',
    weaponType: 'Sword',
    rarity: 5,
    passiveName: 'Stormy Resolution',
    passiveDesc:
      'Восстановление энергии увеличивается на 12.8%/16%/19.2%/22.4%/25.6%. При использовании навыка резонанса АТК увеличивается на 6%/7.5%/9%/10.5%/12%, эффект стакается до 2 раз и длится 10 секунд.',
    flavor:
      'Внимайте: ледяной клинок таит в себе стремительное течение, сплетающееся в водоворот мыслей. Обратите эту грозную силу против врагов.',
  },
};

const WEAPON_TYPE_RU = {
  Sword: 'Меч',
  Broadblade: 'Клинок',
  Pistols: 'Пистолеты',
  Gauntlets: 'Перчатки',
  Rectifier: 'Ректификатор',
};

let html = readFileSync(HTML_PATH, 'utf8');
const NL = '\r\n';

// ---------------------------------------------------------------------------
// 1) Data + translation tables, as a script block right after the app markup.
// ---------------------------------------------------------------------------
const dataScript = `<script>
const CHARACTERS = ${JSON.stringify(CHARACTERS)};
const WEAPON_FACTS = ${JSON.stringify(WEAPON_FACTS)};
const WEAPON_TYPE_RU = ${JSON.stringify(WEAPON_TYPE_RU)};
</script>`;

const scriptOpenAnchor = '<script>' + NL + "document.querySelectorAll('.tab')";
if (!html.includes(scriptOpenAnchor)) throw new Error('main <script> anchor not found');
html = html.replace(scriptOpenAnchor, dataScript + NL + NL + scriptOpenAnchor);

// ---------------------------------------------------------------------------
// 2) Generic character-detail view (facts + "coming soon" placeholders),
//    inserted right after the curated Aemeath detail view.
// ---------------------------------------------------------------------------
const genericView = `
  <!-- CHARACTER DETAIL (GENERIC — any character without a hand-written page yet) -->
  <div class="view" id="view-detail-generic">
    <div class="screen">
      <div class="back-row" onclick="closeChar()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        Персонажи
      </div>

      <div class="char-hero">
        <div class="portrait hero" id="g-portrait"><img class="portrait-img" id="g-portrait-img" src="" alt=""><span class="ring"></span></div>
        <div>
          <h2 id="g-name"></h2>
          <div class="hero-tags">
            <div class="hero-tag"><span class="el-dot" id="g-el-dot"></span><span id="g-element"></span></div>
            <div class="hero-tag" id="g-weapon"></div>
            <div class="hero-tag" id="g-rarity"></div>
          </div>
        </div>
      </div>

      <div class="subtabs">
        <button class="subtab-g active" data-subg="kit">Кит</button>
        <button class="subtab-g" data-subg="review">Обзор</button>
        <button class="subtab-g" data-subg="build">Билд</button>
        <button class="subtab-g" data-subg="gameplay">Геймплей</button>
        <button class="subtab-g" data-subg="calc">Расчёты</button>
      </div>

      <div class="subview-g active" id="subg-kit">
        <div class="card">
          <h3>Основные данные</h3>
          <div class="pill-list">
            <div class="pill">Элемент: <b id="g-fact-element"></b></div>
            <div class="pill">Оружие: <b id="g-fact-weapon"></b></div>
            <div class="pill">Редкость: <b id="g-fact-rarity"></b></div>
          </div>
        </div>
        <div class="card">
          <h3>Разбор навыков</h3>
          <div class="review-text">Подробный разбор активных и пассивных навыков появится здесь, когда мы разберём кит этого персонажа.</div>
        </div>
      </div>
      <div class="subview-g" id="subg-review">
        <div class="card"><h3>Обзор</h3><div class="review-text">Оценки, плюсы и минусы появятся здесь, когда мы разберём гайды по этому персонажу.</div></div>
      </div>
      <div class="subview-g" id="subg-build">
        <div class="card"><h3>Билд</h3><div class="review-text">Рекомендации по оружию, эхо и характеристикам появятся здесь позже.</div></div>
      </div>
      <div class="subview-g" id="subg-gameplay">
        <div class="card"><h3>Геймплей</h3><div class="review-text">Ротация и синергии с другими персонажами появятся здесь позже.</div></div>
      </div>
      <div class="subview-g" id="subg-calc">
        <div class="card"><h3>Расчёты</h3><div class="review-text">Расчёты урона за ротацию появятся здесь позже.</div></div>
      </div>
    </div>
  </div>

  <!-- WEAPON DETAIL -->
  <div class="view" id="view-weapon">
    <div class="screen">
      <div class="back-row" onclick="closeWeapon()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        Назад
      </div>

      <div class="char-hero">
        <div class="portrait hero"><img class="portrait-img" id="w-portrait-img" src="" alt=""><span class="ring"></span></div>
        <div>
          <h2 id="w-name"></h2>
          <div class="hero-tags">
            <div class="hero-tag" id="w-type"></div>
            <div class="hero-tag" id="w-rarity"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3 id="w-passive-name"></h3>
        <div class="review-text" id="w-passive-desc"></div>
      </div>
      <div class="card">
        <h3>Описание</h3>
        <div class="review-text" id="w-flavor"></div>
      </div>
    </div>
  </div>
`.replace(/\n/g, NL);

const insertAfterAnchor = '  </div>' + NL + NL + '  <div class="credit-bar">';
if (!html.includes(insertAfterAnchor)) throw new Error('credit-bar anchor not found');
// Preserve the "</div>" that closes #view-detail itself — only splice the new
// views in between it and the credit bar.
html = html.replace(insertAfterAnchor, '  </div>' + genericView + NL + '  <div class="credit-bar">');

writeFileSync(HTML_PATH, html, 'utf8');
console.log('markup injected, size now', html.length, 'bytes');
