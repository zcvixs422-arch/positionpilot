/* ===== PositionPilot メインアプリケーション ===== */

// ===== データモデル =====
let stocks = JSON.parse(localStorage.getItem('pp_stocks') || '[]');
let profitLogs = JSON.parse(localStorage.getItem('pp_logs') || '[]');
let editingStockId = null;
let currentFilter = 'all';
let selectedTags = [];
let updatePriceStockId = null;
let isFetchingAllPrices = false;

// ===== Worker同期設定 =====
const WORKER_CONFIG_KEY = 'pp_worker_config';
function getWorkerConfig() {
  try { return JSON.parse(localStorage.getItem(WORKER_CONFIG_KEY) || 'null'); } catch { return null; }
}
function saveWorkerConfig(config) {
  localStorage.setItem(WORKER_CONFIG_KEY, JSON.stringify(config));
}

// Workerへ銘柄データを同期
async function syncToWorker() {
  const config = getWorkerConfig();
  if (!config || !config.url || !config.token) {
    showToast('error', '⚠️ Worker設定が未完了です。設定画面で接続してください');
    return;
  }
  const btn = document.getElementById('sync-worker-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin">⟳</span> 同期中...'; }
  try {
    const res = await fetch(config.url + '/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.token,
      },
      body: JSON.stringify({ stocks }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '同期失敗');
    showToast('success', `✅ ${data.count}銘柄をWorkerに同期しました`);
  } catch (e) {
    showToast('error', `❌ Worker同期失敗: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '☁️ Workerに同期'; }
  }
}

// Worker設定モーダル
function openWorkerSettings() {
  const config = getWorkerConfig() || { url: '', token: '' };
  const overlay = document.getElementById('worker-modal-overlay');
  document.getElementById('worker-url-input').value = config.url || '';
  document.getElementById('worker-token-input').value = config.token || '';
  overlay.classList.add('open');
}
function closeWorkerSettings(event) {
  if (event && event.target !== document.getElementById('worker-modal-overlay')) return;
  document.getElementById('worker-modal-overlay').classList.remove('open');
}
function saveWorkerSettings() {
  const url = document.getElementById('worker-url-input').value.trim().replace(/\/+$/, '');
  const token = document.getElementById('worker-token-input').value.trim();
  if (!url || !token) { showToast('error', 'URLとトークンの両方を入力してください'); return; }
  saveWorkerConfig({ url, token });
  closeWorkerSettings();
  showToast('success', '✅ Worker接続設定を保存しました');
}
async function testWorkerConnection() {
  const url = document.getElementById('worker-url-input').value.trim().replace(/\/+$/, '');
  const token = document.getElementById('worker-token-input').value.trim();
  if (!url || !token) { showToast('error', 'URLとトークンを入力してください'); return; }
  try {
    const res = await fetch(url + '/api/status', {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'エラー');
    showToast('success', `✅ 接続成功！ 銘柄数: ${data.stockCount}, 最終実行: ${data.lastRun || '未実行'}`);
  } catch (e) {
    showToast('error', `❌ 接続失敗: ${e.message}`);
  }
}

// チャートインスタンス
let portfolioChartInst = null;
let themeChartInst = null;
let profitChartInst = null;
const stockPositionCharts = {};

// ===== 初期化 =====
function init() {
  // デモデータがない場合は追加
  if (stocks.length === 0) {
    addDemoData();
  }
  renderAll();
  setupCharts();
  setupNotifications();
  setupScrollEffect();

  // 証券コードが1件以上あれば起動時に自動取得
  const hasCode = stocks.some(s => s.code && s.code.trim() !== '');
  if (hasCode) {
    // 少し遅延させてUI描画を先に終わらせる
    setTimeout(() => updateAllPrices(), 800);
  }
}

// ===== デモデータ =====
function addDemoData() {
  const demo = [
    {
      id: genId(),
      name: '○○半導体',
      code: '6723',
      tags: ['AI', '半導体'],
      entryPrice: 1000,
      budget: 10,
      currentPrice: 1180,
      shares: 50,
      createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
    },
    {
      id: genId(),
      name: '△△電力',
      code: '9501',
      tags: ['電力'],
      entryPrice: 2500,
      budget: 15,
      currentPrice: 2940,
      shares: 30,
      createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    },
    {
      id: genId(),
      name: '□□AI',
      code: '4641',
      tags: ['AI'],
      entryPrice: 3200,
      budget: 20,
      currentPrice: 2720,
      shares: 31,
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    },
    {
      id: genId(),
      name: '◇◇EV',
      code: '7203',
      tags: ['EV'],
      entryPrice: 1800,
      budget: 12,
      currentPrice: 1530,
      shares: 33,
      createdAt: new Date(Date.now() - 86400000 * 20).toISOString(),
    },
  ];
  const demoLogs = [
    {
      id: genId(),
      stockName: 'XX金融',
      type: '利確①',
      sellPrice: 1560,
      buyPrice: 1200,
      shares: 30,
      profitRate: 30,
      profitAmount: 10800,
      date: new Date(Date.now() - 86400000 * 10).toISOString(),
    },
    {
      id: genId(),
      stockName: 'YY成長株',
      type: '利確②',
      sellPrice: 4200,
      buyPrice: 3000,
      shares: 15,
      profitRate: 40,
      profitAmount: 18000,
      date: new Date(Date.now() - 86400000 * 25).toISOString(),
    },
  ];
  stocks = demo;
  profitLogs = demoLogs;
  saveData();
}

function saveData() {
  localStorage.setItem('pp_stocks', JSON.stringify(stocks));
  localStorage.setItem('pp_logs', JSON.stringify(profitLogs));
  // Worker設定があれば自動同期（バックグラウンド、失敗しても無視）
  const wc = getWorkerConfig();
  if (wc && wc.url && wc.token) {
    fetch(wc.url + '/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + wc.token },
      body: JSON.stringify({ stocks }),
    }).catch(() => {});
  }
}

function genId() {
  return Math.random().toString(36).substr(2, 9);
}

// ===== 実ポジション計算（実取引履歴ベース）=====
// trades配列の買い/売り履歴から平均取得単価と保有株数を計算する
function calcActualPosition(stock) {
  const trades = stock.trades || [];
  if (trades.length === 0) {
    // 取引記録なし → 登録データをそのまま使用
    return { avgPrice: stock.entryPrice, shares: stock.shares || 0 };
  }
  let totalCost = 0, totalShares = 0;
  trades.forEach(t => {
    if (t.type === 'buy') {
      totalCost += t.price * t.shares;
      totalShares += t.shares;
    } else if (t.type === 'sell') {
      const avg = totalShares > 0 ? totalCost / totalShares : 0;
      totalCost = Math.max(0, totalCost - avg * t.shares);
      totalShares = Math.max(0, totalShares - t.shares);
    }
  });
  return {
    avgPrice: totalShares > 0 ? Math.round(totalCost / totalShares) : stock.entryPrice,
    shares: Math.max(0, totalShares)
  };
}

// ナンピン/利確モーダル用state
let nanpinTargetId = null;
let quickSellTargetId = null;

const defaultSettings = { np1Pct: 15, np2Pct: 30, stopPct: 45, tp1Pct: 20, tp2Pct: 40, tp1Frac: 3, tp2Frac: 3 };

// ===== USD表示ヘルパー =====
// 米国株の場合、円価格の横にドル換算を表示する
function fmtUSD(jpyValue, exchangeRate) {
  if (!exchangeRate || exchangeRate <= 0) return '';
  const usd = jpyValue / exchangeRate;
  return '$' + usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function usdSub(stock, jpyValue) {
  if (stock.market !== 'us' || !stock.exchangeRate) return '';
  return `<div style="font-size:11px; color:var(--text-muted); opacity:0.8;">(${fmtUSD(jpyValue, stock.exchangeRate)})</div>`;
}
function usdInline(stock, jpyValue) {
  if (stock.market !== 'us' || !stock.exchangeRate) return '';
  return ` <span style="font-size:0.8em; color:var(--text-muted); opacity:0.8;">(${fmtUSD(jpyValue, stock.exchangeRate)})</span>`;
}

// ===== 投資計画計算 =====
// avgPriceOverride: 実取引から計算した実際の平均単価を渡すと利確ラインがたその値を使う
function calcPlan(entryPrice, budget, currentPrice, avgPriceOverride, settings = {}) {
  const ep = parseFloat(entryPrice);
  const bp = parseFloat(budget) * 10000;
  if (!ep || !bp) return null;

  const conf = { ...defaultSettings, ...settings };

  // ナンピンライン（初回購入価格ベース・固定）
  const nanpin1  = Math.round(ep * (1 - conf.np1Pct / 100));
  const nanpin2  = Math.round(ep * (1 - conf.np2Pct / 100));
  const stopLoss = Math.round(ep * (1 - conf.stopPct / 100));

  // 投資額配分
  const invest1 = Math.round(bp * 0.5);
  const invest2 = Math.round(bp * 0.3);
  const invest3 = Math.round(bp * 0.2);

  // ===== 平均取得単価の算出 =====
  // 実行済みナンピン段階を現在株価で自動判定する
  // 各回の「買い付け株数の比率」を予算配分 / 価格 で計算し加重平均を取る
  //   初回    : 50% of budget ÷ entryPrice
  //   NP①執行: 30% of budget ÷ nanpin1価格
  //   NP②執行: 20% of budget ÷ nanpin2価格
  const cur = parseFloat(currentPrice) || ep;

  let totalCost   = invest1;               // 常に初回分を含む
  let totalShares = invest1 / ep;

  let npPhase = 0; // 0=初回のみ, 1=NP①済み, 2=NP②済み
  if (cur <= nanpin2) {
    // NP①・NP②ともに執行済み
    totalCost   += invest2 + invest3;
    totalShares += invest2 / nanpin1 + invest3 / nanpin2;
    npPhase = 2;
  } else if (cur <= nanpin1) {
    // NP①のみ執行済み
    totalCost   += invest2;
    totalShares += invest2 / nanpin1;
    npPhase = 1;
  }

  const theoreticalAvg = Math.round(totalCost / totalShares);
  const avgPrice = (avgPriceOverride !== undefined && avgPriceOverride > 0)
    ? Math.round(avgPriceOverride) : theoreticalAvg;

  // 利確ライン（平均取得単価ベース）
  const tp1 = Math.round(avgPrice * (1 + conf.tp1Pct / 100));
  const tp2 = Math.round(avgPrice * (1 + conf.tp2Pct / 100));

  return {
    entryPrice: ep,
    budget: bp,
    nanpin1, nanpin2, stopLoss,
    invest1, invest2, invest3,
    avgPrice,
    tp1, tp2,
    npPhase,  // 何段階目まで執行済みか
    settings: conf
  };
}

// ===== ステータス判定 =====
function getStatus(stock) {
  const cur = stock.currentPrice || stock.entryPrice;
  const pos = calcActualPosition(stock);
  const plan = calcPlan(stock.entryPrice, stock.budget, cur, pos.avgPrice, stock.planSettings);
  if (!plan) return { status: 'safe', label: 'HOLD', statusClass: 'status-safe', badgeClass: 'badge-safe', action: 'HOLD' };

  const pct = ((cur - stock.entryPrice) / stock.entryPrice) * 100;

  // 損切り警告
  if (cur <= plan.stopLoss) {
    return { status: 'danger', label: '⚠️ 損切り検討', statusClass: 'status-danger', badgeClass: 'badge-danger', action: 'STOP-LOSS', action_class: 'action-stoploss', pct };
  }
  // ナンピン②
  if (cur <= plan.nanpin2) {
    return { status: 'danger', label: '🔵 最終ナンピン', statusClass: 'status-danger', badgeClass: 'badge-danger', action: 'NANPIN②', action_class: 'action-nanpin', pct };
  }
  // ナンピン①
  if (cur <= plan.nanpin1) {
    return { status: 'warning', label: '🔵 ナンピン検討', statusClass: 'status-warning', badgeClass: 'badge-warning', action: 'NANPIN①', action_class: 'action-nanpin', pct };
  }
  // 利確②
  if (cur >= plan.tp2) {
    return { status: 'warning', label: '💰 利確②到達', statusClass: 'status-warning', badgeClass: 'badge-warning', action: '利確②', action_class: 'action-sell', pct };
  }
  // 利確①
  if (cur >= plan.tp1) {
    return { status: 'warning', label: '💰 利確①接近', statusClass: 'status-warning', badgeClass: 'badge-warning', action: '利確①', action_class: 'action-sell', pct };
  }
  // 安全
  return { status: 'safe', label: '✅ HOLD', statusClass: 'status-safe', badgeClass: 'badge-safe', action: 'HOLD', action_class: 'action-hold', pct };
}

// ===== ページ表示 =====
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + pageId)?.classList.add('active');
  document.getElementById('tab-' + pageId)?.classList.add('active');

  if (pageId === 'dashboard') {
    setTimeout(() => updateCharts(), 100);
  }
  if (pageId === 'log') {
    setTimeout(() => updateProfitChart(), 100);
  }
  renderAll();
}

// ===== 全体レンダリング =====
function renderAll() {
  renderDashboard();
  renderStockManagement();
  renderLogPage();
}

// ===== ダッシュボード =====
function renderDashboard() {
  const statuses = stocks.map(s => getStatus(s));
  const danger = statuses.filter(s => s.status === 'danger').length;
  const warning = statuses.filter(s => s.status === 'warning').length;
  const safe = statuses.filter(s => s.status === 'safe').length;

  // 総資産計算（実取引ベース）
  let totalAssets = 0, baseAssets = 0;
  stocks.forEach(s => {
    const cur = s.currentPrice || s.entryPrice;
    const pos = calcActualPosition(s);
    totalAssets += cur * pos.shares;
    baseAssets  += pos.avgPrice * pos.shares;
  });
  const assetChange = baseAssets > 0 ? ((totalAssets - baseAssets) / baseAssets * 100).toFixed(1) : 0;

  document.getElementById('total-assets').textContent = '¥' + totalAssets.toLocaleString();
  const changeEl = document.getElementById('total-change');
  if (assetChange > 0) {
    changeEl.textContent = `▲ ${assetChange}% 含み益`;
    changeEl.style.color = 'var(--color-safe)';
  } else if (assetChange < 0) {
    changeEl.textContent = `▼ ${Math.abs(assetChange)}% 含み損`;
    changeEl.style.color = 'var(--color-danger)';
  } else {
    changeEl.textContent = '±0%';
    changeEl.style.color = 'var(--text-muted)';
  }

  document.getElementById('action-needed').textContent = danger + '件';
  document.getElementById('sell-ready').textContent = warning + '件';
  document.getElementById('safe-count').textContent = safe + '件';

  // 銘柄カード
  renderStockCards();
}

// ===== 銘柄カード =====
function renderStockCards() {
  const grid = document.getElementById('stock-cards-grid');
  const emptyState = document.getElementById('empty-state');

  let filtered = stocks;
  if (currentFilter === 'danger') filtered = stocks.filter(s => getStatus(s).status === 'danger');
  else if (currentFilter === 'warning') filtered = stocks.filter(s => getStatus(s).status === 'warning');
  else if (currentFilter === 'safe') filtered = stocks.filter(s => getStatus(s).status === 'safe');

  if (stocks.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  grid.innerHTML = filtered.map(stock => {
    const cur = stock.currentPrice || stock.entryPrice;
    const pos = calcActualPosition(stock);
    const plan = calcPlan(stock.entryPrice, stock.budget, cur, pos.avgPrice, stock.planSettings);
    const st = getStatus(stock);
    // P&Lは実際の平均単価ベース
    const pct = pos.avgPrice > 0 ? ((cur - pos.avgPrice) / pos.avgPrice * 100) : 0;
    const pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    const pctClass = pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'neutral';
    // 含み損益（円額）：（現在値 - 平均単価）× 保有株数
    const profitYen = Math.round((cur - pos.avgPrice) * pos.shares);
    const profitYenStr = (profitYen >= 0 ? '+¥' : '-¥') + Math.abs(profitYen).toLocaleString();

    // 次のアクション説明
    let actionDesc = '利確ラインまで ';
    if (plan) {
      if (cur < plan.tp1) { const d = ((plan.tp1 - cur) / cur * 100).toFixed(1); actionDesc = `利確①まで +${d}%`; }
      if (cur >= plan.tp1 && cur < plan.tp2) actionDesc = '利確①到達！売却検討';
      if (cur >= plan.tp2) actionDesc = '利確②到達！早期売却推奨';
      if (cur <= plan.nanpin1 && cur > plan.nanpin2) actionDesc = `NP① ${Math.round(plan.invest2/10000*10)/10}万円追加`;
      if (cur <= plan.nanpin2 && cur > plan.stopLoss) actionDesc = `NP② ${Math.round(plan.invest3/10000*10)/10}万円最終追加`;
      if (cur <= plan.stopLoss) actionDesc = '損切りゾーン！要判断';
    }

    // 投入率（実コストベース）
    const investedCost = pos.avgPrice * pos.shares;
    const budgetAmt = stock.budget * 10000;
    const investRate = budgetAmt > 0 ? Math.min(100, Math.round(investedCost / budgetAmt * 100)) : 0;
    const barColor = st.status === 'safe' ? 'var(--color-safe)' : st.status === 'warning' ? 'var(--color-warning)' : 'var(--color-danger)';
    const tagsHtml = (stock.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('');

    return `
      <div class="stock-card ${st.statusClass}" onclick="openStockModal('${stock.id}')">
        <div class="stock-card-header">
          <div>
            <div class="stock-name">${stock.name}</div>
            <div class="stock-code">${stock.code || '----'}</div>
          </div>
          <span class="stock-status-badge ${st.badgeClass}">${st.action || 'HOLD'}</span>
        </div>
        <div class="stock-price-row">
          <div>
            <div class="stock-current-price">¥${cur.toLocaleString()}</div>
            ${stock.market === 'us' && stock.exchangeRate ? `<div style="font-size:12px; color:var(--text-muted); opacity:0.85;">${fmtUSD(cur, stock.exchangeRate)}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <div class="stock-change-pct ${pctClass}">${pctStr}</div>
            <div style="font-size:12px; font-weight:700; color:${pct>=0?'var(--color-safe)':'var(--color-danger)'}; font-family:'Inter',sans-serif;">${pos.shares > 0 ? profitYenStr : '--'}</div>
          </div>
        </div>
        <div style="font-size:11px; color:var(--text-muted); margin:-4px 0 6px;">
          平均単価 ¥${pos.avgPrice.toLocaleString()}${usdInline(stock, pos.avgPrice)} | ${pos.shares}株
        </div>
        <div class="stock-progress-bar">
          <div class="progress-label"><span>投入率</span><span>${investRate}%</span></div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${investRate}%; background:${barColor};"></div>
          </div>
        </div>
        ${tagsHtml ? `<div class="stock-tags">${tagsHtml}</div>` : ''}
        <div class="stock-action-row">
          <span class="stock-action-label">${actionDesc}</span>
        </div>
        <div class="stock-card-quick-actions">
          <button class="quick-btn quick-buy" onclick="event.stopPropagation(); openNanpinModal('${stock.id}')">📉 NP買い</button>
          <button class="quick-btn quick-sell" onclick="event.stopPropagation(); openQuickSellModal('${stock.id}')">&#x1F4B0; 利確</button>
          <button class="quick-btn quick-update" onclick="event.stopPropagation(); openPriceModal('${stock.id}')">&#x1F4E1; 株価</button>
        </div>
      </div>
    `;
  }).join('');
}

function filterStocks(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderStockCards();
}

// ===== 銘柄管理ページ =====
function renderStockManagement() {
  const container = document.getElementById('stock-list-container');
  const emptyState = document.getElementById('stocks-empty-state');
  const summaryBlock = document.getElementById('stocks-total-summary');

  if (stocks.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    if (summaryBlock) summaryBlock.style.display = 'none';
    return;
  }
  emptyState.style.display = 'none';

  // 全体合計の計算
  let totalCost = 0;
  let totalValue = 0;
  stocks.forEach(stock => {
    const cur = stock.currentPrice || stock.entryPrice;
    const pos = calcActualPosition(stock);
    totalCost += pos.avgPrice * pos.shares;
    totalValue += cur * pos.shares;
  });

  if (summaryBlock) {
    if (totalCost > 0) {
      const profit = totalValue - totalCost;
      const pct = (profit / totalCost) * 100;
      const profitStr = (profit >= 0 ? '+' : '') + '¥' + Math.round(profit).toLocaleString();
      const pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
      
      document.getElementById('stocks-total-val').textContent = profitStr;
      document.getElementById('stocks-total-val').style.color = profit >= 0 ? 'var(--text-primary)' : 'var(--color-danger)';
      document.getElementById('stocks-total-pct').textContent = pctStr;
      document.getElementById('stocks-total-pct').style.color = profit >= 0 ? 'var(--color-safe)' : 'var(--color-danger)';
      summaryBlock.style.display = 'flex';
    } else {
      summaryBlock.style.display = 'none';
    }
  }

  container.innerHTML = stocks.map(stock => {
    const cur = stock.currentPrice || stock.entryPrice;
    const pos = calcActualPosition(stock);
    const plan = calcPlan(stock.entryPrice, stock.budget, cur, pos.avgPrice, stock.planSettings);
    const st = getStatus(stock);
    // 評価損益は実際の平均単価ベース
    const pct = pos.avgPrice > 0 ? ((cur - pos.avgPrice) / pos.avgPrice * 100) : 0;
    const pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    // 含み損益（円額）
    const profitYen = Math.round((cur - pos.avgPrice) * pos.shares);
    const profitYenStr = (profitYen >= 0 ? '+¥' : '-¥') + Math.abs(profitYen).toLocaleString();

    const tagsHtml = (stock.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('');

    return `
      <div class="stock-detail-card ${st.statusClass}">
        <div class="stock-detail-header">
          <div class="detail-name-block">
            <div class="detail-stock-name">${stock.name} <span class="stock-code">${stock.code || ''}</span></div>
            <div style="display:flex; gap:6px; margin-top:6px; flex-wrap:wrap;">
              ${tagsHtml}
              <span class="stock-status-badge ${st.badgeClass}">${st.label}</span>
            </div>
          </div>
          <div class="detail-actions">
            <button class="quick-btn quick-buy" onclick="openNanpinModal('${stock.id}')">📉 NP買い</button>
            <button class="quick-btn quick-sell" onclick="openQuickSellModal('${stock.id}')">💰 利確</button>
            <button class="btn btn-ghost btn-sm" onclick="editStock('${stock.id}')">✏️ 編集</button>
            <button class="btn btn-danger btn-sm" onclick="deleteStock('${stock.id}')">🗑️ 削除</button>
            <button class="btn btn-primary btn-sm" onclick="openPriceModal('${stock.id}')">📡 株価更新</button>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:12px;">
          <div style="grid-column:1/-1; background:linear-gradient(135deg,rgba(99,102,241,0.18),rgba(139,92,246,0.12)); border:1px solid rgba(99,102,241,0.35); border-radius:var(--radius-md); padding:10px 14px; display:flex; align-items:center; justify-content:space-between;">
            <div>
              <div style="font-size:11px; color:var(--color-accent); font-weight:600; letter-spacing:0.5px;">📡 現在株価${stock.market === 'us' ? ' 🇺🇸' : ''}</div>
              <div style="font-size:24px; font-weight:900; font-family:'Inter',sans-serif; color:var(--text-primary);">\u00a5${cur.toLocaleString()}</div>
              ${stock.market === 'us' && stock.exchangeRate ? `<div style="font-size:14px; font-weight:700; color:var(--text-muted); opacity:0.85;">${fmtUSD(cur, stock.exchangeRate)}</div>` : ''}
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px; color:var(--text-muted);">含み損益</div>
              <div style="font-size:18px; font-weight:800; font-family:'Inter',sans-serif; color:${pct>=0?'var(--color-safe)':'var(--color-danger)'};">${
                pctStr}</div>
              <div style="font-size:13px; font-weight:700; font-family:'Inter',sans-serif; color:${pct>=0?'var(--color-safe)':'var(--color-danger)'}; opacity:0.85;">${pos.shares > 0 ? profitYenStr : '--'}</div>
            </div>
          </div>
          <div style="background:var(--bg-card-hover); border-radius:var(--radius-md); padding:8px 10px;">
            <div style="font-size:10px; color:var(--text-muted);">平均取得単価</div>
            <div style="font-size:14px; font-weight:700; color:var(--color-accent-light);">¥${pos.avgPrice.toLocaleString()}</div>
            ${usdSub(stock, pos.avgPrice)}
          </div>
          <div style="background:var(--bg-card-hover); border-radius:var(--radius-md); padding:8px 10px;">
            <div style="font-size:10px; color:var(--text-muted);">含み損益（円額）</div>
            <div style="font-size:14px; font-weight:800; font-family:'Inter',sans-serif; color:${pct>=0?'var(--color-safe)':'var(--color-danger)'};">${pos.shares > 0 ? profitYenStr : '--'}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${pctStr}</div>
          </div>
          <div style="background:var(--bg-card-hover); border-radius:var(--radius-md); padding:8px 10px;">
            <div style="font-size:10px; color:var(--text-muted);">保有株数</div>
            <div style="font-size:14px; font-weight:700;">${pos.shares.toLocaleString()}株</div>
          </div>
          <div style="background:var(--bg-card-hover); border-radius:var(--radius-md); padding:8px 10px;">
            <div style="font-size:10px; color:var(--text-muted);">初回購入価格</div>
            <div style="font-size:13px; font-weight:600;">¥${stock.entryPrice.toLocaleString()}</div>
            ${usdSub(stock, stock.entryPrice)}
          </div>
          <div style="background:var(--bg-card-hover); border-radius:var(--radius-md); padding:8px 10px;">
            <div style="font-size:10px; color:var(--text-muted);">予定総投資</div>
            <div style="font-size:13px; font-weight:600;">${stock.budget}万円</div>
          </div>
        </div>

        ${plan ? `
        ${(() => {
          // ===== 金額計算 =====
          // ナンピン
          const np1Shares = Math.floor(plan.invest2 / plan.nanpin1);
          const np2Shares = Math.floor(plan.invest3 / plan.nanpin2);
          // 利確
          const tp1Shares = Math.floor(pos.shares / plan.settings.tp1Frac);
          const tp2Shares = Math.floor(pos.shares / plan.settings.tp2Frac);
          const tp1Receive = Math.round(plan.tp1 * tp1Shares);
          const tp2Receive = Math.round(plan.tp2 * tp2Shares);
          const tp1Profit  = Math.round((plan.tp1 - pos.avgPrice) * tp1Shares);
          const tp2Profit  = Math.round((plan.tp2 - pos.avgPrice) * tp2Shares);
          const profitSign1 = tp1Profit >= 0 ? '+' : '';
          const profitSign2 = tp2Profit >= 0 ? '+' : '';
          return `
        <div class="stock-levels-grid">
          <div class="levels-section">
            <div class="levels-title">📉 ナンピン計画（初回 ¥${plan.entryPrice.toLocaleString()}${usdInline(stock, plan.entryPrice)} 基準）</div>
            <div class="level-item li-buy-entry">
              <div>
                <div class="li-label">初回エントリー（50%）</div>
                <div class="li-sub">予算: ¥${plan.invest1.toLocaleString()}</div>
              </div>
              <div class="li-value">¥${plan.entryPrice.toLocaleString()}${usdSub(stock, plan.entryPrice)}</div>
            </div>
            <div class="level-item li-buy1 ${cur <= plan.nanpin1 ? 'ring-active' : ''}">
              <div>
                <div class="li-label">ナンピン① (-${plan.settings.np1Pct}%)</div>
                <div class="li-sub">追加予算: ¥${plan.invest2.toLocaleString()} ／ 約 ${np1Shares}株</div>
              </div>
              <div class="li-value" style="color:${cur <= plan.nanpin1 ? 'var(--color-warning)' : ''};">¥${plan.nanpin1.toLocaleString()}${usdSub(stock, plan.nanpin1)}</div>
            </div>
            <div class="level-item li-buy2 ${cur <= plan.nanpin2 ? 'ring-active' : ''}">
              <div>
                <div class="li-label">ナンピン② (-${plan.settings.np2Pct}%)</div>
                <div class="li-sub">追加予算: ¥${plan.invest3.toLocaleString()} ／ 約 ${np2Shares}株</div>
              </div>
              <div class="li-value" style="color:${cur <= plan.nanpin2 ? 'var(--color-danger)' : ''};">¥${plan.nanpin2.toLocaleString()}${usdSub(stock, plan.nanpin2)}</div>
            </div>
            <div class="level-item li-stop">
              <div><div class="li-label">損切りライン (-${plan.settings.stopPct}%)</div></div>
              <div class="li-value" style="color:var(--color-danger);">¥${plan.stopLoss.toLocaleString()}${usdSub(stock, plan.stopLoss)}</div>
            </div>
          </div>
          <div class="levels-section">
            <div class="levels-title">📈 利確計画（平均 ¥${pos.avgPrice.toLocaleString()}${usdInline(stock, pos.avgPrice)} 基準）</div>
            <div class="level-item li-sell1 ${cur >= plan.tp1 ? 'ring-active' : ''}">
              <div>
                <div class="li-label">利確① (+${plan.settings.tp1Pct}%) ─ ${plan.settings.tp1Frac === 1 ? '全株' : '1/' + plan.settings.tp1Frac}売却（${tp1Shares}株）</div>
                <div class="li-sub">
                  受取: ¥${tp1Receive.toLocaleString()}
                  ／ 利益: <span style="color:${tp1Profit>=0?'var(--color-safe)':'var(--color-danger)'};">${profitSign1}¥${tp1Profit.toLocaleString()}</span>
                </div>
              </div>
              <div class="li-value" style="color:${cur >= plan.tp1 ? 'var(--color-safe)' : ''};">¥${plan.tp1.toLocaleString()}${usdSub(stock, plan.tp1)}</div>
            </div>
            <div class="level-item li-sell2 ${cur >= plan.tp2 ? 'ring-active' : ''}">
              <div>
                <div class="li-label">利確② (+${plan.settings.tp2Pct}%) ─ ${plan.settings.tp2Frac === 1 ? '全株' : '1/' + plan.settings.tp2Frac}売却（${tp2Shares}株）</div>
                <div class="li-sub">
                  受取: ¥${tp2Receive.toLocaleString()}
                  ／ 利益: <span style="color:${tp2Profit>=0?'var(--color-safe)':'var(--color-danger)'};">${profitSign2}¥${tp2Profit.toLocaleString()}</span>
                </div>
              </div>
              <div class="li-value" style="color:${cur >= plan.tp2 ? 'var(--color-safe)' : ''};">¥${plan.tp2.toLocaleString()}${usdSub(stock, plan.tp2)}</div>
            </div>
            <div class="level-item li-sell3">
              <div><div class="li-label">残り（${Math.max(0, pos.shares - tp1Shares - tp2Shares)}株）─ トレンド終了監視</div></div>
              <div class="li-value" style="color:var(--color-accent-light);">📡 監視</div>
            </div>
          </div>
        </div>
          `})()}
        <div style="height:120px; margin-top:8px;">
          <canvas id="pos-chart-${stock.id}"></canvas>
        </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // ポジションチャート描画
  stocks.forEach(stock => {
    const cur2 = stock.currentPrice || stock.entryPrice;
    const pos2 = calcActualPosition(stock);
    const plan = calcPlan(stock.entryPrice, stock.budget, cur2, pos2.avgPrice, stock.planSettings);
    if (!plan) return;
    const canvasId = 'pos-chart-' + stock.id;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (stockPositionCharts[stock.id]) {
      stockPositionCharts[stock.id].destroy();
    }

    const cur = cur2;
    const labels = ['損切り', 'NP②', 'NP①', '初回', '平均単価', '現在値', '利確①', '利確②'];
    const values = [plan.stopLoss, plan.nanpin2, plan.nanpin1, plan.entryPrice, plan.avgPrice, cur, plan.tp1, plan.tp2];
    const colors = values.map(v => {
      if (v === cur) return 'rgba(99,102,241,0.8)';
      if (v === plan.avgPrice) return 'rgba(168,85,247,0.7)';
      if (v <= plan.stopLoss) return 'rgba(239,68,68,0.6)';
      if (v <= plan.nanpin2) return 'rgba(239,68,68,0.4)';
      if (v <= plan.nanpin1) return 'rgba(245,158,11,0.5)';
      if (v >= plan.tp2) return 'rgba(16,185,129,0.7)';
      if (v >= plan.tp1) return 'rgba(16,185,129,0.5)';
      return 'rgba(59,130,246,0.5)';
    });

    stockPositionCharts[stock.id] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: colors.map(c => c.replace('0.', '0.9')),
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: false,
            grid: { color: 'rgba(0,0,0,0.05)' },
            ticks: { color: 'rgba(0,0,0,0.5)', font: { size: 10 }, callback: v => '¥' + v.toLocaleString() }
          },
          x: {
            grid: { display: false },
            ticks: { color: 'rgba(0,0,0,0.5)', font: { size: 10 } }
          }
        }
      }
    });
  });
}

