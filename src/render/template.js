function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  });
}

// Sides swap at halftime (after round 12), then every 2 rounds once a match
// reaches overtime (round 24+) — but never after the match's last round.
function isSideSwitchAfter(round, isLastRound) {
  if (isLastRound) return false;
  return round === 12 || (round > 12 && round >= 24 && round % 2 === 0);
}

// tracker.gg's own round-outcome icons — pre-colored (teal for a win, coral
// for a loss) rather than a neutral glyph we'd have to tint ourselves.
const ROUND_ICON_BASE = 'https://trackercdn.com/cdn/tracker.gg/valorant/icons';
const ROUND_ICON_FILES = {
  Elimination: 'elimination',
  Defuse: 'diffuse', // tracker.gg's own spelling of the asset name
  Detonate: 'explosion',
  Time: 'time',
};

function roundIconUrl(result, won) {
  const file = ROUND_ICON_FILES[result] ?? ROUND_ICON_FILES.Elimination;
  return `${ROUND_ICON_BASE}/${file}${won ? 'win' : 'loss'}1.png`;
}

const ROUND_LABEL = 140;
const ROUND_SWITCH = 15;
const ROUND_GAP = 4;
const ROUND_CELL_MIN = 18;
const ROUND_CELL_MAX = 26;
// #card is CARD_WIDTH wide with 22px padding on each side (see below).
const ROUNDS_INNER_WIDTH = 840 - 44;

function roundsStrip(match) {
  const slots = [];
  match.rounds.forEach((r, i) => {
    slots.push({ kind: 'round', round: r });
    const isLastRound = i === match.rounds.length - 1;
    if (isSideSwitchAfter(r.round, isLastRound)) slots.push({ kind: 'switch' });
  });

  // Cell size shrinks a little for a long (or overtime) match instead of
  // overflowing the fixed-width card — sized to always fit ROUNDS_INNER_WIDTH.
  const switchCount = slots.filter((s) => s.kind === 'switch').length;
  const roundCount = slots.length - switchCount;
  const gapTotal = slots.length * ROUND_GAP;
  const availableForCells = ROUNDS_INNER_WIDTH - ROUND_LABEL - gapTotal - switchCount * ROUND_SWITCH;
  const cellSize = Math.min(ROUND_CELL_MAX, Math.max(ROUND_CELL_MIN, Math.floor(availableForCells / roundCount)));

  const colWidths = slots.map((s) => (s.kind === 'switch' ? ROUND_SWITCH : cellSize));
  const gridTemplateColumns = `${ROUND_LABEL}px ${colWidths.map((w) => `${w}px`).join(' ')}`;

  const ourCells = [];
  const theirCells = [];
  const numbers = [];
  const switches = [];

  slots.forEach((s, i) => {
    const col = i + 2; // column 1 is the team-label column
    if (s.kind === 'switch') {
      switches.push(
        `<div class="sb-round-switch" style="grid-column:${col};grid-row:1 / span 2" title="Смена сторон">` +
          '<svg viewBox="0 0 20 20" width="13" height="13">' +
          '<path d="M4 7h10l-3-3M16 13H6l3 3" fill="none" stroke="#7383a3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg></div>',
      );
      return;
    }
    const { round } = s;
    const ourIcon = round.won ? `<img src="${roundIconUrl(round.result, true)}" alt="" />` : '';
    const theirIcon = round.won ? '' : `<img src="${roundIconUrl(round.result, false)}" alt="" />`;
    ourCells.push(
      `<div class="sb-round-cell${round.won ? '' : ' empty'}" style="grid-column:${col};grid-row:1">${ourIcon}</div>`,
    );
    theirCells.push(
      `<div class="sb-round-cell${round.won ? ' empty' : ''}" style="grid-column:${col};grid-row:2">${theirIcon}</div>`,
    );
    numbers.push(`<div class="sb-round-num" style="grid-column:${col};grid-row:3">${round.round}</div>`);
  });

  const teamLabel = (name, logoUrl, row) => `
    <div class="sb-rounds-team" style="grid-column:1;grid-row:${row}">
      ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" />` : ''}
      <span>${escapeHtml(name)}</span>
    </div>`;

  return `
    <div class="sb-rounds" style="grid-template-columns:${gridTemplateColumns}">
      ${teamLabel(match.ourTeamName, match.ourTeamLogoUrl, 1)}
      ${teamLabel(match.theirTeamName, match.theirTeamLogoUrl, 2)}
      ${ourCells.join('')}
      ${theirCells.join('')}
      ${switches.join('')}
      ${numbers.join('')}
    </div>`;
}

function signed(value) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value)}`;
}

