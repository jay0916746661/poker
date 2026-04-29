"use strict";

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_TEXT = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const POSITIONS = ["BTN", "SB", "BB", "UTG", "UTG+1", "MP", "LJ", "HJ", "CO"];
const PLAYER_TEMPLATES = [
  { name: "Luna", style: "緊兇", tight: .68, aggro: .72 },
  { name: "Ken", style: "鬆兇", tight: .42, aggro: .82 },
  { name: "Mika", style: "跟注站", tight: .38, aggro: .28 },
  { name: "Ray", style: "穩健", tight: .62, aggro: .48 },
  { name: "Ivy", style: "偷盲型", tight: .48, aggro: .66 },
  { name: "Nate", style: "深籌碼", tight: .58, aggro: .54 },
  { name: "Sora", style: "小球派", tight: .52, aggro: .38 },
  { name: "你", style: "Hero", tight: .5, aggro: .5, hero: true },
  { name: "Alex", style: "壓力型", tight: .46, aggro: .76 }
];

const app = {
  tables: [],
  activeTableId: 1,
  nextTableId: 1,
  displayMode: "chips",
  cashRate: .01,
  totalHands: 0,
  totalProfit: 0,
  completedHands: [],
  reviewNo: 0
};

const $ = (id) => document.getElementById(id);
const el = {
  tablesGrid: $("tablesGrid"),
  totalHands: $("totalHands"),
  totalProfit: $("totalProfit"),
  tableCount: $("tableCount"),
  displayModeText: $("displayModeText"),
  displayMode: $("displayMode"),
  cashRate: $("cashRate"),
  autoInsurance: $("autoInsurance"),
  addTableBtn: $("addTableBtn"),
  allTablesBtn: $("allTablesBtn"),
  newHandBtn: $("newHandBtn"),
  statusText: $("statusText"),
  activeTableText: $("activeTableText"),
  log: $("log"),
  analysis: $("analysis"),
  review: $("review"),
  advice: $("advice"),
  foldBtn: $("foldBtn"),
  checkCallBtn: $("checkCallBtn"),
  raiseBtn: $("raiseBtn"),
  allInBtn: $("allInBtn"),
  insuranceBtn: $("insuranceBtn"),
  skipInsuranceBtn: $("skipInsuranceBtn"),
  adviceBtn: $("adviceBtn"),
  raiseAmount: $("raiseAmount")
};

function createTable(id) {
  return {
    id,
    handNo: 1,
    dealer: (id - 1) % PLAYER_TEMPLATES.length,
    smallBlind: 10,
    bigBlind: 20,
    deck: [],
    board: [],
    players: PLAYER_TEMPLATES.map((p) => ({ ...p, stack: 1500, cards: [], folded: false, allIn: false, bet: 0, committed: 0, position: "", lastAction: "", winner: false })),
    pot: 0,
    street: "idle",
    currentBet: 0,
    currentIndex: 0,
    actedSinceRaise: new Set(),
    pending: false,
    thinkingIndex: -1,
    actionToken: 0,
    handLog: [],
    actionHistory: [],
    lastRaise: 20,
    analysisHtml: "<p>完成一手後會顯示勝負、牌型、位置、彩池賠率、保險結果與下次建議。</p>",
    insurance: null,
    awaitingInsurance: false,
    heroExtraCost: 0
  };
}

function activeTable() {
  return app.tables.find((t) => t.id === app.activeTableId) || app.tables[0];
}

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardText(card) {
  return `${RANK_TEXT[card.rank] || card.rank}${card.suit}`;
}

function streetName(street) {
  return { idle: "等待", preflop: "翻前", flop: "翻牌", turn: "轉牌", river: "河牌", showdown: "攤牌" }[street] || street;
}

function money(value, table = activeTable()) {
  if (app.displayMode === "bb") return `${(value / table.bigBlind).toFixed(1)} BB`;
  if (app.displayMode === "cash") return `$${(value * app.cashRate).toFixed(2)}`;
  return String(value);
}

function assignPositions(table) {
  for (let offset = 0; offset < table.players.length; offset++) {
    const idx = (table.dealer + offset) % table.players.length;
    table.players[idx].position = POSITIONS[offset];
  }
}

function playerByPos(table, pos) {
  return table.players.findIndex((p) => p.position === pos);
}

function activePlayers(table) {
  return table.players.filter((p) => !p.folded);
}

function playersAbleToAct(table) {
  return table.players.filter((p) => !p.folded && !p.allIn && p.stack > 0);
}

function nextActiveIndex(table, from, includeAllIn = false) {
  for (let step = 1; step <= table.players.length; step++) {
    const idx = (from + step) % table.players.length;
    const p = table.players[idx];
    if (!p.folded && (includeAllIn || !p.allIn)) return idx;
  }
  return -1;
}

function log(table, message) {
  table.handLog.unshift(message);
  if (table.handLog.length > 80) table.handLog.pop();
}

function renderCard(card, hidden = false) {
  const text = hidden ? "" : cardText(card);
  const red = card && (card.suit === "♥" || card.suit === "♦") ? " red" : "";
  return `<div class="card${hidden ? " back" : red}">${text}</div>`;
}

function render() {
  const urgent = app.tables.find(tableNeedsHeroAction);
  if (urgent && !tableNeedsHeroAction(activeTable())) app.activeTableId = urgent.id;
  el.tablesGrid.innerHTML = app.tables.map(renderTable).join("");
  document.querySelectorAll(".table-card").forEach((node) => {
    node.addEventListener("click", () => {
      app.activeTableId = Number(node.dataset.tableId);
      render();
    });
  });
  renderLobby();
  renderSidePanels();
  updateButtons();
}