function toggleMarketUI() {
  const marketInput = document.querySelector('input[name="input-market"]:checked');
  if (!marketInput) return;
  const isUS = marketInput.value === 'us';
  
  const jpFields = document.getElementById('jp-fields');
  const usFields = document.getElementById('us-fields');
  const codeLabel = document.getElementById('label-code');
  
  if (jpFields) jpFields.style.display = isUS ? 'none' : 'block';
  if (usFields) usFields.style.display = isUS ? 'block' : 'none';
  if (codeLabel) {
    codeLabel.innerHTML = isUS 
      ? 'ティッカーシンボル' 
      : '証券コード';
  }

  const elP = document.getElementById('input-price');
  const elUsdP = document.getElementById('input-usd-price');
  const elUsdR = document.getElementById('input-usd-rate');
  
  if (elP) elP.required = !isUS;
  if (elUsdP) elUsdP.required = isUS;
  if (elUsdR) elUsdR.required = isUS;

  calcPreview();
}

// ===== 銘柄登録フォーム =====
function calcPreview() {
  const name = document.getElementById('input-name').value;
  const budget = parseFloat(document.getElementById('input-budget').value);
  
  const market = document.querySelector('input[name="input-market"]:checked')?.value || 'jp';
  let price = 0;
  let current = 0;

  if (market === 'us') {
    const usdPrice = parseFloat(document.getElementById('input-usd-price').value);
    const usdRate = parseFloat(document.getElementById('input-usd-rate').value);
    const usdCurrent = parseFloat(document.getElementById('input-usd-current').value);
    if (usdPrice && usdRate) price = Math.round(usdPrice * usdRate);
    if (usdCurrent && usdRate) current = Math.round(usdCurrent * usdRate);
  } else {
    price = parseFloat(document.getElementById('input-price').value);
    current = parseFloat(document.getElementById('input-current').value);
  }

  if (!price || isNaN(price)) price = 0;
  if (!current || isNaN(current)) current = 0;

  const previewContent = document.getElementById('preview-content');
  const previewResult = document.getElementById('preview-result');

  if (!price || !budget) {
    previewContent.style.display = 'flex';
    previewResult.style.display = 'none';
    return;
  }

  previewContent.style.display = 'none';
  previewResult.style.display = 'block';

  // プレビュー時は「初回価格=現在価格」として計算（登録フォームのため）
  const np1Pct = parseFloat(document.getElementById('input-np1-pct').value) || 15;
  const np2Pct = parseFloat(document.getElementById('input-np2-pct').value) || 30;
  const stopPct = parseFloat(document.getElementById('input-stop-pct').value) || 45;
  const tp1Pct = parseFloat(document.getElementById('input-tp1-pct').value) || 20;
  const tp2Pct = parseFloat(document.getElementById('input-tp2-pct').value) || 40;
  const tp1Frac = parseInt(document.getElementById('input-tp1-frac').value) || 3;
  const tp2Frac = parseInt(document.getElementById('input-tp2-frac').value) || 3;
  const settings = { np1Pct, np2Pct, stopPct, tp1Pct, tp2Pct, tp1Frac, tp2Frac };

  const plan = calcPlan(price, budget, current || price, undefined, settings);
  if (!plan) return;

  document.getElementById('prev-name').textContent = name || '銘柄名未入力';

  document.getElementById('prev-entry').textContent = '¥' + price.toLocaleString();
  document.getElementById('prev-entry-amt').textContent = Math.round(plan.invest1/10000*10)/10 + '万円';

  document.getElementById('prev-np1-label').textContent = `ナンピン① (-${settings.np1Pct}%)`;
  document.getElementById('prev-np1').textContent = '¥' + plan.nanpin1.toLocaleString();
  document.getElementById('prev-np1-amt').textContent = Math.round(plan.invest2/10000*10)/10 + '万円追加';

  document.getElementById('prev-np2-label').textContent = `ナンピン② (-${settings.np2Pct}%)`;
  document.getElementById('prev-np2').textContent = '¥' + plan.nanpin2.toLocaleString();
  document.getElementById('prev-np2-amt').textContent = Math.round(plan.invest3/10000*10)/10 + '万円追加';

  document.getElementById('prev-stop-label').textContent = `損切りライン (-${settings.stopPct}%)`;
  document.getElementById('prev-stop').textContent = '¥' + plan.stopLoss.toLocaleString();

  document.getElementById('prev-tp1').textContent = '¥' + plan.tp1.toLocaleString();
  document.getElementById('prev-tp2').textContent = '¥' + plan.tp2.toLocaleString();

  const fracStr = (f) => f === 1 ? '全株' : `1/${f}`;
  const tp1label = document.getElementById('prev-tp1-label');
  const tp2label = document.getElementById('prev-tp2-label');
  if (tp1label) tp1label.textContent = `利確① (+${settings.tp1Pct}%) - ${fracStr(settings.tp1Frac)}売却 ／ 平均 ¥${plan.avgPrice.toLocaleString()} 基準`;
  if (tp2label) tp2label.textContent = `利確② (+${settings.tp2Pct}%) - ${fracStr(settings.tp2Frac)}売却 ／ 平均 ¥${plan.avgPrice.toLocaleString()} 基準`;

  document.getElementById('prev-total-budget').textContent = budget + '万円';
  document.getElementById('prev-first-invest').textContent = Math.round(plan.invest1/10000*10)/10 + '万円';
  document.getElementById('prev-avg-price').textContent = '¥' + plan.avgPrice.toLocaleString();
}

