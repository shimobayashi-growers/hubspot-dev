/**
 * HubSpot Forms API v1クライアント
 * https://developers.hubspot.com/docs/api/marketing/forms
 */

export interface FormSubmissionValue {
  name: string;
  value: string;
}

export interface FormSubmission {
  submittedAt: number;
  values: FormSubmissionValue[];
  pageUrl: string;
  portalId: number;
}

export interface FormSubmissionsResponse {
  results: FormSubmission[];
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

/**
 * フォーム送信の詳細を取得する
 * GET /form-integrations/v1/submissions/forms/{formGuid}
 */
export async function getFormSubmissions(
  formGuid: string,
  accessToken: string,
  options: {
    limit?: number;
    after?: string;
  } = {}
): Promise<FormSubmissionsResponse> {
  const { limit = 50, after } = options;

  const params = new URLSearchParams({
    limit: limit.toString(),
  });

  if (after) {
    params.append('after', after);
  }

  const url = `https://api.hubapi.com/form-integrations/v1/submissions/forms/${formGuid}?${params}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot Forms API error: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<FormSubmissionsResponse>;
}

/**
 * 最新のフォーム送信を1件取得
 */
export async function getLatestFormSubmission(
  formGuid: string,
  accessToken: string
): Promise<FormSubmission | null> {
  const response = await getFormSubmissions(formGuid, accessToken, { limit: 1 });
  return response.results[0] || null;
}

/**
 * フォーム送信のvalues配列をオブジェクトに変換
 */
export function parseFormValues(values: FormSubmissionValue[]): Record<string, string> {
  return Object.fromEntries(values.map(({ name, value }) => [name, value]));
}

/**
 * タイムスタンプを日本時間の文字列に変換
 */
export function formatSubmittedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