function renderTable(table) {
  const isActive = table.id === app.activeTableId;
  const needsAction = tableNeedsHeroAction(table);
  const hero = table.players.find((p) => p.hero);
  const heroDelta = hero ? hero.stack - 1500 : 0;
  const board = Array.from({ length: 5 }, (_, i) => table.board[i] ? renderCard(table.board[i]) : `<div class="card back"></div>`).join("");
  const seats = table.players.map((p, idx) => renderSeat(table, p, idx)).join("");
  return `
    <article class="table-card${isActive ? " selected" : ""}${needsAction ? " needs-action" : ""}" data-table-id="${table.id}">
      <header class="table-head">
        <div>
          <strong>Table ${table.id}</strong>
          <span>${streetName(table.street)} · Hand ${table.handNo}</span>
        </div>
        <div class="table-stats">
          <span>盲注 ${money(table.smallBlind, table)} / ${money(table.bigBlind, table)}</span>
          <span>Hero ${heroDelta >= 0 ? "+" : ""}${money(heroDelta, table)}</span>
        </div>
      </header>
      <div class="felt">
        <div class="board-panel">
          <div class="label">Pot ${money(table.pot, table)}</div>
          ${renderPotChips(table)}
          <div class="cards board">${board}</div>
          ${table.insurance ? `<div class="insurance-pill">保險 ${money(table.insurance.premium, table)}</div>` : ""}
        </div>
        ${seats}
      </div>
    </article>
  `;
}

function renderSeat(table, p, idx) {
  const showCards = p.hero || table.street === "showdown" || (!p.folded && activePlayers(table).length === 1);
  const cls = [
    "seat",
    `seat-${idx}`,
    p.hero ? "hero-seat" : "",
    idx === table.currentIndex && table.pending ? "active" : "",
    idx === table.thinkingIndex ? "thinking" : "",
    p.folded ? "folded" : "",
    p.winner ? "winner" : ""
  ].filter(Boolean).join(" ");
  return `
    <div class="${cls}">
      ${p.position === "BTN" ? '<div class="dealer-button">D</div>' : ""}
      ${p.position === "SB" || p.position === "BB" ? `<div class="blind-button">${p.position}</div>` : ""}
      <div class="seat-head"><span class="name">${p.name}</span><span class="pos">${p.position || "--"}</span></div>
      <div class="stackline">${money(p.stack, table)} · 投入 ${money(p.committed, table)}</div>
      ${renderChipStack(p.stack)}
      <div class="betline">本輪 <strong>${money(p.bet, table)}</strong>${p.allIn ? " · All-in" : ""}</div>
      ${p.bet > 0 ? `<div class="bet-chips">${renderChipStack(p.bet, "bet")}</div>` : ""}
      <div class="cards">${p.cards.map((c) => renderCard(c, !showCards)).join("")}</div>
      <div class="tell">${p.folded ? "已棄牌" : p.lastAction || p.style}</div>
      ${idx === table.thinkingIndex ? '<div class="thinking-dots"><span></span><span></span><span></span></div>' : ""}
    </div>
  `;
}

function renderPotChips(table) {
  if (table.pot <= 0) return '<div class="pot-chips empty-pot">No pot</div>';
  return `<div class="pot-chips">${renderChipStack(table.pot, "pot")}</div>`;
}

function renderChipStack(amount, variant = "stack") {
  const chips = chipBreakdown(amount);
  return `
    <div class="chip-stack ${variant}" aria-label="籌碼 ${amount}">
      ${chips.map((chip, idx) => `<span class="chip chip-${chip.color}" style="--col:${idx % 7}; --row:${Math.floor(idx / 7)}"></span>`).join("")}
    </div>
  `;
}

function chipBreakdown(amount) {
  if (amount <= 0) return [];
  const values = [
    { value: 500, color: "black" },
    { value: 100, color: "green" },
    { value: 25, color: "blue" },
    { value: 5, color: "red" },
    { value: 1, color: "white" }
  ];
  const chips = [];
  let remaining = Math.max(1, Math.round(amount));
  for (const item of values) {
    const count = Math.min(5, Math.floor(remaining / item.value));
    for (let i = 0; i < count; i++) chips.push({ color: item.color });
    remaining -= count * item.value;
  }
  if (!chips.length) chips.push({ color: "white" });
  return chips.slice(0, 14);
}

function renderLobby() {
  el.totalHands.textContent = app.totalHands;
  el.totalProfit.textContent = money(app.totalProfit);
  el.tableCount.textContent = `${app.tables.length} / 4`;
  el.displayModeText.textContent = { chips: "籌碼", bb: "BB 數", cash: "現金" }[app.displayMode];
  el.addTableBtn.disabled = app.tables.length >= 4;
  el.allTablesBtn.disabled = app.tables.every((t) => t.pending || t.awaitingInsurance) && app.tables.length >= 4;
  const table = activeTable();
  el.activeTableText.textContent = table ? `目前桌：Table ${table.id}` : "目前桌：無";
}

function renderSidePanels() {
  const table = activeTable();
  if (!table) return;
  el.log.innerHTML = table.handLog.map((item) => `<div>${item}</div>`).join("");
  el.analysis.innerHTML = table.analysisHtml;
}

