# HubSpot フォーム送信 → Slack通知システム 要件定義書

## 1. 概要

### 1.1 目的
HubSpotのフォーム送信を検知し、Slackに通知するシステムを構築する。

### 1.2 背景
- HubSpot Private Appではフォーム送信Webhookが使用不可
- HubSpot Projects の `webhooks-hsmeta.json` では `form_submission` イベントがサポートされていない
- そのため、**ポーリング方式**（定期的にAPIを呼び出してチェック）を採用

**参考**:
- [HubSpot Webhooks API - Subscription Types](https://developers.hubspot.com/docs/api/webhooks#subscription-types) - 対応イベント一覧
- [HubSpot Private Apps](https://developers.hubspot.com/docs/api/private-apps) - Private Appの制限

### 1.3 システム構成

```
[HubSpot Forms]
      ↓
[定期実行ジョブ] ← Heroku Scheduler (1日1回)
      ↓
[HubSpot Forms API v3] → フォーム一覧取得
      ↓
[HubSpot Form Submissions API v1] → 送信データ取得
      ↓
[フィルタリング] → 過去24時間以内の送信を抽出
      ↓
[Slack Webhook] → 通知送信
```

---

## 2. 機能要件

### 2.1 フォーム送信検知機能

| 項目 | 内容 |
|------|------|
| 対象 | HubSpotアカウント内の全フォーム |
| チェック間隔 | 24時間に1回（日次） |
| 検知対象期間 | 過去24時間以内の送信 |
| 取得上限 | 各フォームにつき最新50件 |

### 2.2 Slack通知機能

| 項目 | 内容 |
|------|------|
| 通知方法 | Slack Incoming Webhook |
| 通知タイミング | 新規送信検知時 |
| 通知内容 | フォーム名、送信日時、送信ページURL、フォーム入力値（最大10項目） |
| リンク | HubSpotのフォーム送信詳細ページへのボタン |

### 2.3 通知メッセージ仕様

```
📝 フォーム送信通知
━━━━━━━━━━━━━━━━━━
フォーム: [フォーム名]
送信日時: 2026/01/23 18:30
送信ページ: https://example.com/contact

[入力項目1]: 値1
[入力項目2]: 値2
...

[HubSpotで確認] ← ボタン
```

---

## 3. 非機能要件

### 3.1 実行環境

| 項目 | 要件 |
|------|------|
| 実行基盤 | Heroku Scheduler |
| 言語 | Node.js (TypeScript) |
| 実行頻度 | 1日1回 |

**参考**: [Heroku Scheduler](https://devcenter.heroku.com/articles/scheduler)

### 3.2 セキュリティ

| 項目 | 要件 |
|------|------|
| HubSpot認証 | Private App Access Token |
| Slack認証 | Webhook URL |
| シークレット管理 | 環境変数で管理（コードに含めない） |

### 3.3 エラーハンドリング

| 項目 | 要件 |
|------|------|
| API失敗時 | エラーログ出力、処理継続 |
| 個別フォーム失敗時 | 該当フォームをスキップ、他のフォームは処理継続 |
| Slack送信失敗時 | エラーログ出力、処理継続 |

---

## 4. 外部API仕様

### 4.1 HubSpot Marketing Forms API v3

**参考**: [HubSpot Forms API](https://developers.hubspot.com/docs/api/marketing/forms)

**フォーム一覧取得**
```
GET https://api.hubapi.com/marketing/v3/forms/
Authorization: Bearer {ACCESS_TOKEN}
```

レスポンス:
```json
{
  "results": [
    {
      "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "name": "お問い合わせフォーム"
    }
  ]
}
```

⚠️ **重要**: フォームIDは `id` プロパティ（`guid` ではない）

### 4.2 HubSpot Form Submissions API v1

**参考**: [HubSpot Form Submissions API](https://developers.hubspot.com/docs/api/marketing/form-data-submissions)

**フォーム送信取得**
```
GET https://api.hubapi.com/form-integrations/v1/submissions/forms/{formId}?limit=50
Authorization: Bearer {ACCESS_TOKEN}
```

レスポンス:
```json
{
  "results": [
    {
      "submittedAt": 1706012345678,
      "portalId": 12345678,
      "pageUrl": "https://example.com/contact",
      "values": [
        { "name": "email", "value": "test@example.com" },
        { "name": "firstname", "value": "太郎" }
      ]
    }
  ]
}
```

⚠️ **重要**: `submittedAt` はミリ秒単位のUNIXタイムスタンプ

---

## 5. 環境変数

| 変数名 | 説明 | 必須 |
|--------|------|------|
| `HUBSPOT_PRIVATE_APP_ACCESS_TOKEN` | HubSpot Private App のアクセストークン | ✅ |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | ✅ |

---

## 6. 制約事項・注意点

### 6.1 HubSpot API の制限

1. **Private AppではWebhookが使えない**
   - フォーム送信Webhookを使うには公開アプリ（OAuth）が必要
   - 本システムではポーリング方式で代替
   - 参考: [HubSpot Webhooks](https://developers.hubspot.com/docs/api/webhooks)

2. **API Rate Limit**
   - HubSpot APIには呼び出し制限あり
   - 参考: [HubSpot API Usage Guidelines](https://developers.hubspot.com/docs/api/usage-details)

3. **フォームIDは `id` を使用**
   - Forms API v3 では `guid` ではなく `id`
   - 古いドキュメントには `guid` と記載されている場合あり

### 6.2 ポーリング方式の制限

1. **リアルタイム性がない**
   - 最大24時間の遅延が発生
   - 即時通知が必要な場合は別の方法を検討

2. **重複通知の可能性**
   - 実行間隔と検知期間が重複すると同じ送信が複数回通知される可能性
   - 対策: 送信済みIDを記録する仕組みを追加（本システムでは未実装）

### 6.3 Heroku固有の注意点

1. **Heroku Scheduler**
   - 10分/1時間/1日の間隔から選択
   - 正確な実行時刻は保証されない（±数分のズレあり）
   - 参考: [Heroku Scheduler](https://devcenter.heroku.com/articles/scheduler)

2. **Dyno スリープ**
   - Eco Dynoは30分アイドルでスリープ
   - Schedulerで起動する際にコールドスタートが発生
   - 参考: [Dyno Sleeping](https://devcenter.heroku.com/articles/dyno-sleeping)

---

## 7. 実装ステップ（Issue単位）

### Issue 1: プロジェクト初期セットアップ

**目的**: Herokuにデプロイ可能なNode.jsプロジェクトを作成

**タスク**:
- [ ] GitHubリポジトリ作成
- [ ] Node.js + TypeScriptプロジェクト初期化
- [ ] 必要なパッケージインストール（typescript, ts-node, @types/node）
- [ ] tsconfig.json 設定
- [ ] .gitignore 設定（node_modules, .env, dist）

**参考**:
- [Heroku Node.js Support](https://devcenter.heroku.com/articles/nodejs-support)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

---

### Issue 2: HubSpot Private App 作成・設定

**目的**: HubSpot APIにアクセスするためのPrivate Appを作成

**タスク**:
- [ ] HubSpotにログイン
- [ ] 設定 → 連携 → Private Apps → 「Private Appを作成」
- [ ] アプリ名を設定（例: `form-slack-notifier`）
- [ ] スコープ設定: `forms`（フォームデータの読み取り）
- [ ] アクセストークンを取得・保存

**参考**:
- [Creating a Private App](https://developers.hubspot.com/docs/api/private-apps#create-a-private-app)
- [Private App Scopes](https://developers.hubspot.com/docs/api/working-with-oauth#scopes)

---

### Issue 3: HubSpot Forms API クライアント実装

**目的**: HubSpot APIを呼び出す関数を実装

**タスク**:
- [ ] フォーム一覧取得関数 (`getFormsList`)
- [ ] フォーム送信取得関数 (`getFormSubmissions`)
- [ ] フォーム値パース関数 (`parseFormValues`)
- [ ] 日時フォーマット関数 (`formatSubmittedAt`)

**実装ポイント**:
```typescript
// フォームIDは 'id' を使用（'guid' ではない）
interface Form {
  id: string;  // ⚠️ guid ではない
  name: string;
}

// submittedAt はミリ秒単位
const cutoffTime = Date.now() - 24 * 60 * 60 * 1000;
const newSubmissions = submissions.filter(s => s.submittedAt > cutoffTime);
```

**参考**:
- [Forms API Reference](https://developers.hubspot.com/docs/api/marketing/forms)
- [Form Submissions API Reference](https://developers.hubspot.com/docs/api/marketing/form-data-submissions)

---

### Issue 4: Slack通知機能実装

**目的**: Slack Webhookを使った通知機能を実装

**タスク**:
- [ ] Slack Block Kit形式のメッセージ作成関数
- [ ] Webhook送信関数 (`sendSlackNotification`)
- [ ] HubSpotへのリンクボタン追加

**参考**:
- [Slack Block Kit Builder](https://app.slack.com/block-kit-builder)
- [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks)

---

### Issue 5: メインジョブスクリプト実装

**目的**: 定期実行されるメインスクリプトを実装

**タスク**:
- [ ] 環境変数の読み込み・検証
- [ ] 全フォーム取得 → 送信取得 → フィルタリング → 通知 のフロー実装
- [ ] エラーハンドリング（個別フォーム失敗時も継続）
- [ ] 実行結果のログ出力

**ファイル構成例**:
```
src/
├── index.ts              # メインエントリーポイント
├── hubspot/
│   └── forms-api.ts      # HubSpot API クライアント
└── slack/
    └── notify.ts         # Slack通知
```

---

### Issue 6: Herokuデプロイ設定

**目的**: Herokuへのデプロイ環境を構築

**タスク**:
- [ ] Heroku CLI インストール・ログイン
- [ ] Herokuアプリ作成 (`heroku create`)
- [ ] 環境変数設定
  ```bash
  heroku config:set HUBSPOT_PRIVATE_APP_ACCESS_TOKEN=xxx
  heroku config:set SLACK_WEBHOOK_URL=xxx
  ```
- [ ] Procfile 作成（またはScheduler用のスクリプト設定）
- [ ] デプロイ (`git push heroku main`)

**参考**:
- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli)
- [Deploying Node.js Apps](https://devcenter.heroku.com/articles/deploying-nodejs)
- [Config Vars](https://devcenter.heroku.com/articles/config-vars)

---

### Issue 7: Heroku Scheduler 設定

**目的**: 定期実行ジョブを設定

**タスク**:
- [ ] Heroku Scheduler アドオン追加
  ```bash
  heroku addons:create scheduler:standard
  ```
- [ ] ジョブ設定（1日1回、任意の時刻）
- [ ] 実行コマンド設定（例: `npm run check-forms`）

**参考**:
- [Heroku Scheduler](https://devcenter.heroku.com/articles/scheduler)
- [Scheduler Add-on](https://elements.heroku.com/addons/scheduler)

---

### Issue 8: テスト・動作確認

**目的**: 本番環境での動作確認

**タスク**:
- [ ] HubSpotでテストフォーム送信
- [ ] 手動でジョブ実行 (`heroku run npm run check-forms`)
- [ ] Slack通知が届くことを確認
- [ ] ログ確認 (`heroku logs --tail`)

**デバッグ時に確認すべき情報**:
- 取得したフォーム一覧（IDとname）
- 各フォームの送信データ
- カットオフタイム（過去24時間の基準時刻）
- 検出された新規送信数

---

## 8. 参考資料

### HubSpot
- [HubSpot Developers](https://developers.hubspot.com/)
- [Forms API](https://developers.hubspot.com/docs/api/marketing/forms)
- [Form Submissions API](https://developers.hubspot.com/docs/api/marketing/form-data-submissions)
- [Private Apps](https://developers.hubspot.com/docs/api/private-apps)
- [API Usage Guidelines](https://developers.hubspot.com/docs/api/usage-details)
- [Webhooks API](https://developers.hubspot.com/docs/api/webhooks)

### Heroku
- [Heroku Dev Center](https://devcenter.heroku.com/)
- [Node.js on Heroku](https://devcenter.heroku.com/articles/nodejs-support)
- [Heroku Scheduler](https://devcenter.heroku.com/articles/scheduler)
- [Config Vars](https://devcenter.heroku.com/articles/config-vars)
- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli)

### Slack
- [Slack API](https://api.slack.com/)
- [Incoming Webhooks](https://api.slack.com/messaging/webhooks)
- [Block Kit Builder](https://app.slack.com/block-kit-builder)

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-23 | 初版作成 |
