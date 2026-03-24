// ===== 株価取得（Stooq → Yahoo フォールバック） =====
// Worker側ではCORS制約がないため、直接APIにアクセスできる

// Stooqから株価を取得
async function fetchFromStooq(symbol) {
  const url = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=csv`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('stooq fetch failed');
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('stooq no data');
  const cols = lines[1].split(',');
  const close = parseFloat(cols[6]);
  if (!close || close <= 0 || isNaN(close)) throw new Error('stooq invalid price');
  return { price: close };
}

// Yahoo Financeから株価を取得（Worker側は直接アクセス可能、プロキシ不要）
async function fetchFromYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error('yahoo fetch failed');
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice;
  if (!price || price <= 0) throw new Error('yahoo invalid price');
  return { price };
}

// 証券コードからAPIシンボルを生成
function getApiSymbols(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (/^\d/.test(code)) {
    return { stooq: code.toLowerCase() + '.jp', yahoo: code + '.T', isJapan: true };
  } else {
    const cleanCode = code.replace(/\.US$/i, '');
    return { stooq: cleanCode.toLowerCase() + '.us', yahoo: cleanCode, isJapan: false };
  }
}

// 単一銘柄の株価を取得（Stooq優先 → Yahooフォールバック）
export async function fetchStockPrice(code, retryCount = 1) {
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
        await new Promise(r => setTimeout(r, 2000));
        return fetchStockPrice(code, retryCount - 1);
      }
      throw new Error(`${code}: 取得失敗`);
    }
  }
}

// USD/JPYレートを取得
export async function fetchUsdJpyRate() {
  try {
    const res = await fetchFromStooq('usdjpy');
    return res.price;
  } catch (e) {
    // Stooq失敗時はYahooを試す
    try {
      const res = await fetchFromYahoo('USDJPY=X');
      return res.price;
    } catch (e2) {
      throw new Error('為替レート取得失敗');
    }
  }
}