function updateButtons() {
  const table = activeTable();
  const hero = table?.players.find((p) => p.hero);
  const heroTurn = table?.pending && hero && table.players[table.currentIndex] === hero && !hero.folded && !hero.allIn;
  const callAmount = hero ? Math.max(0, table.currentBet - hero.bet) : 0;
  el.newHandBtn.disabled = !table || table.pending || table.awaitingInsurance;
  el.foldBtn.disabled = !heroTurn;
  el.checkCallBtn.disabled = !heroTurn;
  el.raiseBtn.disabled = !heroTurn || !hero || hero.stack <= callAmount;
  el.allInBtn.disabled = !heroTurn || !hero || hero.stack <= 0;
  el.raiseAmount.disabled = !heroTurn;
  el.checkCallBtn.textContent = callAmount > 0 ? `跟注 ${money(Math.min(callAmount, hero.stack), table)}` : "過牌";
  el.insuranceBtn.disabled = !canOfferInsurance(table);
  el.skipInsuranceBtn.disabled = !table?.awaitingInsurance;
  el.insuranceBtn.textContent = canOfferInsurance(table) ? `買保險 ${money(Math.ceil(table.pot * .05), table)}` : "買保險";
  el.skipInsuranceBtn.textContent = table?.awaitingInsurance ? "不買，直接開牌" : "不買保險";
  el.adviceBtn.disabled = !table;
  if (!table) return;
  const waitingTables = app.tables.filter(tableNeedsHeroAction).map((t) => `Table ${t.id}`);
  if (waitingTables.length > 1) {
    el.statusText.textContent = `需要行動：${waitingTables.join("、")}。`;
  } else if (table.awaitingInsurance) {
    el.statusText.textContent = `Table ${table.id}: Hero 已 All-in，可選擇買保險或直接開牌。`;
  } else if (table.thinkingIndex >= 0) {
    const p = table.players[table.thinkingIndex];
    el.statusText.textContent = `Table ${table.id}: ${p.name} ${p.position} 正在思考...`;
  } else if (heroTurn) {
    el.statusText.textContent = callAmount > 0 ? `Table ${table.id}: 輪到你，面對 ${money(callAmount, table)}。` : `Table ${table.id}: 輪到你，可過牌或下注。`;
  } else if (table.pending) {
    el.statusText.textContent = `Table ${table.id}: 等待模擬玩家。`;
  } else {
    el.statusText.textContent = `Table ${table.id}: 可以開始新一手。`;
  }
}

function tableNeedsHeroAction(table) {
  if (!table) return false;
  const hero = table.players.find((p) => p.hero);
  const heroTurn = table.pending && hero && table.players[table.currentIndex] === hero && !hero.folded && !hero.allIn;
  return !!heroTurn || table.awaitingInsurance;
}

function showAdvice() {
  const table = activeTable();
  if (!table) return;
  el.advice.innerHTML = buildAdvice(table);
}

function buildAdvice(table) {
  const hero = table.players.find((p) => p.hero);
  const waiting = app.tables.filter(tableNeedsHeroAction).map((t) => t.id);
  if (!hero) return "<p>找不到 Hero 座位，請重新整理頁面。</p>";
  if (waiting.length > 1 && !waiting.includes(table.id)) {
    return `<p><span class="badge">優先順序</span>先處理 Table ${waiting[0]}，那桌正在等你行動。</p>`;
  }
  if (table.awaitingInsurance) return buildInsuranceAdvice(table, hero);
  if (table.street === "idle") return `<p><span class="badge">開局</span>Table ${table.id} 還沒發牌。可按「目前桌發牌」或「四桌同時開打」。</p>`;
  if (table.street === "showdown" || !table.pending) return `<p><span class="badge">本手結束</span>這手已結束，先看打完解析；下一手重新觀察位置與有效籌碼。</p>`;

  const heroTurn = table.players[table.currentIndex] === hero && !hero.folded && !hero.allIn;
  if (!heroTurn) {
    const next = table.players[table.currentIndex];
    return `
      <p><span class="badge">等待中</span>目前不是你行動。${next ? `${next.name} ${next.position} 正在處理。` : ""}</p>
      <ul>
        <li>先預想如果有人加注，你願意用這手牌投入多少。</li>
        <li>多桌時優先看有大池、All-in、河牌決策的桌。</li>
      </ul>
    `;
  }

  const toCall = Math.max(0, table.currentBet - hero.bet);
  const potAfterCall = table.pot + toCall;
  const potOdds = toCall > 0 ? toCall / Math.max(1, potAfterCall) : 0;
  const strength = estimateStrength(table, hero);
  const pre = preflopScore(hero.cards);
  const handText = hero.cards.map(cardText).join(" ");
  const position = hero.position;
  const raiseTarget = Math.min(hero.bet + hero.stack, Math.max(table.currentBet + table.lastRaise, table.currentBet + Math.ceil(table.pot * .65)));
  const action = recommendAction(table, hero, strength, pre, potOdds, toCall);
  return `
    <p><span class="badge">${action.label}</span>${action.main}</p>
    <ul>
      <li>手牌：${handText}；位置：${position}；階段：${streetName(table.street)}。</li>
      <li>目前彩池 ${money(table.pot, table)}，需跟 ${money(toCall, table)}${toCall ? `，底池賠率約 ${(potOdds * 100).toFixed(1)}%。` : "。"}</li>
      <li>估計牌力 ${(strength * 100).toFixed(0)} / 100；翻前基礎 ${(pre * 100).toFixed(0)} / 100。</li>
      <li>${action.detail}</li>
      <li>若要加注，建議加到約 ${money(raiseTarget, table)}，除非你想直接 All-in 施壓。</li>
    </ul>
  `;
}