function registerStock(event) {
  event.preventDefault();

  const name = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-code').value.trim();
  const budget = parseFloat(document.getElementById('input-budget').value);
  const shares = parseInt(document.getElementById('input-shares').value) || 0;

  const market = document.querySelector('input[name="input-market"]:checked')?.value || 'jp';
  let entryPrice = 0, currentPrice = 0;
  let entryPriceUSD = null, exchangeRate = null, currentPriceUSD = null;

  if (market === 'us') {
    entryPriceUSD = parseFloat(document.getElementById('input-usd-price').value);
    exchangeRate = parseFloat(document.getElementById('input-usd-rate').value);
    if (entryPriceUSD && exchangeRate) entryPrice = Math.round(entryPriceUSD * exchangeRate);
    
    const cUSDVal = document.getElementById('input-usd-current').value;
    if (cUSDVal && exchangeRate) {
      currentPriceUSD = parseFloat(cUSDVal);
      currentPrice = Math.round(currentPriceUSD * exchangeRate);
    } else {
      currentPrice = entryPrice;
    }
  } else {
    entryPrice = parseFloat(document.getElementById('input-price').value);
    const currVal = document.getElementById('input-current').value;
    currentPrice = currVal ? parseFloat(currVal) : entryPrice;
  }

  if (!name || !entryPrice || !budget) {
    showToast('error', '❌ 必須項目を入力してください');
    return;
  }

  const tagsToSave = [...selectedTags];
  const otherBtn = document.getElementById('tag-other-btn');
  const customInput = document.getElementById('input-custom-tag');
  if (otherBtn && otherBtn.classList.contains('selected')) {
    const customVal = customInput.value.trim();
    if (customVal) {
      // カンマ区切りなら分割して両端空白を除去して追加
      customVal.split(',').forEach(v => {
        if(v.trim()) tagsToSave.push(v.trim());
      });
    }
  }

  const np1Pct = parseFloat(document.getElementById('input-np1-pct').value) || 15;
  const np2Pct = parseFloat(document.getElementById('input-np2-pct').value) || 30;
  const stopPct = parseFloat(document.getElementById('input-stop-pct').value) || 45;
  const tp1Pct = parseFloat(document.getElementById('input-tp1-pct').value) || 20;
  const tp2Pct = parseFloat(document.getElementById('input-tp2-pct').value) || 40;
  const tp1Frac = parseInt(document.getElementById('input-tp1-frac').value) || 3;
  const tp2Frac = parseInt(document.getElementById('input-tp2-frac').value) || 3;
  const planSettings = { np1Pct, np2Pct, stopPct, tp1Pct, tp2Pct, tp1Frac, tp2Frac };

  if (editingStockId) {
    const idx = stocks.findIndex(s => s.id === editingStockId);
    if (idx !== -1) {
      stocks[idx] = { 
        ...stocks[idx], 
        name, code, tags: tagsToSave, 
        entryPrice, budget, currentPrice, shares, 
        planSettings, market, entryPriceUSD, exchangeRate, currentPriceUSD 
      };
      showToast('success', `✅ ${name} を更新しました`);
    }
    cancelEdit();
  } else {
    const newStock = {
      id: genId(),
      name, code,
      tags: tagsToSave,
      entryPrice, budget, currentPrice, shares,
      planSettings,
      market, entryPriceUSD, exchangeRate, currentPriceUSD,
      createdAt: new Date().toISOString(),
    };
    stocks.push(newStock);
    showToast('success', `✅ ${name} を登録しました！`);
  }

  saveData();
  resetForm();
  renderAll();
  updateCharts();
  setupNotifications();
  showPage('dashboard');
}

