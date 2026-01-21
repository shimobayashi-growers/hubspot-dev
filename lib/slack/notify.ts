/**
 * Slack通知モジュール
 */

interface SlackTextObject {
  type: string;
  text: string;
}

interface SlackBlock {
  type: string;
  text?: SlackTextObject;
  fields?: SlackTextObject[];
  elements?: Array<{
    type: string;
    text: SlackTextObject;
    url?: string;
  }>;
}

interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
}

/**
 * Slackにメッセージを送信
 */
export async function sendSlackNotification(
  webhookUrl: string,
  message: SlackMessage
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Slack API error: ${response.status} - ${errorText}`);
  }
}

/**
 * フォーム送信通知用のSlackメッセージを作成
 */
export function createFormSubmissionMessage(params: {
  formName?: string;
  formId: string;
  submittedAt: string;
  pageUrl: string;
  portalId: number;
  formValues: Record<string, string>;
}): SlackMessage {
  const { formName, formId, submittedAt, pageUrl, portalId, formValues } = params;

  // フォーム値を整形
  const formFields = Object.entries(formValues)
    .slice(0, 10) // 最大10項目まで表示
    .map(([key, value]) => ({
      type: 'mrkdwn',
      text: `*${key}:*\n${value || '(未入力)'}`,
    }));

  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📝 フォーム送信通知',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*フォーム:* ${formName || formId}\n*送信日時:* ${submittedAt}\n*送信ページ:* ${pageUrl}`,
      },
    },
  ];

  // フォーム値が2つ以上ある場合はfieldsで表示
  if (formFields.length >= 2) {
    blocks.push({
      type: 'section',
      fields: formFields,
    });
  } else if (formFields.length === 1) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: formFields[0].text,
      },
    });
  }

  // 残りの項目数を表示
  const remainingCount = Object.keys(formValues).length - 10;
  if (remainingCount > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_...他 ${remainingCount} 項目_`,
      },
    });
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

  return {
    text: `フォーム送信: ${formName || formId}`,
    blocks,
  };
}