function signedColor(value) {
  return value > 0 ? 'var(--win)' : value < 0 ? 'var(--loss)' : 'var(--muted)';
}

function playerRow(p) {
  return `
    <div class="sb-row">
      <div class="sb-avatar-wrap">
        <img class="sb-avatar" src="${escapeHtml(p.agentImageUrl)}" style="background:${escapeHtml(p.agentColor)}" alt="" />
        <img class="sb-rank-badge" src="${escapeHtml(p.rankIconUrl)}" title="${escapeHtml(p.rankName)}" alt="" />
      </div>
      <div class="sb-name">${escapeHtml(p.name)}</div>
      <div class="sb-trs">${p.trs}</div>
      <div></div>
      <div class="sb-acs">${p.acs}</div>
      <div class="sb-num">${p.kills}</div>
      <div class="sb-num">${p.deaths}</div>
      <div class="sb-num">${p.assists}</div>
      <div class="sb-num" style="color:${signedColor(p.plusMinus)}">${signed(p.plusMinus)}</div>
      <div class="sb-num sb-muted">${p.adr}</div>
      <div class="sb-num" style="color:${signedColor(p.ddelta)}">${signed(p.ddelta)}</div>
      <div class="sb-num sb-muted">${p.hsAccuracy}%</div>
      <div class="sb-num sb-muted">${p.kast}%</div>
      <div class="sb-num sb-muted">${p.firstKills}</div>
      <div class="sb-num sb-muted">${p.firstDeaths}</div>
    </div>`;
}

function teamBlock({ side, teamName, logoUrl, rank, divisionName, players, avgRankName, avgRankIconUrl }) {
  const standing = rank ? `#${rank}${divisionName ? ` · ${escapeHtml(divisionName)}` : ''}` : '';
  return `
    <div class="sb-team ${side}">
      <div class="sb-team-label">
        <div class="sb-team-identity">
          ${logoUrl ? `<img class="sb-team-logo" src="${escapeHtml(logoUrl)}" alt="" />` : ''}
          <div class="sb-team-name-wrap">
            <div class="sb-team-name">${escapeHtml(teamName)}</div>
            ${standing ? `<div class="sb-team-standing">${standing}</div>` : ''}
          </div>
        </div>
        <div class="sb-team-rank">
          <div class="sb-team-rank-info">
            <div class="sb-team-rank-label">Ср. ранг</div>
            <div class="sb-team-rank-value">${escapeHtml(avgRankName)}</div>
          </div>
          <img src="${escapeHtml(avgRankIconUrl)}" alt="" />
        </div>
      </div>
      <div class="sb-row sb-hd"><span></span><span>Игрок</span><span class="sb-trs">TRS</span><span></span><span class="sb-acs">ACS</span><span class="sb-num">K</span><span class="sb-num">D</span><span class="sb-num">A</span><span class="sb-num">+/-</span><span class="sb-num">ADR</span><span class="sb-num">DDΔ</span><span class="sb-num">HS%</span><span class="sb-num">KAST</span><span class="sb-num">FK</span><span class="sb-num">FD</span></div>
      ${players.map(playerRow).join('')}
    </div>`;
}