function recommendAction(table, hero, strength, pre, potOdds, toCall) {
  const late = ["CO", "BTN", "SB"].includes(hero.position);
  const early = ["UTG", "UTG+1", "MP"].includes(hero.position);
  const made = table.board.length ? evaluateBest([...hero.cards, ...table.board]) : null;
  if (toCall === 0) {
    if (strength >= .58 || (late && pre >= .42)) return { label: "建議下注 / 加注", main: "目前不用付錢看下一張，若牌力或位置不錯，可以主動施壓。", detail: "後位沒人表態時，用 50% 到 70% 彩池下注可以拿棄牌率。" };
    return { label: "建議過牌", main: "目前不需要投入籌碼，過牌看下一張比較穩。", detail: "弱牌或邊緣聽牌不用硬把彩池做大。" };
  }
  if (strength < potOdds + .08 && pre < .36 && early) return { label: "建議棄牌", main: "牌力與位置都不夠，面對下注不值得繼續投入。", detail: "多桌時這類邊緣跟注最容易慢慢漏錢。" };
  if (strength >= .72 || made?.category >= 4) return { label: "建議加注", main: "你的牌力夠強，可以加注拿價值或逼聽牌付費。", detail: "強成牌不要只跟注，除非你判斷對手會繼續 bluff。" };
  if (strength >= potOdds + .12 || (late && pre >= .48)) return { label: "建議跟注", main: "跟注價格可以接受，保留位置與實現勝率。", detail: "若後面還有人未行動，跟注範圍要再收緊一點。" };
  return { label: "偏向棄牌", main: "這個價格偏貴，牌力沒有明顯超過底池賠率。", detail: "除非你有明確讀牌或強聽牌，否則棄牌較乾淨。" };
}

function buildInsuranceAdvice(table, hero) {
  const premium = Math.ceil(table.pot * .05);
  const payout = Math.floor(table.pot * .45);
  const boardLeft = 5 - table.board.length;
  return `
    <p><span class="badge">保險建議</span>保險主要是降低波動，不是提高長期獲利。</p>
    <ul>
      <li>保費 ${money(premium, table)}；若輸掉賠付 ${money(payout, table)}；剩餘 ${boardLeft} 張公共牌未發。</li>
      <li>若你 bankroll 壓力大、主池很大，可以買小額保險。</li>
      <li>若目標是長期 EV，通常偏向不買，直接開牌。</li>
    </ul>
  `;
}

function startHand(table = activeTable()) {
  if (!table || table.pending) return;
  table.players.forEach((p) => {
    if (p.stack <= 0) p.stack = 1500;
    p.cards = [];
    p.folded = false;
    p.allIn = false;
    p.bet = 0;
    p.committed = 0;
    p.lastAction = "";
    p.winner = false;
  });
  table.deck = makeDeck();
  table.board = [];
  table.pot = 0;
  table.street = "preflop";
  table.currentBet = table.bigBlind;
  table.lastRaise = table.bigBlind;
  table.actedSinceRaise = new Set();
  table.actionHistory = [];
  table.thinkingIndex = -1;
  table.actionToken += 1;
  table.pending = true;
  table.insurance = null;
  table.awaitingInsurance = false;
  table.heroExtraCost = 0;
  table.analysisHtml = "<p>這手牌進行中。保險會在 Hero All-in 且河牌未發完時開放。</p>";
  assignPositions(table);
  for (let round = 0; round < 2; round++) table.players.forEach((p) => p.cards.push(table.deck.pop()));
  table.players.forEach((p) => p.handStartStack = p.stack);
  postBlind(table, playerByPos(table, "SB"), table.smallBlind, "小盲");
  postBlind(table, playerByPos(table, "BB"), table.bigBlind, "大盲");
  table.currentIndex = playerByPos(table, "UTG");
  log(table, `第 ${table.handNo} 手開始，BTN 在 ${table.players[table.dealer].name}。`);
  render();
  continueBots(table);
}

function postBlind(table, idx, amount, label) {
  const p = table.players[idx];
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.bet += paid;
  p.committed += paid;
  table.pot += paid;
  p.lastAction = `${label} ${money(paid, table)}`;
}

function commitChips(table, p, amount) {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.bet += paid;
  p.committed += paid;
  table.pot += paid;
  if (p.stack === 0) p.allIn = true;
  return paid;
}

function fold(table, idx) {
  const p = table.players[idx];
  p.folded = true;
  p.lastAction = "棄牌";
  table.actedSinceRaise.add(idx);
  recordAction(table, p, "fold", Math.max(0, table.currentBet - p.bet));
  log(table, `${p.name} ${p.position} 棄牌。`);
  if (activePlayers(table).length === 1) finishByFold(table);
  else advanceAction(table);
}

function checkCall(table, idx) {
  const p = table.players[idx];
  const toCall = Math.max(0, table.currentBet - p.bet);
  const paid = commitChips(table, p, toCall);
  p.lastAction = toCall ? `跟注 ${money(paid, table)}` : "過牌";
  table.actedSinceRaise.add(idx);
  recordAction(table, p, toCall ? "call" : "check", toCall, paid);
  log(table, `${p.name} ${p.position} ${toCall ? `跟注 ${money(paid, table)}` : "過牌"}。`);
  maybeInsurancePrompt(table);
  advanceAction(table);
}