function resetForm() {
  document.getElementById('stock-form').reset();
  
  const mktJp = document.querySelector('input[name="input-market"][value="jp"]');
  if (mktJp) mktJp.checked = true;
  toggleMarketUI();

  document.getElementById('input-name').value = '';
  document.getElementById('input-code').value = '';
  document.getElementById('input-price').value = '';
  document.getElementById('input-usd-price').value = '';
  document.getElementById('input-usd-rate').value = '150';
  document.getElementById('input-usd-current').value = '';
  document.getElementById('input-budget').value = '';
  document.getElementById('input-current').value = '';
  document.getElementById('input-shares').value = '';
  selectedTags = [];
  document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('selected'));
  const customInput = document.getElementById('input-custom-tag');
  if (customInput) {
    customInput.style.display = 'none';
    customInput.value = '';
  }
  document.getElementById('input-np1-pct').value = 15;
  document.getElementById('input-np2-pct').value = 30;
  document.getElementById('input-stop-pct').value = 45;
  document.getElementById('input-tp1-pct').value = 20;
  document.getElementById('input-tp2-pct').value = 40;
  document.getElementById('input-tp1-frac').value = 3;
  document.getElementById('input-tp2-frac').value = 3;
  
  document.getElementById('preview-content').style.display = 'flex';
  document.getElementById('preview-result').style.display = 'none';
  document.getElementById('prev-name').textContent = '--';
  editingStockId = null;
  document.getElementById('submit-btn').innerHTML = '<span>✨ 銘柄を登録して計画を作成</span>';
  document.getElementById('edit-mode-bar').style.display = 'none';
}

function toggleOtherTag(btn) {
  const customInput = document.getElementById('input-custom-tag');
  if (btn.classList.contains('selected')) {
    btn.classList.remove('selected');
    customInput.style.display = 'none';
    customInput.value = '';
  } else {
    btn.classList.add('selected');
    customInput.style.display = 'block';
    customInput.focus();
  }
}

function toggleTag(btn, tag) {
  if (btn.classList.contains('selected')) {
    btn.classList.remove('selected');
    selectedTags = selectedTags.filter(t => t !== tag);
  } else {
    btn.classList.add('selected');
    selectedTags.push(tag);
  }
}

