# PositionPilot Worker セットアップ手順

## 概要
Cloudflare Workers を使って、5分ごとに自動で株価を取得し、
ナンピン/利確/損切りラインに到達したら **LINE** に通知を送ります。
**完全無料**で運用できます。

---

## 1. LINE Messaging API の準備

### 1-1. LINE公式アカウントを作成
1. https://developers.line.biz/console/ にアクセス
2. LINEアカウントでログイン
3. 「新規プロバイダー」を作成（名前は「PositionPilot」等）
4. 「Messaging API」チャネルを作成
   - チャネル名: `PositionPilot` など
   - それ以外はデフォルトでOK

### 1-2. チャネルアクセストークンを取得
1. 作成したチャネルの「Messaging API設定」タブを開く
2. ページ下部の「チャネルアクセストークン（長期）」を発行
3. このトークンを**メモ**しておく → `LINE_CHANNEL_TOKEN` に使う

### 1-3. 自分のユーザーIDを取得
1. 同じチャネルの「チャネル基本設定」タブ
2. 「あなたのユーザーID」が表示されている（`U` で始まる英数字）
3. これを**メモ** → `LINE_USER_ID` に使う

### 1-4. 公式アカウントを友だち追加
1. 「Messaging API設定」タブにQRコードがある
2. **自分のLINEで友だち追加**する（これをしないと通知が届きません）

### 1-5. 応答メッセージをOFFにする（推奨）
1. 「Messaging API設定」→「LINE公式アカウント機能」→「応答メッセージ」
2. 「オフ」に変更（Botの自動応答が不要なため）

---

## 2. Cloudflare Workers の準備

### 2-1. アカウント作成
1. https://dash.cloudflare.com/sign-up にアクセス
2. 無料プラン（Free）で登録

### 2-2. Wranglerインストール

```bash
npm install -g wrangler
```

### 2-3. ログイン

```bash
wrangler login
```

---

## 3. デプロイ

### 3-1. 依存パッケージをインストール

```bash
cd worker
npm install
```

### 3-2. KVストレージを作成

```bash
wrangler kv:namespace create "KV"
```

表示されたIDを `wrangler.toml` に設定:
```toml
[[kv_namespaces]]
binding = "KV"
id = "ここに表示されたIDを貼り付け"
```

### 3-3. シークレットを設定

```bash
# LINE Messaging APIのチャネルアクセストークン
wrangler secret put LINE_CHANNEL_TOKEN
# → 手順1-2のトークンを入力

# 自分のLINEユーザーID
wrangler secret put LINE_USER_ID
# → 手順1-3のユーザーIDを入力（Uxxxxxxxxxx...）

# API認証トークン（自分で決める任意の文字列）
wrangler secret put API_TOKEN
# → 例: mySecretToken123
```

### 3-4. デプロイ実行

```bash
wrangler deploy
```

成功すると以下のようなURLが表示されます:
```
https://positionpilot-worker.xxxxx.workers.dev
```

---

## 4. アプリと接続

1. PositionPilotアプリを開く
2. 右上の **⚙️** ボタンをクリック
3. **Worker URL**: デプロイで表示されたURL
4. **APIトークン**: 手順3-3で設定した `API_TOKEN` の値
5. 「接続テスト」→「保存」
6. 「☁️ Workerに同期」ボタンを押して銘柄を送信

---

## 動作確認

### 手動で株価チェックを実行
```bash
curl -X POST https://YOUR_WORKER_URL/api/check \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

### ステータス確認
```bash
curl https://YOUR_WORKER_URL/api/status \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

---

## 通知サンプル

LINEに届く通知の例:
```
🚨 損切り警告
━━━━━━━━━━━━━━
📌 ○○半導体 (6723)
💹 現在価格: ¥550
📊 変動率: -45.0%

損切りライン ¥550 を下回りました

⚠️ 今すぐ確認してください
━━━━━━━━━━━━━━
🤖 PositionPilot 自動監視
```

---

## 通知ルール

| 条件 | 通知内容 |
|---|---|
| 損切りライン到達 | 🚨 損切り警告 |
| ナンピン②ライン到達 | 🔵 最終ナンピン |
| ナンピン①ライン到達 | 💡 ナンピン検討 |
| 利確②ライン到達 | 💰 利確②到達 |
| 利確①ライン到達 | 🎯 利確①到達 |

- 同じ条件の通知は **4時間に1回** まで（スパム防止）
- **5分ごと**に株価をチェック
- ブラウザ・PCを閉じていても動作

---

## 料金

| サービス | 費用 |
|---|---|
| Cloudflare Workers | 無料（10万リクエスト/日） |
| Cloudflare KV | 無料（1,000書き込み/日） |
| LINE Messaging API | 無料（月200通まで。超過分は有料プランが必要） |
| **合計** | **¥0** |

※ LINE無料枠の200通/月について:
5銘柄 × 1日1〜2回通知 = 約150〜300通/月。
銘柄が少なければ無料枠内に収まります。
通知が多い場合はライトプラン（月5,000円/5,000通）を検討。
