import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ログ出力（デバッグ用）
  console.log('Request method:', req.method);
  console.log('Request body:', JSON.stringify(req.body));

  // HubSpotの検証リクエスト（GET）に対応
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

  if (!SLACK_WEBHOOK_URL) {
    console.error('SLACK_WEBHOOK_URL is not set');
    return res.status(500).json({ error: 'Configuration error' });
  }

  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    console.log('Processing events:', events.length);

    for (const event of events) {
      console.log('Event:', JSON.stringify(event));

      // HubSpot Webhookのイベントタイプをチェック
      // object.creation (新形式) または contact.creation (旧形式)
      const isContactCreation =
        event.subscriptionType === 'object.creation' ||
        event.subscriptionType === 'contact.creation';

      if (isContactCreation) {
        const contactId = event.objectId;
        const portalId = event.portalId;

        console.log(`Sending Slack notification for contact ${contactId}`);

        const slackResponse = await fetch(SLACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: '🆕 新規コンタクトが作成されました',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*新規コンタクトが作成されました*\n\nContact ID: \`${contactId}\`\nPortal ID: \`${portalId}\``
                }
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: 'HubSpotで確認' },
                    url: `https://app.hubspot.com/contacts/${portalId}/contact/${contactId}`
                  }
                ]
              }
            ]
          })
        });

        console.log('Slack response status:', slackResponse.status);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