function raiseTo(table, idx, target) {
  const p = table.players[idx];
  const oldBet = table.currentBet;
  const finalTarget = Math.min(Math.max(target, table.currentBet + table.lastRaise), p.bet + p.stack);
  if (finalTarget <= oldBet) {
    const toCall = Math.max(0, oldBet - p.bet);
    const paid = commitChips(table, p, toCall);
    p.lastAction = `All-in 跟注 ${money(paid, table)}`;
    table.actedSinceRaise.add(idx);
    recordAction(table, p, "all-in call", toCall, paid);
    log(table, `${p.name} ${p.position} All-in 跟注 ${money(paid, table)}。`);
    maybeInsurancePrompt(table);
    advanceAction(table);
    return;
  }
  const paid = commitChips(table, p, finalTarget - p.bet);
  table.currentBet = p.bet;
  table.lastRaise = Math.max(table.bigBlind, table.currentBet - oldBet);
  table.actedSinceRaise = new Set([idx]);
  p.lastAction = `加注到 ${money(p.bet, table)}${p.allIn ? " All-in" : ""}`;
  recordAction(table, p, "raise", 0, paid, p.bet);
  log(table, `${p.name} ${p.position} 加注到 ${money(p.bet, table)}${p.allIn ? " All-in" : ""}。`);
  maybeInsurancePrompt(table);
  advanceAction(table);
}

function recordAction(table, p, action, toCall = 0, paid = 0, to = 0) {
  table.actionHistory.push({ player: p.name, pos: p.position, street: table.street, action, toCall, paid, to, hero: !!p.hero, hand: p.hero ? p.cards.map(cardText).join(" ") : "" });
}

function advanceAction(table) {
  if (!table.pending || table.street === "showdown") return;
  render();
  if (isBettingRoundComplete(table)) {
    nextStreet(table);
    return;
  }
  table.currentIndex = nextActiveIndex(table, table.currentIndex);
  continueBots(table);
}

function isBettingRoundComplete(table) {
  const able = playersAbleToAct(table);
  if (able.length === 0) return true;
  return able.every((p) => table.actedSinceRaise.has(table.players.indexOf(p)) && p.bet === table.currentBet);
}

function nextStreet(table) {
  table.players.forEach((p) => {
    p.bet = 0;
    p.lastAction = p.folded ? "已棄牌" : p.allIn ? "All-in" : "";
  });
  table.currentBet = 0;
  table.lastRaise = table.bigBlind;
  table.actedSinceRaise = new Set();
  if (table.street === "preflop") {
    table.board.push(table.deck.pop(), table.deck.pop(), table.deck.pop());
    table.street = "flop";
    log(table, `翻牌：${table.board.map(cardText).join(" ")}`);
  } else if (table.street === "flop") {
    table.board.push(table.deck.pop());
    table.street = "turn";
    log(table, `轉牌：${cardText(table.board[3])}`);
  } else if (table.street === "turn") {
    table.board.push(table.deck.pop());
    table.street = "river";
    log(table, `河牌：${cardText(table.board[4])}`);
  } else {
    showdown(table);
    return;
  }
  maybeInsurancePrompt(table);
  if (playersAbleToAct(table).length <= 1) {
    if (pauseForInsurance(table)) return;
    while (table.board.length < 5) table.board.push(table.deck.pop());
    showdown(table);
    return;
  }
  table.currentIndex = nextActiveIndex(table, playerByPos(table, "BTN"));
  render();
  continueBots(table);
}

function finishByFold(table) {
  table.pending = false;
  table.thinkingIndex = -1;
  table.actionToken += 1;
  table.street = "showdown";
  const winner = activePlayers(table)[0];
  const hero = table.players.find((p) => p.hero);
  const startStack = hero.handStartStack ?? hero.stack + hero.committed;
  winner.stack += table.pot;
  winner.winner = true;
  log(table, `${winner.name} 贏得 ${money(table.pot, table)}，其他人都棄牌。`);
  completeHand(table, [{ player: winner, hand: null, amount: table.pot }], true, [], startStack);
}

function showdown(table) {
  table.pending = false;
  table.thinkingIndex = -1;
  table.actionToken += 1;
  table.street = "showdown";
  while (table.board.length < 5) table.board.push(table.deck.pop());
  const hero = table.players.find((p) => p.hero);
  const startStack = hero.handStartStack ?? hero.stack + hero.committed;
  const contenders = activePlayers(table).map((p) => ({ player: p, hand: evaluateBest([...p.cards, ...table.board]) }));
  contenders.sort((a, b) => compareHands(b.hand, a.hand));
  const best = contenders[0].hand;
  const winners = contenders.filter((c) => compareHands(c.hand, best) === 0);
  const share = Math.floor(table.pot / winners.length);
  winners.forEach((w) => {
    w.player.stack += share;
    w.player.winner = true;
  });
  settleInsurance(table, winners, hero);
  log(table, `攤牌：${winners.map((w) => `${w.player.name} ${w.hand.name}`).join("、")} 贏得 ${money(share, table)}${winners.length > 1 ? "（平分）" : ""}。`);
  completeHand(table, winners.map((w) => ({ ...w, amount: share })), false, contenders, startStack);
}

function completeHand(table, winners, wonByFold, contenders, heroStartStack) {
  const hero = table.players.find((p) => p.hero);
  const heroProfit = hero.stack - heroStartStack - table.heroExtraCost;
  app.totalHands += 1;
  app.totalProfit += heroProfit;
  const result = summarizeHand(table, winners, wonByFold, contenders, heroProfit);
  app.completedHands.push(result);
  table.analysisHtml = createAnalysis(table, winners, wonByFold, contenders, heroProfit);
  table.handNo += 1;
  table.dealer = (table.dealer + 1) % table.players.length;
  if (app.completedHands.length % 10 === 0) createTenHandReview();
  render();
}