function editStock(id) {
  const stock = stocks.find(s => s.id === id);
  if (!stock) return;

  editingStockId = id;
  showPage('register');

  const isUS = stock.market === 'us';
  const mktRadio = document.querySelector(`input[name="input-market"][value="${isUS ? 'us' : 'jp'}"]`);
  if (mktRadio) mktRadio.checked = true;
  toggleMarketUI();

  document.getElementById('input-name').value = stock.name;
  document.getElementById('input-code').value = stock.code || '';
  document.getElementById('input-budget').value = stock.budget;
  document.getElementById('input-shares').value = stock.shares || '';

  if (isUS) {
    document.getElementById('input-usd-price').value = stock.entryPriceUSD || '';
    document.getElementById('input-usd-rate').value = stock.exchangeRate || 150;
    document.getElementById('input-usd-current').value = stock.currentPriceUSD || '';
  } else {
    document.getElementById('input-price').value = stock.entryPrice;
    document.getElementById('input-current').value = stock.currentPrice || '';
  }

  selectedTags = [];
  const predefinedTags = ['AI', '半導体', '電力', '金融', '医療', 'レアアース', 'キャリア通信', '自動車', '建設', '化学', '石油・石炭'];
  const customTags = [];
  
  document.querySelectorAll('.tag-btn:not(#tag-other-btn)').forEach(btn => {
    btn.classList.remove('selected');
    const tag = btn.textContent.trim().replace(/^[^ ]+ /, '');
    if ((stock.tags || []).includes(tag)) {
      btn.classList.add('selected');
      selectedTags.push(tag);
    }
  });

  (stock.tags || []).forEach(t => {
    if (!predefinedTags.includes(t)) {
      customTags.push(t);
    }
  });

  const otherBtn = document.getElementById('tag-other-btn');
  const customInput = document.getElementById('input-custom-tag');
  if (customTags.length > 0) {
    if (otherBtn) otherBtn.classList.add('selected');
    if (customInput) {
      customInput.style.display = 'block';
      customInput.value = customTags.join(', ');
    }
  } else {
    if (otherBtn) otherBtn.classList.remove('selected');
    if (customInput) {
      customInput.style.display = 'none';
      customInput.value = '';
    }
  }

  const conf = stock.planSettings || { np1Pct: 15, np2Pct: 30, stopPct: 45, tp1Pct: 20, tp2Pct: 40, tp1Frac: 3, tp2Frac: 3 };
  document.getElementById('input-np1-pct').value = conf.np1Pct;
  document.getElementById('input-np2-pct').value = conf.np2Pct;
  document.getElementById('input-stop-pct').value = conf.stopPct;
  document.getElementById('input-tp1-pct').value = conf.tp1Pct;
  document.getElementById('input-tp2-pct').value = conf.tp2Pct;
  document.getElementById('input-tp1-frac').value = conf.tp1Frac;
  document.getElementById('input-tp2-frac').value = conf.tp2Frac;

  document.getElementById('submit-btn').innerHTML = '<span>💾 変更を保存する</span>';
  document.getElementById('edit-mode-bar').style.display = 'flex';
  calcPreview();
}

function cancelEdit() {
  resetForm();
}

// ===== 削除 =====
function deleteStock(id) {
  const stock = stocks.find(s => s.id === id);
  if (!stock) return;
  if (!confirm(`「${stock.name}」を削除しますか？`)) return;
  stocks = stocks.filter(s => s.id !== id);
  saveData();
  renderAll();
  updateCharts();
  setupNotifications();
  showToast('info', `🗑️ ${stock.name} を削除しました`);
}

// ===== 株価更新モーダル =====
function openPriceModal(id) {
  updatePriceStockId = id;
  const stock = stocks.find(s => s.id === id);
  if (!stock) return;
  document.getElementById('price-modal-stock-name').textContent = stock.name;
  document.getElementById('price-input').value = stock.currentPrice || stock.entryPrice;

  // コードの有無でボタンの有効/無効を制御
  const fetchBtn = document.getElementById('auto-fetch-single-btn');
  const statusEl = document.getElementById('auto-fetch-status');
  const hasCode = stock.code && stock.code.trim() !== '';
  if (fetchBtn) {
    fetchBtn.disabled = !hasCode;
    fetchBtn.style.opacity = hasCode ? '1' : '0.4';
  }
  if (statusEl) {
    statusEl.textContent = hasCode
      ? `証券コード: ${stock.code}`
      : '⚠️ 証券コード未登録のため自動取得できません';
  }

  document.getElementById('price-modal-overlay').classList.add('open');
}
function closePriceModal(event) {
  if (event && event.target !== document.getElementById('price-modal-overlay')) return;
  document.getElementById('price-modal-overlay').classList.remove('open');
  updatePriceStockId = null;
}
function savePriceUpdate() {
  if (!updatePriceStockId) return;
  const newPrice = parseFloat(document.getElementById('price-input').value);
  if (!newPrice || newPrice <= 0) { showToast('error', '有効な株価を入力してください'); return; }
  const idx = stocks.findIndex(s => s.id === updatePriceStockId);
  if (idx !== -1) {
    const stock = stocks[idx];
    const old = stock.currentPrice || stock.entryPrice;
    stocks[idx].currentPrice = newPrice;
    saveData();
    renderAll();
    updateCharts();
    setupNotifications();
    const diff = ((newPrice - old) / old * 100).toFixed(1);
    showToast('success', `📡 ${stock.name} 株価更新: ¥${newPrice.toLocaleString()} (${diff > 0 ? '+' : ''}${diff}%)`);
  }
  document.getElementById('price-modal-overlay').classList.remove('open');
  updatePriceStockId = null;
}

// ===== 銘柄詳細モーダル =====
function openStockModal(id) {
  const stock = stocks.find(s => s.id === id);
  if (!stock) return;
  const cur = stock.currentPrice || stock.entryPrice;
  const plan = calcPlan(stock.entryPrice, stock.budget, cur, undefined, stock.planSettings);
  const st = getStatus(stock);
  const pct = ((cur - stock.entryPrice) / stock.entryPrice * 100);

  const investedAmt = cur * (stock.shares || 0);
  const budgetAmt = stock.budget * 10000;
  const investRate = budgetAmt > 0 ? Math.min(100, Math.round(investedAmt / budgetAmt * 100)) : 0;

  document.getElementById('modal-content').innerHTML = `
    <div style="padding-right:20px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; flex-wrap:wrap; gap:12px;">
        <div>
          <h2 style="font-size:22px; font-weight:800;">${stock.name}</h2>
          <div style="color:var(--text-muted); font-size:13px;">${stock.code || '----'}  |  登録日: ${new Date(stock.createdAt).toLocaleDateString('ja-JP')}</div>
          <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
            ${(stock.tags || []).map(t => `<span class="tag-pill">${t}</span>`).join('')}
            <span class="stock-status-badge ${st.badgeClass}">${st.label}</span>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:28px; font-weight:900; font-family:'Inter',sans-serif;">¥${cur.toLocaleString()}</div>
          ${stock.market === 'us' && stock.exchangeRate ? `<div style="font-size:16px; font-weight:700; color:var(--text-muted); opacity:0.85;">${fmtUSD(cur, stock.exchangeRate)}</div>` : ''}
          <div style="font-size:18px; font-weight:700; color:${pct>=0?'var(--color-safe)':'var(--color-danger)'};">${(pct>=0?'+':'')+pct.toFixed(1)}%</div>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:20px; flex-wrap:wrap;">
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:12px;">
          <div style="font-size:11px; color:var(--text-muted);">保有株数</div>
          <div style="font-size:18px; font-weight:800;">${(stock.shares||0)}株</div>
        </div>
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:12px;">
          <div style="font-size:11px; color:var(--text-muted);">評価額</div>
          <div style="font-size:18px; font-weight:800;">¥${Math.round(investedAmt).toLocaleString()}</div>
        </div>
        <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:12px;">
          <div style="font-size:11px; color:var(--text-muted);">投入率</div>
          <div style="font-size:18px; font-weight:800;">${investRate}%</div>
        </div>
      </div>

      ${plan ? `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
        <div>
          <div class="levels-title">📉 ナンピン計画</div>
          <div class="level-item li-buy-entry"><div><div class="li-label">初回 (50%)</div></div><div class="li-value">¥${plan.entryPrice.toLocaleString()}${usdSub(stock, plan.entryPrice)}</div></div>
          <div class="level-item li-buy1"><div><div class="li-label">NP① -${plan.settings.np1Pct}%</div></div><div class="li-value" style="${cur<=plan.nanpin1?'color:var(--color-warning)':''}">¥${plan.nanpin1.toLocaleString()}${usdSub(stock, plan.nanpin1)}</div></div>
          <div class="level-item li-buy2"><div><div class="li-label">NP② -${plan.settings.np2Pct}%</div></div><div class="li-value">¥${plan.nanpin2.toLocaleString()}${usdSub(stock, plan.nanpin2)}</div></div>
          <div class="level-item li-stop"><div><div class="li-label">損切り -${plan.settings.stopPct}%</div></div><div class="li-value" style="color:var(--color-danger);">¥${plan.stopLoss.toLocaleString()}${usdSub(stock, plan.stopLoss)}</div></div>
        </div>
        <div>
          <div class="levels-title">📈 利確計画（平均¥${plan.avgPrice.toLocaleString()}${usdInline(stock, plan.avgPrice)}基準）</div>
          <div class="level-item li-sell1"><div><div class="li-label">利確① +${plan.settings.tp1Pct}%（平均比）</div></div><div class="li-value">¥${plan.tp1.toLocaleString()}${usdSub(stock, plan.tp1)}</div></div>
          <div class="level-item li-sell2"><div><div class="li-label">利確② +${plan.settings.tp2Pct}%（平均比）</div></div><div class="li-value">¥${plan.tp2.toLocaleString()}${usdSub(stock, plan.tp2)}</div></div>
          <div class="level-item li-sell3"><div><div class="li-label">残り監視</div></div><div class="li-value">📡</div></div>
        </div>
      </div>
      ` : ''}

      <div style="display:flex; gap:10px; margin-top:20px; flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="closeStockModal(); openPriceModal('${stock.id}')">📡 株価更新</button>
        <button class="btn btn-ghost" onclick="closeStockModal(); editStock('${stock.id}')">✏️ 編集</button>
        <button class="btn btn-danger" onclick="closeStockModal(); deleteStock('${stock.id}')">🗑️ 削除</button>
      </div>
    </div>
  `;
  document.getElementById('modal-overlay').classList.add('open');
}
function closeStockModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function closeModal(event) {
  if (event.target === document.getElementById('modal-overlay')) closeStockModal();
}

// ===== グラフ初期化 =====
function setupCharts() {
  Chart.defaults.color = 'rgba(255,255,255,0.4)';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  updateCharts();
}

function updateCharts() {
  updatePortfolioChart();
  updateThemeChart();
}

