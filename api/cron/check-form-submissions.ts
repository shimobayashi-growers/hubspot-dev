import type { VercelRequest, VercelResponse } from '@vercel/node';

interface FormSubmissionValue {
  name: string;
  value: string;
}

interface FormSubmission {
  submittedAt: number;
  values: FormSubmissionValue[];
  pageUrl: string;
  portalId: number;
}

interface FormSubmissionsResponse {
  results: FormSubmission[];
}

interface Form {
  guid: string;
  name: string;
}

interface FormsListResponse {
  results: Form[];
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: { type: string; text: string }; url?: string }>;
}

interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

// 過去24時間の送信をチェック（Cronが1日1回のため）
const HOURS_TO_CHECK = 24;

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

async function getFormSubmissions(
  formGuid: string,
  accessToken: string,
  limit: number = 10
): Promise<FormSubmission[]> {
  const url = `https://api.hubapi.com/form-integrations/v1/submissions/forms/${formGuid}?limit=${limit}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as FormSubmissionsResponse;
  return data.results || [];
}

function parseFormValues(values: FormSubmissionValue[]): Record<string, string> {
  return Object.fromEntries(values.map(({ name, value }) => [name, value]));
}

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

function createFormSubmissionMessage(params: {
  formName: string;
  formId: string;
  submittedAt: string;
  pageUrl: string;
  portalId: number;
  formValues: Record<string, string>;
}): SlackMessage {
  const { formName, formId, submittedAt, pageUrl, portalId, formValues } = params;

  const formFields = Object.entries(formValues)
    .slice(0, 10)
    .map(([key, value]) => ({
      type: 'mrkdwn',
      text: `*${key}:*\n${value || '(未入力)'}`,
    }));

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📝 フォーム送信通知' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*フォーム:* ${formName || formId}\n*送信日時:* ${submittedAt}\n*送信ページ:* ${pageUrl}`,
      },
    },
  ];

  if (formFields.length >= 2) {
    blocks.push({ type: 'section', fields: formFields });
  } else if (formFields.length === 1) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: formFields[0].text } });
  }

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

async function sendSlackNotification(webhookUrl: string, message: SlackMessage): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel Cron認証（CRON_SECRETが設定されている場合）
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_PRIVATE_APP_ACCESS_TOKEN;
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

  if (!HUBSPOT_ACCESS_TOKEN || !SLACK_WEBHOOK_URL) {
    return res.status(500).json({ error: 'Missing configuration' });
  }

  const checkStartTime = Date.now();
  const cutoffTime = checkStartTime - HOURS_TO_CHECK * 60 * 60 * 1000;
  let newSubmissionsCount = 0;
  let formsChecked = 0;

  try {
    // 全フォームを取得
    const forms = await getFormsList(HUBSPOT_ACCESS_TOKEN);
    formsChecked = forms.length;

    const debugSubmissions: Array<{ formName: string; submittedAt: number; submittedAtISO: string }> = [];

    for (const form of forms) {
      // 各フォームの最新送信を取得
      const submissions = await getFormSubmissions(form.guid, HUBSPOT_ACCESS_TOKEN, 50);

      // デバッグ: 全送信を記録
      for (const s of submissions) {
        debugSubmissions.push({
          formName: form.name,
          submittedAt: s.submittedAt,
          submittedAtISO: new Date(s.submittedAt).toISOString(),
        });
      }

      // 過去24時間以内の送信をフィルタ
      const newSubmissions = submissions.filter((s) => s.submittedAt > cutoffTime);

      for (const submission of newSubmissions) {
        const message = createFormSubmissionMessage({
          formName: form.name,
          formId: form.guid,
          submittedAt: formatSubmittedAt(submission.submittedAt),
          pageUrl: submission.pageUrl || 'N/A',
          portalId: submission.portalId,
          formValues: parseFormValues(submission.values),
        });

        await sendSlackNotification(SLACK_WEBHOOK_URL, message);
        newSubmissionsCount++;
      }
    }

    return res.status(200).json({
      success: true,
      formsChecked,
      newSubmissions: newSubmissionsCount,
      checkedAt: new Date(checkStartTime).toISOString(),
      cutoffTime: new Date(cutoffTime).toISOString(),
      debug: {
        forms: forms.map((f) => ({ guid: f.guid, name: f.name })),
        submissions: debugSubmissions,
      },
    });
  } catch (error) {
    console.error('Polling error:', error);
    return res.status(500).json({
      error: 'Polling failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