function continueBots(table) {
  render();
  const p = table.players[table.currentIndex];
  if (!table.pending || !p || p.hero || p.folded || p.allIn) return;
  const token = table.actionToken;
  const toCall = Math.max(0, table.currentBet - p.bet);
  const delay = Math.round(900 + Math.random() * 1700 + Math.min(900, toCall * 8));
  table.thinkingIndex = table.currentIndex;
  p.lastAction = toCall ? `思考中：面對 ${money(toCall, table)}` : "思考中";
  render();
  setTimeout(() => {
    if (!table.pending || token !== table.actionToken || table.players[table.currentIndex] !== p) return;
    table.thinkingIndex = -1;
    const decision = botDecision(table, p);
    if (decision.action === "fold") fold(table, table.currentIndex);
    else if (decision.action === "raise") raiseTo(table, table.currentIndex, decision.to);
    else checkCall(table, table.currentIndex);
  }, delay);
}

function botDecision(table, p) {
  const toCall = Math.max(0, table.currentBet - p.bet);
  const strength = estimateStrength(table, p);
  const posBonus = (POSITIONS.length - 1 - POSITIONS.indexOf(p.position)) * .015;
  const pressure = toCall / Math.max(1, table.pot + toCall);
  const willingness = strength + posBonus + (1 - p.tight) * .12 + (Math.random() - .5) * .14;
  const canRaise = p.stack > toCall + table.bigBlind * 2;
  if (toCall > 0 && willingness < pressure + p.tight * .28) return { action: "fold" };
  if (canRaise && willingness > .68 && Math.random() < p.aggro) {
    const size = table.currentBet + table.bigBlind * (2 + Math.floor(Math.random() * 3));
    const potSize = table.currentBet + Math.floor(table.pot * (.45 + Math.random() * .35));
    return { action: "raise", to: Math.max(size, potSize) };
  }
  return { action: "call" };
}

function canOfferInsurance(table) {
  if (!table || table.insurance || (!table.pending && !table.awaitingInsurance) || table.board.length >= 5) return false;
  const hero = table.players.find((p) => p.hero);
  if (!hero || !hero.allIn || hero.folded) return false;
  return activePlayers(table).length >= 2 && table.pot > 0;
}

function pauseForInsurance(table) {
  if (!canOfferInsurance(table)) return false;
  table.pending = false;
  table.awaitingInsurance = true;
  table.thinkingIndex = -1;
  table.actionToken += 1;
  log(table, `保險決策：保費 ${money(Math.ceil(table.pot * .05), table)}，賠付 ${money(Math.floor(table.pot * .45), table)}。`);
  render();
  return true;
}

function maybeInsurancePrompt(table) {
  if (app.autoInsurance && canOfferInsurance(table)) {
    log(table, `保險可買：保費約 ${money(Math.ceil(table.pot * .05), table)}，若攤牌輸掉可拿回 ${money(Math.floor(table.pot * .45), table)}。`);
  }
}

function buyInsurance(table = activeTable()) {
  if (!canOfferInsurance(table)) return;
  const hero = table.players.find((p) => p.hero);
  const premium = Math.ceil(table.pot * .05);
  const payout = Math.floor(table.pot * .45);
  const paidFromStack = Math.min(hero.stack, premium);
  hero.stack -= paidFromStack;
  table.heroExtraCost += premium - paidFromStack;
  table.insurance = { premium, payout, active: true, result: "pending" };
  log(table, `你買了保險，保費 ${money(premium, table)}；若最後輸掉，賠付 ${money(payout, table)}。`);
  if (table.awaitingInsurance) resumeRunout(table);
  else render();
}

function skipInsurance(table = activeTable()) {
  if (!table?.awaitingInsurance) return;
  log(table, "你選擇不買保險，直接開牌。");
  resumeRunout(table);
}

function resumeRunout(table) {
  table.awaitingInsurance = false;
  while (table.board.length < 5) table.board.push(table.deck.pop());
  showdown(table);
}

function settleInsurance(table, winners, hero) {
  if (!table.insurance || !table.insurance.active) return;
  const heroWon = winners.some((w) => w.player === hero);
  if (heroWon) {
    table.insurance.result = "保險失效：你贏了主池，保費視為成本。";
  } else {
    hero.stack += table.insurance.payout;
    table.insurance.result = `保險賠付 ${money(table.insurance.payout, table)}。`;
  }
  log(table, table.insurance.result);
}

function summarizeHand(table, winners, wonByFold, contenders, heroProfit) {
  const hero = table.players.find((p) => p.hero);
  const heroActions = table.actionHistory.filter((a) => a.hero);
  const voluntarilyPutMoney = heroActions.some((a) => ["call", "raise", "all-in call"].includes(a.action));
  const raised = heroActions.some((a) => a.action === "raise");
  const won = winners.some((w) => w.player === hero);
  return {
    tableId: table.id,
    handNo: table.handNo,
    profit: heroProfit,
    won,
    vpip: voluntarilyPutMoney,
    pfr: raised,
    folded: hero.folded,
    position: hero.position,
    preflop: preflopScore(hero.cards),
    insurance: table.insurance ? table.insurance.result || "已買保險" : "",
    wentShowdown: !wonByFold && contenders.some((c) => c.player === hero)
  };
}

