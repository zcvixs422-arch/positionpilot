# PositionPilot - プロジェクトルール

## 必須ルール

### バックアップ
- **コードに変更を加える前に必ずバックアップを取る**
- バックアップ先: `../chart_backup_YYYYMMDD_HHMMSS/`
- コマンド: `cp -r ../chart ../chart_backup_$(date +%Y%m%d_%H%M%S)`

## プロジェクト構成

- `index.html` / `app.js` / `styles.css` — フロントエンド（GitHub Pages公開）
- `worker/` — Cloudflare Worker（株価監視 + LINE通知）
- Worker URL: `https://positionpilot-worker.zcvixs422.workers.dev`
- GitHub Pages: `https://zcvixs422-arch.github.io/positionpilot/`

## コミュニケーション
- **処理が終わったら必ず「原因と結果」を簡潔に説明する**
- 何が問題だったか（原因）→ 何をしたか → 今どうなったか（結果）
- 途中経過のログ垂れ流しではなく、まとめて報告する

## デプロイ

- フロントエンド: `git push origin master` → GitHub Pages自動反映
- Worker: `cd worker && npx wrangler deploy`
- Git push時は `GIT_TERMINAL_PROMPT=0` を付ける