function updatePortfolioChart() {
  const canvas = document.getElementById('portfolioChart');
  if (!canvas) return;
  if (portfolioChartInst) portfolioChartInst.destroy();

  if (stocks.length === 0) return;

  const labels = stocks.map(s => s.name);
  const data = stocks.map(s => {
    const cur = s.currentPrice || s.entryPrice;
    return Math.max(0, Math.round(cur * (s.shares || 0)));
  });
  const colors = [
    'rgba(99,102,241,0.8)', 'rgba(139,92,246,0.8)', 'rgba(16,185,129,0.8)',
    'rgba(245,158,11,0.8)', 'rgba(239,68,68,0.7)', 'rgba(59,130,246,0.8)',
    'rgba(236,72,153,0.8)', 'rgba(20,184,166,0.8)'
  ];

  portfolioChartInst = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverBorderWidth: 2, hoverBorderColor: 'white' }]
    },
    plugins: [ChartDataLabels],
    options: {
      animation: isFetchingAllPrices ? false : undefined,
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ¥${ctx.raw.toLocaleString()}` } },
        datalabels: {
          color: '#ffffff',
          font: { weight: 'bold', size: 12, family: 'Inter' },
          formatter: (value, ctx) => {
            const label = ctx.chart.data.labels[ctx.dataIndex];
            const dataset = ctx.chart.data.datasets[ctx.datasetIndex];
            const sum = dataset.data.reduce((a, b) => a + b, 0);
            const percentage = sum > 0 ? Math.round((value / sum) * 100) + '%' : '';
            return `${label}\n${percentage}`;
          },
          align: 'center',
          anchor: 'center',
          textAlign: 'center',
          textShadowBlur: 4,
          textShadowColor: 'rgba(0,0,0,0.8)'
        }
      }
    }
  });
}

function updateThemeChart() {
  const canvas = document.getElementById('themeChart');
  if (!canvas) return;
  if (themeChartInst) themeChartInst.destroy();

  const themeMap = {};
  stocks.forEach(s => {
    const cur = s.currentPrice || s.entryPrice;
    const val = Math.max(0, cur * (s.shares || 0));
    (s.tags || ['その他']).forEach(tag => {
      themeMap[tag] = (themeMap[tag] || 0) + val;
    });
  });

  if (Object.keys(themeMap).length === 0) return;

  const sortedThemes = Object.entries(themeMap).sort((a, b) => b[1] - a[1]);
  const labels = sortedThemes.map(item => item[0]);
  const data = sortedThemes.map(item => item[1]);
  const colors = [
    'rgba(99,102,241,0.8)', 'rgba(139,92,246,0.8)', 'rgba(16,185,129,0.8)',
    'rgba(245,158,11,0.8)', 'rgba(239,68,68,0.7)', 'rgba(59,130,246,0.8)',
    'rgba(236,72,153,0.8)', 'rgba(20,184,166,0.8)'
  ];

  themeChartInst = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderRadius: 6,
        borderWidth: 0,
      }]
    },
    plugins: [ChartDataLabels],
    options: {
      animation: isFetchingAllPrices ? false : undefined,
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ¥${ctx.raw.toLocaleString()}` } },
        datalabels: {
          color: '#ffffff',
          font: { weight: 'bold', size: 11, family: 'Inter' },
          formatter: (value, ctx) => {
            const label = ctx.chart.data.labels[ctx.dataIndex];
            const sum = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
            const percentage = sum > 0 ? Math.round((value / sum) * 100) + '%' : '';
            if (value === 0) return '';
            return `${label}\n${percentage}`;
          },
          align: 'center',
          anchor: 'center',
          textAlign: 'center',
          textShadowBlur: 4,
          textShadowColor: 'rgba(0,0,0,0.8)'
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 }, callback: v => '¥' + (v >= 10000 ? Math.round(v/10000)+'万' : v) }
        },
        x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 } } }
      }
    }
  });
}

// ===== 利益ログページ =====
function renderLogPage() {
  // サマリー
  const profits = profitLogs.map(l => l.profitAmount);
  const total = profits.reduce((a, b) => a + b, 0);
  const wins = profitLogs.filter(l => l.profitAmount > 0).length;
  const rate = profitLogs.length > 0 ? Math.round(wins / profitLogs.length * 100) : 0;
  const losses = profitLogs.filter(l => l.profitAmount < 0);
  const maxDd = losses.length > 0 ? Math.min(...losses.map(l => l.profitRate)).toFixed(1) : 0;

  document.getElementById('total-profit').textContent = (total >= 0 ? '+' : '') + '¥' + Math.round(total).toLocaleString();
  document.getElementById('total-profit').style.color = total >= 0 ? 'var(--color-safe)' : 'var(--color-danger)';
  document.getElementById('win-rate').textContent = rate + '%';
  document.getElementById('trade-count').textContent = profitLogs.length + '回';
  document.getElementById('max-dd').textContent = maxDd ? maxDd + '%' : '--%';

  // テーブル
  const tbody = document.getElementById('log-tbody');
  const emptyState = document.getElementById('log-empty-state');
  const table = document.getElementById('log-table');

  if (profitLogs.length === 0) {
    emptyState.style.display = 'block';
    table.style.display = 'none';
    return;
  }
  emptyState.style.display = 'none';
  table.style.display = 'table';

  tbody.innerHTML = [...profitLogs].reverse().map(log => {
    const date = new Date(log.date).toLocaleDateString('ja-JP');
    const isPosRate = log.profitRate >= 0;
    const isPos = log.profitAmount >= 0;
    const typeColors = {
      '利確①': 'background:rgba(16,185,129,0.15);color:var(--color-safe);',
      '利確②': 'background:rgba(16,185,129,0.25);color:var(--color-safe);',
      '全株売却': 'background:rgba(99,102,241,0.15);color:var(--color-accent-light);',
      '損切り': 'background:rgba(239,68,68,0.15);color:var(--color-danger);',
    };
    return `
      <tr>
        <td>${date}</td>
        <td><span class="log-stock-name">${log.stockName}</span></td>
        <td><span class="log-type-badge" style="${typeColors[log.type] || ''}">${log.type}</span></td>
        <td class="${isPosRate ? 'log-profit-positive' : 'log-profit-negative'}">${isPosRate ? '+' : ''}${log.profitRate.toFixed(1)}%</td>
        <td class="${isPos ? 'log-profit-positive' : 'log-profit-negative'}">${isPos ? '+' : ''}¥${Math.round(log.profitAmount).toLocaleString()}</td>
        <td><button class="log-delete-btn" onclick="deleteLog('${log.id}')">🗑️</button></td>
      </tr>
    `;
  }).join('');
}

function updateProfitChart() {
  const canvas = document.getElementById('profitChart');
  if (!canvas) return;
  if (profitChartInst) profitChartInst.destroy();
  if (profitLogs.length === 0) return;

  const sorted = [...profitLogs].sort((a, b) => new Date(a.date) - new Date(b.date));
  let cumulative = 0;
  const labels = [];
  const data = [];
  sorted.forEach(log => {
    cumulative += log.profitAmount;
    labels.push(new Date(log.date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }));
    data.push(Math.round(cumulative));
  });

  profitChartInst = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '累計利益',
        data,
        borderColor: 'rgba(99,102,241,0.9)',
        backgroundColor: 'rgba(99,102,241,0.1)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: 'rgba(99,102,241,1)',
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ¥${ctx.raw.toLocaleString()}` } }
      },
      scales: {
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: 'rgba(255,255,255,0.4)', callback: v => '¥' + v.toLocaleString() }
        },
        x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 11 } } }
      }
    }
  });
}

// ===== 利確ログモーダル =====
function openLogModal() {
  const select = document.getElementById('log-stock-select');
  select.innerHTML = '<option value="">銘柄を選択...</option>' +
    stocks.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
  document.getElementById('log-modal-overlay').classList.add('open');
}
function closeLogModal(event) {
  if (event && event.target !== document.getElementById('log-modal-overlay')) return;
  document.getElementById('log-modal-overlay').classList.remove('open');
}
function calcLogProfit() {
  const sell = parseFloat(document.getElementById('log-sell-price').value);
  const buy = parseFloat(document.getElementById('log-buy-price').value);
  const shares = parseFloat(document.getElementById('log-shares').value);
  const preview = document.getElementById('log-profit-preview');
  if (!sell || !buy || !shares) { preview.style.display = 'none'; return; }
  const rate = ((sell - buy) / buy) * 100;
  const amount = (sell - buy) * shares;
  document.getElementById('log-profit-rate').textContent = (rate >= 0 ? '+' : '') + rate.toFixed(1) + '%';
  document.getElementById('log-profit-rate').style.color = rate >= 0 ? 'var(--color-safe)' : 'var(--color-danger)';
  document.getElementById('log-profit-amount').textContent = (amount >= 0 ? '+' : '') + '¥' + Math.round(amount).toLocaleString();
  document.getElementById('log-profit-amount').style.color = amount >= 0 ? 'var(--color-safe)' : 'var(--color-danger)';
  preview.style.display = 'block';
}
function saveLog() {
  const stockName = document.getElementById('log-stock-select').value;
  const type = document.getElementById('log-type-select').value;
  const sell = parseFloat(document.getElementById('log-sell-price').value);
  const buy = parseFloat(document.getElementById('log-buy-price').value);
  const shares = parseFloat(document.getElementById('log-shares').value);
  if (!stockName || !sell || !buy || !shares) { showToast('error', '全ての項目を入力してください'); return; }
  const rate = ((sell - buy) / buy) * 100;
  const amount = (sell - buy) * shares;
  profitLogs.push({ id: genId(), stockName, type, sellPrice: sell, buyPrice: buy, shares, profitRate: rate, profitAmount: amount, date: new Date().toISOString() });
  saveData();
  renderLogPage();
  updateProfitChart();
  document.getElementById('log-modal-overlay').classList.remove('open');
  showToast('success', `📈 ${stockName} の利確を記録しました！`);
}
function deleteLog(id) {
  if (!confirm('このログを削除しますか？')) return;
  profitLogs = profitLogs.filter(l => l.id !== id);
  saveData();
  renderLogPage();
  updateProfitChart();
  showToast('info', '🗑️ ログを削除しました');
}

// ===== 通知システム =====
let unreadNotificationsCount = 0;

function setupNotifications() {
  const notifications = [];

  stocks.forEach(stock => {
    const cur = stock.currentPrice || stock.entryPrice;
    const plan = calcPlan(stock.entryPrice, stock.budget, cur, undefined, stock.planSettings);
    if (!plan) return;

    if (cur <= plan.stopLoss) {
      notifications.push({ type: 'danger', icon: '🚨', title: `【損切り警告】${stock.name}`, desc: `現在価格 ¥${cur.toLocaleString()}（損切りライン ¥${plan.stopLoss.toLocaleString()} 到達）`, time: '今すぐ確認' });
    } else if (cur <= plan.nanpin2) {
      notifications.push({ type: 'danger', icon: '🔵', title: `【最終NP】${stock.name}`, desc: `ナンピン②到達 ¥${cur.toLocaleString()} / NP②ライン ¥${plan.nanpin2.toLocaleString()}`, time: '要検討' });
    } else if (cur <= plan.nanpin1) {
      notifications.push({ type: 'warning', icon: '💡', title: `【NP①検討】${stock.name}`, desc: `ナンピン①ライン接近 ¥${plan.nanpin1.toLocaleString()}`, time: '今すぐ確認' });
    } else if (cur >= plan.tp2) {
      notifications.push({ type: 'safe', icon: '💰', title: `【利確②到達】${stock.name}`, desc: `+${plan.settings.tp2Pct}%到達！¥${cur.toLocaleString()} / 利確②ライン ¥${plan.tp2.toLocaleString()}`, time: '売却推奨' });
    } else if (cur >= plan.tp1) {
      notifications.push({ type: 'safe', icon: '🎯', title: `【利確①到達】${stock.name}`, desc: `+${plan.settings.tp1Pct}%到達！¥${cur.toLocaleString()} / 利確①ライン ¥${plan.tp1.toLocaleString()}`, time: `${plan.settings.tp1Frac === 1 ? '全株' : '1/' + plan.settings.tp1Frac}売却検討` });
    }
  });

  // 通知の状態が前回見た状態と異なる場合のみ未読とする
  const notifHash = JSON.stringify(notifications);
  const seenNotifHash = localStorage.getItem('pp_seen_notif_hash');
  
  if (notifications.length === 0) {
    unreadNotificationsCount = 0;
  } else if (notifHash !== seenNotifHash) {
    unreadNotificationsCount = notifications.length;
  } else {
    unreadNotificationsCount = 0;
  }
  
  // パネル開閉時用に現在のハッシュを保持
  window.currentNotifHash = notifHash;

  const badge = document.getElementById('notif-badge');
  if (unreadNotificationsCount > 0) {
    badge.textContent = unreadNotificationsCount;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  const list = document.getElementById('notif-list');
  if (notifications.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted); font-size:13px;">現在アクション通知はありません<br/>✅ 全ポジション安全圏</div>';
    return;
  }
  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.type}">
      <div class="notif-icon">${n.icon}</div>
      <div class="notif-text">
        <div class="notif-title">${n.title}</div>
        <div class="notif-desc">${n.desc}</div>
        <div class="notif-time">${n.time}</div>
      </div>
    </div>
  `).join('');
}

