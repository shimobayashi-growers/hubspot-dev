import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyHubSpotSignature, isTimestampValid } from '../../lib/hubspot/signature';
import {
  getLatestFormSubmission,
  parseFormValues,
  formatSubmittedAt,
} from '../../lib/hubspot/forms-api';
import { sendSlackNotification, createFormSubmissionMessage } from '../../lib/slack/notify';

interface FormSubmissionWebhookEvent {
  eventId: string;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  subscriptionType: string;
  attemptNumber: number;
  objectId: number;
  formId: string;
  formName?: string;
  pageUrl?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // HubSpotの検証リクエスト（GET）に対応
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_PRIVATE_APP_CLIENT_SECRET;
  const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_PRIVATE_APP_ACCESS_TOKEN;
  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

  if (!SLACK_WEBHOOK_URL) {
    console.error('SLACK_WEBHOOK_URL is not set');
    return res.status(500).json({ error: 'Configuration error: SLACK_WEBHOOK_URL missing' });
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  // 署名検証（CLIENT_SECRETが設定されている場合のみ）
  if (HUBSPOT_CLIENT_SECRET) {
    const signature =
      (req.headers['x-hubspot-signature-v3'] as string) ||
      (req.headers['x-hubspot-signature'] as string);

    if (signature) {
      const signatureVersion = req.headers['x-hubspot-signature-v3'] ? 'v3' : 'v2';
      const timestamp = req.headers['x-hubspot-request-timestamp'] as string;
      const requestUrl = `https://${req.headers.host}${req.url}`;

      const isValid = verifyHubSpotSignature({
        signature,
        signatureVersion,
        clientSecret: HUBSPOT_CLIENT_SECRET,
        requestBody: rawBody,
        requestMethod: req.method,
        requestUrl,
        timestamp,
      });

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      if (signatureVersion === 'v3' && timestamp && !isTimestampValid(timestamp)) {
        return res.status(401).json({ error: 'Request expired' });
      }
    }
  }

  // 即座に200 OKを返す（HubSpotは5秒以内のレスポンスを期待）
  res.status(200).json({ received: true });

  // 以降はバックグラウンドで処理
  try {
    const events: FormSubmissionWebhookEvent[] = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      if (event.subscriptionType !== 'form_submission.v2') {
        continue;
      }

      const { formId, portalId, formName, pageUrl, occurredAt } = event;

      let formValues: Record<string, string> = {};
      let submittedAt = formatSubmittedAt(occurredAt);
      let actualPageUrl = pageUrl || 'N/A';

      // Forms APIから詳細を取得
      if (HUBSPOT_ACCESS_TOKEN && formId) {
        try {
          const submission = await getLatestFormSubmission(formId, HUBSPOT_ACCESS_TOKEN);
          if (submission) {
            formValues = parseFormValues(submission.values);
            submittedAt = formatSubmittedAt(submission.submittedAt);
            actualPageUrl = submission.pageUrl || actualPageUrl;
          }
        } catch (error) {
          console.error('Failed to fetch form submission details:', error);
        }
      }

      const message = createFormSubmissionMessage({
        formName,
        formId,
        submittedAt,
        pageUrl: actualPageUrl,
        portalId,
        formValues,
      });

      await sendSlackNotification(SLACK_WEBHOOK_URL, message);
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
  }
}
