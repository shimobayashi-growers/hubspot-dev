# HubSpot フォーム送信 → Slack通知システム 機能設計書

## 対応Issue

- Issue 3: HubSpot Forms API クライアント実装
- Issue 4: Slack通知機能実装
- Issue 5: メインジョブスクリプト実装

---

## 1. データ型定義

### 1.1 HubSpot API レスポンス型

```typescript
// フォーム一覧 (Marketing Forms API v3)
interface Form {
  id: string;    // ⚠️ 'guid' ではなく 'id'
  name: string;
}

interface FormsListResponse {
  results: Form[];
}

// フォーム送信 (Form Submissions API v1)
interface FormSubmissionValue {
  name: string;
  value: string;
}

interface FormSubmission {
  submittedAt: number;  // ミリ秒単位のUNIXタイムスタンプ
  values: FormSubmissionValue[];
  pageUrl: string;
  portalId: number;
}

interface FormSubmissionsResponse {
  results: FormSubmission[];
}
```

### 1.2 Slack メッセージ型

```typescript
interface SlackTextObject {
  type: string;  // 'plain_text' | 'mrkdwn'
  text: string;
}

interface SlackBlock {
  type: string;  // 'header' | 'section' | 'actions'
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  elements?: Array<{
    type: string;
    text: SlackTextObject;
    url?: string;
  }>;
}

interface SlackMessage {
  text: string;      // フォールバックテキスト
  blocks?: SlackBlock[];
}
```

---

## 2. HubSpot API クライアント (Issue 3)

### 2.1 フォーム一覧取得

```typescript
async function getFormsList(accessToken: string): Promise<Form[]> {
  const response = await fetch('https://api.hubapi.com/marketing/v3/forms/', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Forms list error: ${response.status}`);
  }

  const data = (await response.json()) as FormsListResponse;
  return data.results || [];
}
```

### 2.2 フォーム送信取得

```typescript
async function getFormSubmissions(
  formId: string,  // ⚠️ formGuid ではない
  accessToken: string,
  limit: number = 50
): Promise<FormSubmission[]> {
  const url = `https://api.hubapi.com/form-integrations/v1/submissions/forms/${formId}?limit=${limit}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return [];  // 個別フォームのエラーは無視して継続
  }

  const data = (await response.json()) as FormSubmissionsResponse;
  return data.results || [];
}
```

### 2.3 ユーティリティ関数

```typescript
// フォーム値の配列をオブジェクトに変換
function parseFormValues(values: FormSubmissionValue[]): Record<string, string> {
  return Object.fromEntries(values.map(({ name, value }) => [name, value]));
}

// タイムスタンプを日本時間文字列に変換
function formatSubmittedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
```

---

## 3. Slack通知機能 (Issue 4)

### 3.1 メッセージ作成

```typescript
function createFormSubmissionMessage(params: {
  formName: string;
  formId: string;
  submittedAt: string;
  pageUrl: string;
  portalId: number;
  formValues: Record<string, string>;
}): SlackMessage {
  const { formName, formId, submittedAt, pageUrl, portalId, formValues } = params;

  // フォーム値を整形（最大10項目）
  const formFields = Object.entries(formValues)
    .slice(0, 10)
    .map(([key, value]) => ({
      type: 'mrkdwn',
      text: `*${key}:*\n${value || '(未入力)'}`,
    }));

  const blocks: SlackBlock[] = [
    // ヘッダー
    {
      type: 'header',
      text: { type: 'plain_text', text: '📝 フォーム送信通知' },
    },
    // 基本情報
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*フォーム:* ${formName || formId}\n*送信日時:* ${submittedAt}\n*送信ページ:* ${pageUrl}`,
      },
    },
  ];

  // フォーム値（2項目以上の場合はfields、1項目の場合はtext）
  if (formFields.length >= 2) {
    blocks.push({ type: 'section', fields: formFields });
  } else if (formFields.length === 1) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: formFields[0].text } });
  }

  // HubSpotへのリンクボタン
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'HubSpotで確認' },
        url: `https://app.hubspot.com/forms/${portalId}/editor/${formId}/submissions`,
      },
    ],
  });

  return { text: `フォーム送信: ${formName}`, blocks };
}
```

### 3.2 Webhook送信

```typescript
async function sendSlackNotification(
  webhookUrl: string,
  message: SlackMessage
): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
}
```

---

## 4. メインジョブ処理 (Issue 5)

### 4.1 処理フロー

```
1. 環境変数チェック
2. 全フォーム一覧取得
3. 各フォームについてループ:
   a. 送信データ取得（最新50件）
   b. 過去24時間以内の送信をフィルタ
   c. 新規送信ごとにSlack通知
4. 結果をログ出力
```

### 4.2 コア処理

```typescript
// 過去24時間の送信をチェック（Cronが1日1回のため）
const HOURS_TO_CHECK = 24;

async function checkFormSubmissions(): Promise<void> {
  const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_PRIVATE_APP_ACCESS_TOKEN;
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

  if (!HUBSPOT_ACCESS_TOKEN || !SLACK_WEBHOOK_URL) {
    throw new Error('Missing configuration');
  }

  const checkStartTime = Date.now();
  const cutoffTime = checkStartTime - HOURS_TO_CHECK * 60 * 60 * 1000;
  let newSubmissionsCount = 0;

  // 全フォームを取得
  const forms = await getFormsList(HUBSPOT_ACCESS_TOKEN);

  for (const form of forms) {
    // 各フォームの送信を取得
    const submissions = await getFormSubmissions(form.id, HUBSPOT_ACCESS_TOKEN, 50);

    // 過去24時間以内の送信をフィルタ
    const newSubmissions = submissions.filter((s) => s.submittedAt > cutoffTime);

    // 新規送信ごとにSlack通知
    for (const submission of newSubmissions) {
      const message = createFormSubmissionMessage({
        formName: form.name,
        formId: form.id,
        submittedAt: formatSubmittedAt(submission.submittedAt),
        pageUrl: submission.pageUrl || 'N/A',
        portalId: submission.portalId,
        formValues: parseFormValues(submission.values),
      });

      await sendSlackNotification(SLACK_WEBHOOK_URL, message);
      newSubmissionsCount++;
    }
  }

  console.log(`Checked ${forms.length} forms, found ${newSubmissionsCount} new submissions`);
}
```

---

## 5. 実装時の注意点

### 5.1 HubSpot API

| 項目 | 注意点 |
|------|--------|
| フォームID | `id` を使用（`guid` ではない） |
| submittedAt | ミリ秒単位のUNIXタイムスタンプ |
| エラー処理 | 個別フォームのエラーは無視して継続 |

### 5.2 時間計算

```typescript
// ❌ 間違い: 秒単位で計算
const cutoffTime = Date.now() - 24 * 60 * 60;

// ✅ 正しい: ミリ秒単位で計算
const cutoffTime = Date.now() - 24 * 60 * 60 * 1000;
```

### 5.3 Slack Block Kit

- `fields` は2項目以上の場合に使用
- 1項目の場合は `text` を使用
- ボタンは `actions` ブロックで追加

---

## 更新履歴

| 日付 | 内容 |
|------|------|
| 2026-01-23 | 初版作成 |