function toggleNotifications() {
  const panel = document.getElementById('notif-panel');
  const overlay = document.getElementById('notif-overlay');
  panel.classList.toggle('open');
  overlay.classList.toggle('open');

  // 通知パネルを開いたタイミングで既読にする
  if (panel.classList.contains('open')) {
    unreadNotificationsCount = 0;
    const badge = document.getElementById('notif-badge');
    if (badge) badge.style.display = 'none';
    
    // 現在の通知状態を「既読」としてローカルストレージに保存
    if (window.currentNotifHash) {
      localStorage.setItem('pp_seen_notif_hash', window.currentNotifHash);
    }
  }
}

// ===== Toast通知 =====
function showToast(type, msg) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ===== スクロール効果 =====
function setupScrollEffect() {
  window.addEventListener('scroll', () => {
    const navbar = document.getElementById('navbar');
    if (window.scrollY > 10) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  });
}

// ===================================================
// ===== リアルタイム株価取得 =====
// メインソース: stooq.com CSV (CORS不要・高速)
// フォールバック: Yahoo Finance + allorigins プロキシ
// 東証銘柄: コード.jp (stooq) / コード.T (Yahoo)
// ===================================================

let autoRefreshTimer = null;
let autoRefreshCountdownTimer = null;
let autoRefreshNextAt = null;
let lastUpdatedAt = null;
const AUTO_REFRESH_INTERVAL_MS = 3 * 60 * 1000; // 3分

// ===== stooq.com から単一銘柄の株価を取得 =====
async function fetchFromStooq(symbol) {
  const url = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error('stooq fetch failed');
  const text = await res.text();
  // CSVの2行目がデータ行: Symbol,Date,Time,Open,High,Low,Close,Volume
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('stooq no data');
  const cols = lines[1].split(',');
  const close = parseFloat(cols[6]);
  if (!close || close <= 0 || isNaN(close)) throw new Error('stooq invalid price');
  // 米国株など小数点以下がある場合はそのまま返す（後で為替を掛けた後にroundする）
  return { price: close };
}

// ===== Yahoo Finance + allorigins フォールバック =====
async function fetchFromYahoo(symbol) {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(yahooUrl)}`;
  const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('yahoo proxy failed');
  const text = await res.text();
  const wrapper = JSON.parse(text);
  const json = typeof wrapper.contents === 'string' ? JSON.parse(wrapper.contents) : wrapper;
  const result = json?.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice;
  if (!price || price <= 0) throw new Error('yahoo invalid price');
  return { price: price };
}

// ===== 判定ロジック =====
function getApiSymbols(rawCode) {
  const code = rawCode.trim().toUpperCase();
  // 先頭が数字（130A, 7203等）なら日本株とみなす。それ以外（AAPL等）は米国株を想定。
  if (/^\d/.test(code)) {
    return { stooq: code.toLowerCase() + '.jp', yahoo: code + '.T', isJapan: true };
  } else {
    // 既存で ".US" などを付けているケースも想定
    const cleanCode = code.replace(/\.US$/i, '');
    return { stooq: cleanCode.toLowerCase() + '.us', yahoo: cleanCode, isJapan: false };
  }
}

// ===== ドル円為替レートの取得 =====
async function fetchUsdJpyRate() {
  try {
    const res = await fetchFromStooq('usdjpy');
    return res.price;
  } catch (e) {
    // 取得失敗時は安全のためデフォルト値（例：150円）を返すがエラーを投げる
    throw new Error('為替レート取得失敗');
  }
}

// ===== 単一銘柄取得（stooq優先 → Yahooフォールバック）=====
async function fetchStockPrice(code, retryCount = 2) {
  if (!code || code.trim() === '') throw new Error('コードなし');
  
  const symbols = getApiSymbols(code);

  try {
    const res = await fetchFromStooq(symbols.stooq);
    return { price: res.price, isJapan: symbols.isJapan };
  } catch (e1) {
    try {
      const res = await fetchFromYahoo(symbols.yahoo);
      return { price: res.price, isJapan: symbols.isJapan };
    } catch (e2) {
      if (retryCount > 0) {
        // リトライ前に3秒待機（短時間のブロックを回避するため）
        await new Promise(resolve => setTimeout(resolve, 3000));
        return fetchStockPrice(code, retryCount - 1);
      }
      throw new Error(`${code}: 取得失敗`);
    }
  }
}

// ===== 全銘柄を直列順次更新 =====
async function updateAllPrices() {
  const codesStocks = stocks.filter(s => s.code && s.code.trim() !== '');
  const noCodeStocks = stocks.filter(s => !s.code || s.code.trim() === '');

  if (codesStocks.length === 0) {
    showToast('info', '📋 証券コードが登録されている銘柄がありません<br>銘柄登録で証券コードを入力してください');
    return;
  }

  setFetchBtnState('loading');
  isFetchingAllPrices = true;
  showToast('info', `📡 ${codesStocks.length}銘柄の株価を順番に取得中...<br>完了までしばらくお待ちください。`);

  let successCount = 0, failCount = 0;
  const resultMessages = [];
  let usdJpyRate = null;

  for (let i = 0; i < codesStocks.length; i++) {
    const stock = codesStocks[i];
    
    // 進捗テキストの更新
    const btn = document.getElementById('fetch-all-btn');
    if (btn) btn.innerHTML = `<span class="spin">⟳</span> 取得中... (${i + 1}/${codesStocks.length})`;

    try {
      // 最初のリクエスト以外で待機（レート制限回避のため）
      if (i > 0) {
        await new Promise(r => setTimeout(r, 2000));
      }
      const result = await fetchStockPrice(stock.code);
      
      let finalPrice = result.price;
      // 米国株の場合は円換算
      if (!result.isJapan) {
        if (!usdJpyRate) {
          usdJpyRate = await fetchUsdJpyRate();
          await new Promise(r => setTimeout(r, 1000)); // API負荷軽減用
        }
        finalPrice = Math.round(result.price * usdJpyRate);
      } else {
        finalPrice = Math.round(result.price);
      }
      
      const idx = stocks.findIndex(s => s.id === stock.id);
      if (idx !== -1) {
        const old = stocks[idx].currentPrice || stocks[idx].entryPrice;
        stocks[idx].currentPrice = finalPrice;
        const diff = ((finalPrice - old) / old * 100).toFixed(1);
        resultMessages.push(`${stock.name}: ¥${finalPrice.toLocaleString()} (${Number(diff) > 0 ? '+' : ''}${diff}%)`);
        successCount++;
        
        // 取得成功のたびに随時画面へ反映する
        saveData();
        lastUpdatedAt = new Date();
        updateLastUpdatedLabel();
        renderAll();
        updateCharts();
        setupNotifications();
      }
    } catch (e) {
      resultMessages.push(`${stock.name}: ❌`);
      failCount++;
    }
  }

  if (noCodeStocks.length > 0) {
    showToast('info', `ℹ️ コード未入力でスキップ: ${noCodeStocks.map(s => s.name).join(', ')}`);
  }

  isFetchingAllPrices = false;
  setFetchBtnState('idle');

  if (successCount > 0) {
    showToast('success',
      `✅ ${successCount}銘柄更新完了<br><span style="font-size:11px;opacity:0.8;">${resultMessages.filter(m => !m.includes('❌')).join(' / ')}</span>`);
  }
  if (failCount > 0) {
    showToast('error', `⚠️ ${failCount}銘柄が取得失敗（証券コード確認またはしばらくお待ちください）`);
  }
}

// ===== 個別銘柄の株価を自動取得してモーダルに入れる =====
async function fetchSinglePrice(id) {
  const stock = stocks.find(s => s.id === id);
  if (!stock || !stock.code) {
    showToast('error', '証券コードが未登録です'); return;
  }
  const btn = document.getElementById('auto-fetch-single-btn');
  if (btn) { btn.disabled = true; btn.textContent = '取得中...'; }
  try {
    const result = await fetchStockPrice(stock.code);
    let finalPrice = result.price;
    if (!result.isJapan) {
      const usdJpyRate = await fetchUsdJpyRate();
      finalPrice = Math.round(result.price * usdJpyRate);
    } else {
      finalPrice = Math.round(result.price);
    }

    document.getElementById('price-input').value = finalPrice;
    showToast('success', `📡 ${stock.name}: ¥${finalPrice.toLocaleString()} を取得しました`);
  } catch (e) {
    showToast('error', `⚠️ 取得失敗: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 自動取得'; }
  }
}

// ===== ボタンの状態切替 =====
function setFetchBtnState(state) {
  const btn = document.getElementById('fetch-all-btn');
  if (!btn) return;
  if (state === 'loading') {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">⟳</span> 取得中...';
  } else {
    btn.disabled = false;
    btn.innerHTML = '📡 株価を一括取得';
  }
}

// ===== 最終更新時刻ラベルを更新 =====
function updateLastUpdatedLabel() {
  const el = document.getElementById('last-updated-label');
  if (!el) return;
  el.textContent = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '未取得';
}

// ===== カウントダウン表示 =====
function startCountdown() {
  if (autoRefreshCountdownTimer) clearInterval(autoRefreshCountdownTimer);
  autoRefreshCountdownTimer = setInterval(() => {
    if (!autoRefreshNextAt) return;
    const remaining = Math.max(0, Math.round((autoRefreshNextAt - Date.now()) / 1000));
    const btn = document.getElementById('auto-refresh-btn');
    if (btn) btn.textContent = `🟢 次回更新 ${remaining}秒後`;
  }, 1000);
}

