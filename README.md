# HubSpot Form Submission Slack Notifier

HubSpotのフォーム送信をSlackに通知するシステム。

## 概要

HubSpotフォームに送信があった際に、Slackへ自動通知を行います。

**技術的背景**:
- HubSpot Private Appではフォーム送信Webhookが使用不可
- HubSpot Projectsの`webhooks-hsmeta.json`では`form_submission`イベントが未サポート
- そのため**ポーリング方式**（定期的にAPIを呼び出してチェック）を採用

## システム構成

```
[HubSpot Forms]
      ↓
[Vercel Cron Job] ← 1日1回実行
      ↓
[HubSpot Forms API] → フォーム一覧・送信データ取得
      ↓
[フィルタリング] → 過去24時間以内の送信を抽出
      ↓
[Slack Webhook] → 通知送信
```

## ディレクトリ構成

```
.
├── api/
│   ├── auth/                    # OAuth認証（参考実装）
│   │   ├── authorize.ts
│   │   └── callback.ts
│   ├── cron/
│   │   └── check-form-submissions.ts  # メインのポーリングジョブ
│   └── webhook/
│       └── form-submitted.ts    # Webhook受信（参考実装）
├── lib/
│   ├── hubspot/
│   │   └── forms-api.ts         # HubSpot API クライアント
│   └── slack/
│       └── notify.ts            # Slack通知
├── src/
│   └── app/                     # HubSpot Projects（UI Extensions等）
├── docs/
│   ├── requirements.md          # 要件定義書
│   └── functional-design.md     # 機能設計書
├── vercel.json                  # Vercel Cron設定
└── hsproject.json               # HubSpot Project設定
```

## 環境変数

| 変数名 | 説明 |
|--------|------|
| `HUBSPOT_PRIVATE_APP_ACCESS_TOKEN` | HubSpot Private App のアクセストークン |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL |

## セットアップ

### 1. HubSpot Private App 作成

1. HubSpotにログイン
2. 設定 → 連携 → Private Apps → 「Private Appを作成」
3. スコープ: `forms` を追加
4. アクセストークンを取得

### 2. Slack Incoming Webhook 作成

1. Slack App を作成
2. Incoming Webhooks を有効化
3. 通知先チャンネルを選択
4. Webhook URL を取得

### 3. デプロイ

```bash
# 環境変数設定（Vercel）
vercel env add HUBSPOT_PRIVATE_APP_ACCESS_TOKEN
vercel env add SLACK_WEBHOOK_URL

# デプロイ
vercel --prod
```

## Cron設定

`vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/check-form-submissions",
      "schedule": "0 9 * * *"
    }
  ]
}
```

- 毎日 UTC 9:00（JST 18:00）に実行
- 過去24時間以内のフォーム送信を検知して通知

## 手動実行

```bash
curl https://your-domain.vercel.app/api/cron/check-form-submissions
```

## ドキュメント

- [要件定義書](docs/requirements.md) - Herokuへの移植時の参考資料
- [機能設計書](docs/functional-design.md) - コア機能の実装詳細

## 注意点

- **フォームIDは `id` を使用**（`guid` ではない）
- **`submittedAt` はミリ秒単位**のUNIXタイムスタンプ
- Vercel Hobby プランではCronは1日1回のみ