function createAnalysis(table, winners, wonByFold, contenders, heroProfit) {
  const hero = table.players.find((p) => p.hero);
  const heroActions = table.actionHistory.filter((a) => a.hero);
  const heroHand = hero.cards.map(cardText).join(" ");
  const heroEval = !hero.folded ? evaluateBest([...hero.cards, ...table.board]) : null;
  const won = winners.some((w) => w.player === hero);
  const potOddsNotes = heroActions.filter((a) => a.toCall > 0).map((a) => `${streetName(a.street)} 面對 ${money(a.toCall, table)}，約需 ${(a.toCall / Math.max(1, table.pot) * 100).toFixed(1)}% 勝率。`);
  const showdownLines = contenders.length ? contenders.map((c) => `<li><span class="badge">${c.player.position}</span>${c.player.name}: ${c.player.cards.map(cardText).join(" ")} · ${c.hand.name}</li>`).join("") : `<li>勝者 ${winners[0].player.name} 靠棄牌贏下彩池。</li>`;
  const insuranceLine = table.insurance ? `<li>保險：保費 ${money(table.insurance.premium, table)}；${table.insurance.result || "等待結算"}。</li>` : "<li>保險：本手沒有買保險。</li>";
  return `
    <p><span class="badge">本手結果</span>${won ? "你贏了" : "你沒贏"}，損益 ${heroProfit >= 0 ? "+" : ""}${money(heroProfit, table)}。你的手牌 ${heroHand}${heroEval ? `，最終牌型：${heroEval.name}` : "，你已棄牌"}。</p>
    <ul>
      <li>你的倉位：${hero.position}，起手牌強度約 ${(preflopScore(hero.cards) * 100).toFixed(0)} / 100。</li>
      <li>公共牌：${table.board.map(cardText).join(" ") || "未發完"}。</li>
      <li>${wonByFold ? "這手在攤牌前結束，重點是棄牌率與下注壓力。" : "攤牌結果如下："}</li>
      ${showdownLines}
      <li>${potOddsNotes.length ? potOddsNotes.join(" ") : "你這手沒有面對需要計算的跟注壓力。"}</li>
      ${insuranceLine}
      <li>${suggestHero(hero, heroActions, won, heroEval)}</li>
    </ul>
  `;
}

function createTenHandReview() {
  app.reviewNo += 1;
  const hands = app.completedHands.slice(-10);
  const profit = hands.reduce((sum, h) => sum + h.profit, 0);
  const vpip = hands.filter((h) => h.vpip).length;
  const pfr = hands.filter((h) => h.pfr).length;
  const wins = hands.filter((h) => h.won).length;
  const showdowns = hands.filter((h) => h.wentShowdown).length;
  const insuranceCount = hands.filter((h) => h.insurance).length;
  const loose = vpip >= 5 ? "VPIP 偏高，多桌時建議少玩前位弱牌。" : "入池頻率偏穩，可以在 CO / BTN 多偷盲。";
  const passive = pfr <= 1 && vpip >= 3 ? "PFR 偏低，跟注太多會讓你被動看牌。" : "主動加注頻率合理，繼續用位置施壓。";
  const insuranceAdvice = insuranceCount >= 3 ? "保險買得偏多，除非主池很大且波動壓力明顯，否則保費會吃掉長期 EV。" : "保險使用克制，適合把它當作波動管理而不是獲利工具。";
  el.review.innerHTML = `
    <p><span class="badge">第 ${app.reviewNo} 次檢討</span>最近 10 手損益 ${profit >= 0 ? "+" : ""}${money(profit)}，勝率 ${wins}/10。</p>
    <ul>
      <li>VPIP：${vpip}/10；PFR：${pfr}/10；攤牌：${showdowns}/10。</li>
      <li>${loose}</li>
      <li>${passive}</li>
      <li>${insuranceAdvice}</li>
      <li>多桌建議：先照顧有 All-in、河牌決策、或面對大注的桌；小盲/大盲防守不要因為忙而自動跟太寬。</li>
    </ul>
  `;
}

function suggestHero(hero, actions, won, heroEval) {
  const folded = actions.some((a) => a.action === "fold");
  const raised = actions.some((a) => a.action === "raise");
  const pre = preflopScore(hero.cards);
  if (folded && pre > .62) return "解析：你棄掉了偏強起手牌；後位或盲注戰可以多用跟注/再加注保留勝率。";
  if (!folded && pre < .28 && hero.position !== "BB") return "解析：起手牌偏弱；線上多桌時這類牌容易拖慢決策，前位可直接棄牌。";
  if (heroEval && heroEval.category >= 4 && !raised) return "解析：做成強牌但沒有主動加壓；下次可用 50% 到 75% 彩池下注讓抽牌付費。";
  if (raised && !won) return "解析：主動性足夠，但被跟注後要重新評估對手範圍，不要自動連開三槍。";
  if (won) return "解析：這手節奏不錯。多桌時把後位偷盲和前位選牌當成預設框架。";
  return "解析：整體可接受。重點是多桌時簡化決策：前位緊、後位攻、邊緣牌少投入大池。";
}

function heroAction(action) {
  const table = activeTable();
  if (!table || !table.pending || !table.players[table.currentIndex]?.hero) return;
  const idx = table.currentIndex;
  if (action === "fold") fold(table, idx);
  if (action === "call") checkCall(table, idx);
  if (action === "raise") raiseTo(table, idx, Number(el.raiseAmount.value) || table.currentBet + table.bigBlind * 2);
  if (action === "allin") raiseTo(table, idx, table.players[idx].bet + table.players[idx].stack);
}

