// ===== PositionPilot Cloudflare Worker =====
// 定期的に株価を取得し、ナンピン/利確/損切りラインに到達したらLINEで通知する

import { calcPlan, calcActualPosition, getStatus, defaultSettings } from './plan.js';
import { fetchStockPrice, fetchUsdJpyRate } from './price.js';
import { sendLineNotify, formatNotification } from './notify.js';

// ===== メインハンドラ =====
export default {
  // --- API エンドポイント ---
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 認証チェック
    const authOk = validateAuth(request, env);

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    // POST /api/sync — フロントエンドから銘柄データを同期
    if (url.pathname === '/api/sync' && request.method === 'POST') {
      if (!authOk) return json({ error: 'Unauthorized' }, 401);
      try {
        const body = await request.json();
        if (!Array.isArray(body.stocks)) {
          return json({ error: 'stocks must be an array' }, 400);
        }
        await env.KV.put('stocks', JSON.stringify(body.stocks));
        if (Array.isArray(body.profitLogs)) {
          await env.KV.put('profitLogs', JSON.stringify(body.profitLogs));
        }
        return json({ ok: true, count: body.stocks.length });
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }

    // GET /api/stocks — KVから銘柄データを取得
    if (url.pathname === '/api/stocks' && request.method === 'GET') {
      if (!authOk) return json({ error: 'Unauthorized' }, 401);
      const stocksRaw = await env.KV.get('stocks');
      const logsRaw = await env.KV.get('profitLogs');
      return json({
        stocks: stocksRaw ? JSON.parse(stocksRaw) : [],
        profitLogs: logsRaw ? JSON.parse(logsRaw) : [],
      });
    }

    // GET /api/status — ステータス確認
    if (url.pathname === '/api/status' && request.method === 'GET') {
      if (!authOk) return json({ error: 'Unauthorized' }, 401);
      const lastRun = await env.KV.get('last_run');
      const stocksRaw = await env.KV.get('stocks');
      const stocks = stocksRaw ? JSON.parse(stocksRaw) : [];
      return json({ lastRun, stockCount: stocks.length });
    }

    // POST /api/check — 手動で株価チェック実行（テスト用）
    if (url.pathname === '/api/check' && request.method === 'POST') {
      if (!authOk) return json({ error: 'Unauthorized' }, 401);
      const results = await runPriceCheck(env);
      return json({ ok: true, results });
    }

    // POST /api/test-line — LINE通知テスト
    if (url.pathname === '/api/test-line' && request.method === 'POST') {
      if (!authOk) return json({ error: 'Unauthorized' }, 401);
      try {
        await sendLineNotify(env.LINE_CHANNEL_TOKEN,
          `✅ PositionPilot 接続テスト\n━━━━━━━━━━━━━━\n🤖 LINE通知は正常に動作しています！\n📅 ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n🔗 https://zcvixs422-arch.github.io/positionpilot/`,
          env.LINE_USER_ID);
        return json({ ok: true, message: 'LINE送信成功' });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    return json({ error: 'Not Found' }, 404);
  },

  // --- Cron トリガー（5分ごと） ---
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPriceCheck(env));
  },
};

// ===== 認証 =====
function validateAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.replace('Bearer ', '');
  return token && token === env.API_TOKEN;
}

// ===== 株価チェック＆通知のメインロジック =====
async function runPriceCheck(env) {
  const stocksRaw = await env.KV.get('stocks');
  if (!stocksRaw) return [];
  const stocks = JSON.parse(stocksRaw);
  if (stocks.length === 0) return [];

  const results = [];
  let usdJpyRate = null;

  // USD/JPYレートのキャッシュ確認
  const hasUSStock = stocks.some(s => s.code && s.market === 'us');
  if (hasUSStock) {
    const cached = await env.KV.get('exchange_rate:usdjpy', 'json');
    if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < 15 * 60 * 1000) {
      usdJpyRate = cached.rate;
    } else {
      try {
        usdJpyRate = await fetchUsdJpyRate();
        await env.KV.put('exchange_rate:usdjpy', JSON.stringify({
          rate: usdJpyRate,
          fetchedAt: new Date().toISOString(),
        }));
      } catch (e) {
        // 失敗時はフォールバック
        usdJpyRate = cached ? cached.rate : 150;
      }
    }
  }

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    if (!stock.code || stock.code.trim() === '') {
      results.push({ name: stock.name, status: 'skipped', reason: 'コードなし' });
      continue;
    }

    // レート制限回避: 1秒間隔
    if (i > 0) await sleep(1000);

    try {
      const priceResult = await fetchStockPrice(stock.code);
      let currentPrice = priceResult.price;

      // 米国株は円換算
      if (!priceResult.isJapan && usdJpyRate) {
        stock.currentPriceUSD = priceResult.price;
        currentPrice = Math.round(priceResult.price * usdJpyRate);
      } else {
        currentPrice = Math.round(currentPrice);
      }

      stock.currentPrice = currentPrice;

      // ステータス判定
      const pos = calcActualPosition(stock);
      const plan = calcPlan(stock.entryPrice, stock.budget, currentPrice, pos.avgPrice, stock.planSettings);
      const st = getStatus(stock);

      const result = {
        name: stock.name,
        code: stock.code,
        price: currentPrice,
        action: st.action,
        status: st.status,
        notified: false,
      };

      // HOLD以外ならLINE通知を検討
      if (st.action !== 'HOLD' && plan) {
        const dedupKey = `notif:${stock.id}:${st.action}`;
        const shouldSend = await shouldNotify(env.KV, dedupKey);

        if (shouldSend) {
          const message = formatNotification(stock, st, plan, currentPrice);
          try {
            await sendLineNotify(env.LINE_CHANNEL_TOKEN, message, env.LINE_USER_ID);
            await markNotified(env.KV, dedupKey);
            result.notified = true;
          } catch (e) {
            result.notifyError = e.message;
          }
        } else {
          result.notified = false;
          result.deduplicated = true;
        }
      }

      results.push(result);
    } catch (e) {
      results.push({ name: stock.name, code: stock.code, status: 'error', error: e.message });
    }
  }

  // 更新された株価をKVに保存
  await env.KV.put('stocks', JSON.stringify(stocks));
  await env.KV.put('last_run', new Date().toISOString());

  return results;
}

// ===== 通知の重複排除 =====
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4時間

async function shouldNotify(kv, key) {
  const lastTime = await kv.get(key);
  if (!lastTime) return true;
  return Date.now() - new Date(lastTime).getTime() > COOLDOWN_MS;
}

async function markNotified(kv, key) {
  await kv.put(key, new Date().toISOString(), { expirationTtl: 86400 });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
