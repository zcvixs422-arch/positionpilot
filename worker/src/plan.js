// ===== 投資計画計算（app.jsからの移植） =====

export const defaultSettings = {
  np1Pct: 15, np2Pct: 30, stopPct: 45,
  tp1Pct: 20, tp2Pct: 40, tp1Frac: 3, tp2Frac: 3
};

// 実ポジション計算（取引履歴ベース）
export function calcActualPosition(stock) {
  const trades = stock.trades || [];
  if (trades.length === 0) {
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

// 投資計画計算
export function calcPlan(entryPrice, budget, currentPrice, avgPriceOverride, settings = {}) {
  const ep = parseFloat(entryPrice);
  const bp = parseFloat(budget) * 10000;
  if (!ep || !bp) return null;

  const conf = { ...defaultSettings, ...settings };

  const nanpin1  = Math.round(ep * (1 - conf.np1Pct / 100));
  const nanpin2  = Math.round(ep * (1 - conf.np2Pct / 100));
  const stopLoss = Math.round(ep * (1 - conf.stopPct / 100));

  const invest1 = Math.round(bp * 0.5);
  const invest2 = Math.round(bp * 0.3);
  const invest3 = Math.round(bp * 0.2);

  const cur = parseFloat(currentPrice) || ep;

  let totalCost   = invest1;
  let totalShares = invest1 / ep;

  let npPhase = 0;
  if (cur <= nanpin2) {
    totalCost   += invest2 + invest3;
    totalShares += invest2 / nanpin1 + invest3 / nanpin2;
    npPhase = 2;
  } else if (cur <= nanpin1) {
    totalCost   += invest2;
    totalShares += invest2 / nanpin1;
    npPhase = 1;
  }

  const theoreticalAvg = Math.round(totalCost / totalShares);
  const avgPrice = (avgPriceOverride !== undefined && avgPriceOverride > 0)
    ? Math.round(avgPriceOverride) : theoreticalAvg;

  const tp1 = Math.round(avgPrice * (1 + conf.tp1Pct / 100));
  const tp2 = Math.round(avgPrice * (1 + conf.tp2Pct / 100));

  return {
    entryPrice: ep, budget: bp,
    nanpin1, nanpin2, stopLoss,
    invest1, invest2, invest3,
    avgPrice, tp1, tp2, npPhase,
    settings: conf
  };
}

// ステータス判定
export function getStatus(stock) {
  const cur = stock.currentPrice || stock.entryPrice;
  const pos = calcActualPosition(stock);
  const plan = calcPlan(stock.entryPrice, stock.budget, cur, pos.avgPrice, stock.planSettings);
  if (!plan) return { status: 'safe', action: 'HOLD', pct: 0 };

  const pct = ((cur - stock.entryPrice) / stock.entryPrice) * 100;

  if (cur <= plan.stopLoss) {
    return { status: 'danger', action: 'STOP-LOSS', pct };
  }
  if (cur <= plan.nanpin2) {
    return { status: 'danger', action: 'NANPIN②', pct };
  }
  if (cur <= plan.nanpin1) {
    return { status: 'warning', action: 'NANPIN①', pct };
  }
  if (cur >= plan.tp2) {
    return { status: 'warning', action: '利確②', pct };
  }
  if (cur >= plan.tp1) {
    return { status: 'warning', action: '利確①', pct };
  }
  return { status: 'safe', action: 'HOLD', pct };
}