function mvpBlock(mvp) {
  return `
    <div class="sb-mvp">
      <div class="sb-mvp-label">Лучший игрок команды</div>
      <div class="sb-mvp-body">
        <img class="sb-mvp-avatar" src="${escapeHtml(mvp.agentImageUrl)}" style="background:${escapeHtml(mvp.agentColor)}" alt="" />
        <div class="sb-mvp-info">
          <div class="sb-mvp-name">${escapeHtml(mvp.name)}</div>
          <div class="sb-mvp-sub">${escapeHtml(mvp.agentName)} · ACS ${mvp.acs} · ${mvp.kills}/${mvp.deaths}/${mvp.assists} · KAST ${mvp.kast}%</div>
        </div>
        <div class="sb-mvp-trs">
          <div class="sb-mvp-trs-num">${mvp.trs}</div>
          <div class="sb-mvp-trs-lbl">TRS</div>
        </div>
      </div>
    </div>`;
}

export function buildScoreboardHtml(match) {
  const won = match.won;
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
:root{
  --win:#3ddb8a; --loss:#ff6b83; --muted:#7383a3;
}
body{background:#0e1621;font-family:'Manrope',sans-serif;}
#card{width:840px;background:linear-gradient(180deg,#141b26,#101620);border-radius:14px;overflow:hidden;border:1px solid #232d3a;}
.sb-head{
  display:flex;align-items:center;justify-content:space-between;padding:24px 22px;min-height:88px;
  background-size:cover;background-position:center;border-bottom:1px solid #232d3a;
}
.sb-map{font-weight:800;font-size:20px;color:#eef2f6;text-shadow:0 1px 4px rgba(0,0,0,.5);}
.sb-sub{font-size:12.5px;color:#c3ccd8;margin-top:4px;font-family:'JetBrains Mono',monospace;text-shadow:0 1px 4px rgba(0,0,0,.5);}
.sb-score-wrap{text-align:right;}
.sb-result{font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;margin-bottom:2px;color:${won ? 'var(--win)' : 'var(--loss)'};text-shadow:0 1px 4px rgba(0,0,0,.5);}
.sb-score{font-family:'JetBrains Mono',monospace;font-weight:800;font-size:27px;text-shadow:0 1px 4px rgba(0,0,0,.5);}
.sb-score .a{color:${won ? 'var(--win)' : 'var(--loss)'}}
.sb-score .b{color:#c3ccd8}
.sb-rounds{display:grid;row-gap:8px;column-gap:4px;align-items:center;padding:16px 22px;border-bottom:1px solid #232d3a;overflow-x:auto;}
.sb-rounds-team{display:flex;align-items:center;gap:8px;min-width:0;padding-right:10px;}
.sb-rounds-team img{width:20px;height:20px;border-radius:4px;object-fit:contain;flex-shrink:0;}
.sb-rounds-team span{font-size:12px;font-weight:700;color:#c9d4e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sb-round-cell{aspect-ratio:1;display:flex;align-items:center;justify-content:center;}
.sb-round-cell img{width:88%;height:88%;object-fit:contain;}
.sb-round-cell.empty::after{content:"";width:5px;height:5px;border-radius:50%;background:#2a3442;}
.sb-round-num{text-align:center;font-size:10px;color:#5b6b80;font-family:'JetBrains Mono',monospace;}
.sb-round-switch{display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:15px;line-height:1;}
.sb-team{border-left:4px solid transparent;}
.sb-team.winner{border-left-color:#39d6c9;}
.sb-team.loser{border-left-color:#ff4655;}
.sb-team-label{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px 12px;}
.sb-team-identity{display:flex;align-items:center;gap:12px;min-width:0;}
.sb-team-logo{width:38px;height:38px;border-radius:8px;object-fit:contain;flex-shrink:0;}
.sb-team-name-wrap{min-width:0;}
.sb-team-name{font-size:17px;font-weight:800;color:#eef2f6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sb-team-standing{font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px;}
.sb-team-rank{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.sb-team-rank-info{text-align:right;}
.sb-team-rank-label{font-size:9px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);line-height:1;}
.sb-team-rank-value{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:700;color:#c9d4e0;margin-top:2px;}
.sb-team-rank img{width:22px;height:22px;flex-shrink:0;}
.sb-row{display:grid;grid-template-columns:32px 1fr 38px 10px 42px 28px 28px 28px 38px 38px 38px 34px 42px 26px 26px;gap:11px;align-items:center;padding:7px 22px;font-size:13.5px;font-family:'JetBrains Mono',monospace;color:#c9d4e0;}
.sb-avatar-wrap{position:relative;width:32px;height:32px;}
.sb-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;display:block;}
.sb-rank-badge{position:absolute;bottom:-3px;right:-3px;width:15px;height:15px;border-radius:50%;background:#141b26;border:1px solid #141b26;object-fit:contain;}
.sb-name{font-family:'Manrope',sans-serif;font-weight:700;color:#e8ecf2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sb-trs{font-weight:800;color:#eef2f6;text-align:center;font-variant-numeric:tabular-nums;}
.sb-acs{font-weight:800;color:#eef2f6;text-align:center;font-variant-numeric:tabular-nums;}
.sb-num{text-align:center;font-variant-numeric:tabular-nums;}
.sb-muted{color:var(--muted);}
.sb-hd{color:#4c5a70;font-size:10.5px;text-transform:uppercase;padding-top:4px;padding-bottom:6px;}
.sb-hd .sb-num,.sb-hd .sb-acs,.sb-hd .sb-trs{font-weight:600;color:inherit;}
.sb-mvp{margin:14px 22px 18px;background:linear-gradient(135deg,rgba(255,209,102,.14),rgba(255,209,102,.04));border:1px solid rgba(255,209,102,.35);border-radius:10px;padding:12px 16px;}
.sb-mvp-label{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#ffd166;margin-bottom:8px;}
.sb-mvp-body{display:flex;align-items:center;gap:12px;}
.sb-mvp-avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid #ffd166;flex-shrink:0;}
.sb-mvp-info{flex:1;min-width:0;}
.sb-mvp-name{font-family:'Manrope',sans-serif;font-weight:800;font-size:15px;color:#f4f6fa;}
.sb-mvp-sub{font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sb-mvp-trs{text-align:right;flex-shrink:0;}
.sb-mvp-trs-num{font-family:'JetBrains Mono',monospace;font-weight:800;font-size:22px;color:#ffd166;line-height:1;}
.sb-mvp-trs-lbl{font-size:9.5px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase;margin-top:2px;}
</style></head>
<body>
<div id="card">
  <div class="sb-head" style="background-image:linear-gradient(180deg, rgba(14,22,33,.55), rgba(14,22,33,.94)), url('${escapeHtml(match.mapImageUrl)}')">
    <div>
      <div class="sb-map">${escapeHtml(match.mapName)}</div>
      <div class="sb-sub">${formatDate(match.dateStarted)} · Premier · ${escapeHtml(match.durationText)}</div>
    </div>
    <div class="sb-score-wrap">
      <div class="sb-result">${won ? 'Победа' : 'Поражение'}</div>
      <div class="sb-score"><span class="a">${match.ourScore}</span> <span class="b">:</span> <span class="b">${match.theirScore}</span></div>
    </div>
  </div>
  ${roundsStrip(match)}
  ${teamBlock({
    side: match.won ? 'winner' : 'loser',
    teamName: match.ourTeamName,
    logoUrl: match.ourTeamLogoUrl,
    rank: match.ourTeamRank,
    divisionName: match.ourTeamDivision,
    players: match.ourTeam,
    avgRankName: match.ourTeamAvgRankName,
    avgRankIconUrl: match.ourTeamAvgRankIconUrl,
  })}
  ${teamBlock({
    side: match.won ? 'loser' : 'winner',
    teamName: match.theirTeamName,
    logoUrl: match.theirTeamLogoUrl,
    rank: match.theirTeamRank,
    divisionName: match.theirTeamDivision,
    players: match.theirTeam,
    avgRankName: match.theirTeamAvgRankName,
    avgRankIconUrl: match.theirTeamAvgRankIconUrl,
  })}
  ${mvpBlock(match.mvp)}
</div>
</body></html>`;
}