function stopCountdown() {
  if (autoRefreshCountdownTimer) clearInterval(autoRefreshCountdownTimer);
  autoRefreshCountdownTimer = null;
  autoRefreshNextAt = null;
}

// ===== 自動更新のON/OFF =====
function toggleAutoRefresh() {
  const btn = document.getElementById('auto-refresh-btn');
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    stopCountdown();
    if (btn) {
      btn.textContent = '🔄 自動更新: OFF';
      btn.classList.remove('btn-active-green');
    }
    showToast('info', '⏹ 自動更新を停止しました');
  } else {
    const doRefresh = () => {
      updateAllPrices();
      autoRefreshNextAt = Date.now() + AUTO_REFRESH_INTERVAL_MS;
    };
    doRefresh(); // 即時実行
    autoRefreshTimer = setInterval(doRefresh, AUTO_REFRESH_INTERVAL_MS);
    autoRefreshNextAt = Date.now() + AUTO_REFRESH_INTERVAL_MS;
    startCountdown();
    if (btn) {
      btn.classList.add('btn-active-green');
    }
    showToast('success', '▶ 自動更新を開始しました（3分ごと）');
  }
}

// ===== ナンピン買いモーダル =====
function openNanpinModal(id) {
  nanpinTargetId = id;
  const stock = stocks.find(s => s.id === id);
  if (!stock) return;
  const pos = calcActualPosition(stock);
  const cur = stock.currentPrice || stock.entryPrice;
  const plan = calcPlan(stock.entryPrice, stock.budget, cur, pos.avgPrice);

  document.getElementById('nanpin-stock-name').textContent = stock.name;

  // NP推奨ラインを表示
  const sug = document.getElementById('nanpin-suggestion');
  if (plan) {
    if (cur <= plan.stopLoss) {
      sug.innerHTML = `<div class="np-sug danger">⚠️ 損切りゾーン到達 ¥${plan.stopLoss.toLocaleString()} 以下。NP③は非推奨</div>`;
    } else if (cur <= plan.nanpin2) {
      sug.innerHTML = `<div class="np-sug danger">🔵 NP②推奨ライン: ¥${plan.nanpin2.toLocaleString()} 付近（${Math.round(plan.invest3/10000*10)/10}万円追加）</div>`;
      document.getElementById('nanpin-price-in').value = plan.nanpin2;
    } else if (cur <= plan.nanpin1) {
      sug.innerHTML = `<div class="np-sug warning">💡 NP①推奨ライン: ¥${plan.nanpin1.toLocaleString()} 付近（${Math.round(plan.invest2/10000*10)/10}万円追加）</div>`;
      document.getElementById('nanpin-price-in').value = plan.nanpin1;
    } else {
      sug.innerHTML = `<div class="np-sug safe">✅ NP①: ¥${plan.nanpin1.toLocaleString()} / NP②: ¥${plan.nanpin2.toLocaleString()}</div>`;
      document.getElementById('nanpin-price-in').value = '';
    }
  }

  document.getElementById('nanpin-shares-in').value = '';
  document.getElementById('nanpin-preview').style.display = 'none';
  document.getElementById('nanpin-modal-overlay').classList.add('open');
  calcNanpinPreview();
}

function closeNanpinModal(e) {
  if (e && e.target !== document.getElementById('nanpin-modal-overlay')) return;
  document.getElementById('nanpin-modal-overlay').classList.remove('open');
  nanpinTargetId = null;
}

function calcNanpinPreview() {
  if (!nanpinTargetId) return;
  const stock = stocks.find(s => s.id === nanpinTargetId);
  if (!stock) return;
  const buyPrice = parseFloat(document.getElementById('nanpin-price-in').value);
  const buyShares = parseFloat(document.getElementById('nanpin-shares-in').value);
  const prev = document.getElementById('nanpin-preview');
  if (!buyPrice || !buyShares || buyPrice <= 0 || buyShares <= 0) { prev.style.display = 'none'; return; }

  const pos = calcActualPosition(stock);
  const afterCost = pos.avgPrice * pos.shares + buyPrice * buyShares;
  const afterShares = pos.shares + buyShares;
  const afterAvg = Math.round(afterCost / afterShares);
  const cost = Math.round(buyPrice * buyShares);

  document.getElementById('np-before-avg').textContent = `¥${pos.avgPrice.toLocaleString()}`;
  document.getElementById('np-after-avg').textContent = `¥${afterAvg.toLocaleString()}`;
  document.getElementById('np-after-shares').textContent = `${afterShares.toLocaleString()}株`;
  document.getElementById('np-cost').textContent = `¥${cost.toLocaleString()}`;
  prev.style.display = 'block';
}

function saveNanpin() {
  if (!nanpinTargetId) return;
  const stock = stocks.find(s => s.id === nanpinTargetId);
  if (!stock) return;
  const buyPrice = parseFloat(document.getElementById('nanpin-price-in').value);
  const buyShares = parseFloat(document.getElementById('nanpin-shares-in').value);
  if (!buyPrice || !buyShares || buyPrice <= 0 || buyShares <= 0) {
    showToast('error', '価格と株数を入力してください'); return;
  }

  // tradesが未初期化の場合は既存データから初期化
  if (!stock.trades) {
    stock.trades = stock.shares > 0 ? [{ id: genId(), type: 'buy', price: stock.entryPrice, shares: stock.shares, date: stock.createdAt, note: '初回エントリー' }] : [];
  }

  stock.trades.push({ id: genId(), type: 'buy', price: buyPrice, shares: buyShares, date: new Date().toISOString(), note: 'ナンピン' });
  const newPos = calcActualPosition(stock);

  saveData(); renderAll(); updateCharts(); setupNotifications();
  document.getElementById('nanpin-modal-overlay').classList.remove('open');
  nanpinTargetId = null;
  showToast('success', `✅ ${stock.name} ナンピン完了！<br>平均単価 ¥${newPos.avgPrice.toLocaleString()} / ${newPos.shares}株`);
}

// ===== 利確実行モーダル =====
function openQuickSellModal(id) {
  quickSellTargetId = id;
  const stock = stocks.find(s => s.id === id);
  if (!stock) return;
  const pos = calcActualPosition(stock);
  const cur = stock.currentPrice || stock.entryPrice;
  const plan = calcPlan(stock.entryPrice, stock.budget, cur, pos.avgPrice);

  document.getElementById('qs-stock-name').textContent = stock.name;

  const sug = document.getElementById('qs-suggestion');
  if (plan) {
    if (cur >= plan.tp2) {
      sug.innerHTML = `<div class="np-sug safe">💰 利確②到達！¥${plan.tp2.toLocaleString()} 以上（1/3売却推奨）</div>`;
      document.getElementById('qs-type').value = '利確②';
    } else if (cur >= plan.tp1) {
      sug.innerHTML = `<div class="np-sug warning">🎯 利確①到達！¥${plan.tp1.toLocaleString()} 以上（1/3売却推奨）</div>`;
      document.getElementById('qs-type').value = '利確①';
    } else {
      const d = ((plan.tp1 - cur) / cur * 100).toFixed(1);
      sug.innerHTML = `<div class="np-sug safe">📡 利確①まで +${d}%（¥${plan.tp1.toLocaleString()}）</div>`;
      document.getElementById('qs-type').value = '利確①';
    }
  }
  document.getElementById('qs-sell-price').value = cur;
  const sug1_3 = Math.max(1, Math.floor(pos.shares / 3));
  document.getElementById('qs-sell-shares').value = sug1_3;
  document.getElementById('qs-preview').style.display = 'none';
  document.getElementById('qs-overlay').classList.add('open');
  calcQuickSellPreview();
}

function closeQuickSell(e) {
  if (e && e.target !== document.getElementById('qs-overlay')) return;
  document.getElementById('qs-overlay').classList.remove('open');
  quickSellTargetId = null;
}

function calcQuickSellPreview() {
  if (!quickSellTargetId) return;
  const stock = stocks.find(s => s.id === quickSellTargetId);
  if (!stock) return;
  const sellPrice = parseFloat(document.getElementById('qs-sell-price').value);
  const sellShares = parseFloat(document.getElementById('qs-sell-shares').value);
  const prev = document.getElementById('qs-preview');
  if (!sellPrice || !sellShares || sellPrice <= 0 || sellShares <= 0) { prev.style.display = 'none'; return; }

  const pos = calcActualPosition(stock);
  const rate = pos.avgPrice > 0 ? ((sellPrice - pos.avgPrice) / pos.avgPrice * 100) : 0;
  const amount = Math.round((sellPrice - pos.avgPrice) * sellShares);
  const remaining = Math.max(0, pos.shares - sellShares);

  document.getElementById('qs-avg-disp').textContent = `¥${pos.avgPrice.toLocaleString()}`;
  document.getElementById('qs-rate').textContent = `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}%`;
  document.getElementById('qs-rate').style.color = rate >= 0 ? 'var(--color-safe)' : 'var(--color-danger)';
  document.getElementById('qs-amount').textContent = `${amount >= 0 ? '+' : ''}¥${amount.toLocaleString()}`;
  document.getElementById('qs-amount').style.color = amount >= 0 ? 'var(--color-safe)' : 'var(--color-danger)';
  document.getElementById('qs-remain').textContent = `${remaining.toLocaleString()}株`;
  prev.style.display = 'block';
}

function saveQuickSell() {
  if (!quickSellTargetId) return;
  const stock = stocks.find(s => s.id === quickSellTargetId);
  if (!stock) return;
  const sellPrice = parseFloat(document.getElementById('qs-sell-price').value);
  const sellShares = parseFloat(document.getElementById('qs-sell-shares').value);
  const sellType = document.getElementById('qs-type').value;
  if (!sellPrice || !sellShares || sellPrice <= 0 || sellShares <= 0) {
    showToast('error', '売却価格と株数を入力してください'); return;
  }
  const pos = calcActualPosition(stock);
  if (sellShares > pos.shares) {
    showToast('error', `売却株数が保有株数(${pos.shares}株)を超えています`); return;
  }

  if (!stock.trades) {
    stock.trades = stock.shares > 0 ? [{ id: genId(), type: 'buy', price: stock.entryPrice, shares: stock.shares, date: stock.createdAt, note: '初回エントリー' }] : [];
  }
  stock.trades.push({ id: genId(), type: 'sell', price: sellPrice, shares: sellShares, date: new Date().toISOString(), note: sellType });

  const rate = pos.avgPrice > 0 ? ((sellPrice - pos.avgPrice) / pos.avgPrice * 100) : 0;
  const amount = Math.round((sellPrice - pos.avgPrice) * sellShares);
  profitLogs.push({ id: genId(), stockName: stock.name, type: sellType, sellPrice, buyPrice: pos.avgPrice, shares: sellShares, profitRate: rate, profitAmount: amount, date: new Date().toISOString() });

  saveData(); renderAll(); updateCharts(); setupNotifications();
  document.getElementById('qs-overlay').classList.remove('open');
  quickSellTargetId = null;
  const s = amount >= 0 ? '+' : '';
  showToast('success', `💰 ${stock.name} 利確完了！<br>${s}¥${Math.abs(amount).toLocaleString()} (${s}${rate.toFixed(1)}%)`);
}

// ===== アプリ起動 =====
window.addEventListener('DOMContentLoaded', init);