function estimateStrength(table, p) {
  if (table.board.length === 0) return preflopScore(p.cards);
  const made = evaluateBest([...p.cards, ...table.board]);
  return Math.min(.98, made.category / 8 * .72 + made.values[0] / 14 * .18 + drawPotential([...p.cards, ...table.board]));
}

function preflopScore(cards) {
  const [a, b] = cards.map((c) => c.rank).sort((x, y) => y - x);
  let score = (a + b) / 28 * .45;
  if (a === b) score += .38 + a / 80;
  if (cards[0].suit === cards[1].suit) score += .08;
  const gap = Math.abs(a - b);
  if (gap === 1) score += .07;
  else if (gap === 2) score += .04;
  else if (gap > 4) score -= .08;
  if (a >= 13) score += .06;
  return Math.max(.08, Math.min(.92, score));
}

function drawPotential(cards) {
  const suits = cards.reduce((acc, c) => ({ ...acc, [c.suit]: (acc[c.suit] || 0) + 1 }), {});
  const flushDraw = Math.max(...Object.values(suits)) >= 4 ? .13 : 0;
  const ranks = [...new Set(cards.map((c) => c.rank === 14 ? [14, 1] : [c.rank]).flat())].sort((a, b) => a - b);
  let straightDraw = 0;
  for (let start = 1; start <= 10; start++) {
    if ([start, start + 1, start + 2, start + 3, start + 4].filter((r) => ranks.includes(r)).length >= 4) straightDraw = .11;
  }
  return flushDraw + straightDraw;
}

function evaluateBest(cards) {
  const combos = combinations(cards, 5);
  let best = evaluateFive(combos[0]);
  for (const combo of combos.slice(1)) {
    const hand = evaluateFive(combo);
    if (compareHands(hand, best) > 0) best = hand;
  }
  return best;
}

function combinations(arr, k) {
  const out = [];
  const walk = (start, combo) => {
    if (combo.length === k) return out.push(combo);
    for (let i = start; i <= arr.length - (k - combo.length); i++) walk(i + 1, combo.concat(arr[i]));
  };
  walk(0, []);
  return out;
}

function evaluateFive(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const counts = {};
  ranks.forEach((r) => counts[r] = (counts[r] || 0) + 1);
  const groups = Object.entries(counts).map(([rank, count]) => ({ rank: Number(rank), count })).sort((a, b) => b.count - a.count || b.rank - a.rank);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const straightHigh = getStraightHigh(ranks);
  if (flush && straightHigh) return hand(8, "同花順", [straightHigh]);
  if (groups[0].count === 4) return hand(7, "四條", [groups[0].rank, groups[1].rank]);
  if (groups[0].count === 3 && groups[1].count === 2) return hand(6, "葫蘆", [groups[0].rank, groups[1].rank]);
  if (flush) return hand(5, "同花", ranks);
  if (straightHigh) return hand(4, "順子", [straightHigh]);
  if (groups[0].count === 3) return hand(3, "三條", [groups[0].rank, ...groups.slice(1).map((g) => g.rank).sort((a, b) => b - a)]);
  if (groups[0].count === 2 && groups[1].count === 2) return hand(2, "兩對", [groups[0].rank, groups[1].rank, groups[2].rank]);
  if (groups[0].count === 2) return hand(1, "一對", [groups[0].rank, ...groups.slice(1).map((g) => g.rank).sort((a, b) => b - a)]);
  return hand(0, "高牌", ranks);
}

function hand(category, name, values) {
  return { category, name, values };
}

function getStraightHigh(ranks) {
  const unique = [...new Set(ranks)];
  if (unique.includes(14)) unique.push(1);
  unique.sort((a, b) => b - a);
  for (let i = 0; i <= unique.length - 5; i++) {
    const slice = unique.slice(i, i + 5);
    if (slice[0] - slice[4] === 4) return slice[0];
  }
  return 0;
}

function compareHands(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) {
    const diff = (a.values[i] || 0) - (b.values[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function addTable(select = true, renderAfter = true) {
  if (app.tables.length >= 4) return;
  const table = createTable(app.nextTableId++);
  assignPositions(table);
  app.tables.push(table);
  if (select) app.activeTableId = table.id;
  if (renderAfter) render();
}

function startAllTables() {
  while (app.tables.length < 4) addTable(false, false);
  const firstIdle = app.tables.find((t) => !t.pending && !t.awaitingInsurance);
  if (firstIdle) app.activeTableId = firstIdle.id;
  app.tables.forEach((table) => {
    if (!table.pending && !table.awaitingInsurance) startHand(table);
  });
  render();
}

el.addTableBtn.addEventListener("click", () => addTable());
el.allTablesBtn.addEventListener("click", startAllTables);
el.newHandBtn.addEventListener("click", () => startHand(activeTable()));
el.displayMode.addEventListener("change", () => { app.displayMode = el.displayMode.value; render(); });
el.cashRate.addEventListener("change", () => { app.cashRate = Number(el.cashRate.value); render(); });
el.foldBtn.addEventListener("click", () => heroAction("fold"));
el.checkCallBtn.addEventListener("click", () => heroAction("call"));
el.raiseBtn.addEventListener("click", () => heroAction("raise"));
el.allInBtn.addEventListener("click", () => heroAction("allin"));
el.insuranceBtn.addEventListener("click", () => buyInsurance(activeTable()));
el.skipInsuranceBtn.addEventListener("click", () => skipInsurance(activeTable()));
el.adviceBtn.addEventListener("click", showAdvice);

addTable();
