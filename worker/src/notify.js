// ===== LINE Messaging API 通知 =====

// Push Message で自分に通知を送る
export async function sendLineNotify(channelAccessToken, message, userId) {
  if (!channelAccessToken) throw new Error('LINE_CHANNEL_TOKEN が未設定です');
  if (!userId) throw new Error('LINE_USER_ID が未設定です');

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${channelAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: userId,
      messages: [
        {
          type: 'text',
          text: message,
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE送信失敗 (${res.status}): ${text}`);
  }
}

// 通知メッセージのフォーマット
export function formatNotification(stock, status, plan, currentPrice) {
  const yen = (v) => '¥' + v.toLocaleString();
  const pctStr = status.pct !== undefined ? `${status.pct >= 0 ? '+' : ''}${status.pct.toFixed(1)}%` : '';
  const isUS = stock.market === 'us';
  const usdStr = isUS && stock.exchangeRate
    ? ` ($${(currentPrice / stock.exchangeRate).toFixed(2)})`
    : '';

  let emoji, title, detail, urgency;

  switch (status.action) {
    case 'STOP-LOSS':
      emoji = '🚨';
      title = '損切り警告';
      detail = `損切りライン ${yen(plan.stopLoss)} を下回りました`;
      urgency = '⚠️ 今すぐ確認してください';
      break;

    case 'NANPIN②':
      emoji = '🔵';
      title = '最終ナンピン到達';
      detail = `NP②ライン ${yen(plan.nanpin2)} に到達\n追加投資: ${Math.round(plan.invest3 / 10000 * 10) / 10}万円`;
      urgency = '📉 最終ナンピンを検討';
      break;

    case 'NANPIN①':
      emoji = '💡';
      title = 'ナンピン①検討';
      detail = `NP①ライン ${yen(plan.nanpin1)} に接近\n追加投資: ${Math.round(plan.invest2 / 10000 * 10) / 10}万円`;
      urgency = '📉 ナンピンを検討';
      break;

    case '利確②':
      emoji = '💰';
      title = '利確②到達！';
      detail = `利確②ライン ${yen(plan.tp2)} に到達 (+${plan.settings.tp2Pct}%)`;
      urgency = '📈 売却を強く推奨';
      break;

    case '利確①':
      emoji = '🎯';
      title = '利確①到達！';
      const frac = plan.settings.tp1Frac === 1 ? '全株' : `1/${plan.settings.tp1Frac}`;
      detail = `利確①ライン ${yen(plan.tp1)} に到達 (+${plan.settings.tp1Pct}%)`;
      urgency = `📈 ${frac}売却を検討`;
      break;

    default:
      return null;
  }

  return `${emoji} ${title}
━━━━━━━━━━━━━━
📌 ${stock.name} (${stock.code || '----'})
💹 現在価格: ${yen(currentPrice)}${usdStr}
📊 変動率: ${pctStr}

${detail}

${urgency}
━━━━━━━━━━━━━━
🤖 PositionPilot 自動監視`;
}
