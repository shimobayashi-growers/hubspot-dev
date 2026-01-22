import type { VercelRequest, VercelResponse } from '@vercel/node';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * 認可コードをアクセストークンに交換
 */
async function exchangeCodeForTokens(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const { code, clientId, clientSecret, redirectUri } = params;

  const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<TokenResponse>;
}

/**
 * OAuthコールバックエンドポイント
 * HubSpotからの認可コードを受け取り、トークンを取得
 *
 * GET /api/auth/callback?code=xxx
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { code, error, error_description } = req.query;

  // エラーハンドリング
  if (error) {
    return res.status(400).json({
      error: error as string,
      description: error_description as string,
    });
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({
      error: 'missing_code',
      message: 'Authorization code is required',
    });
  }

  const CLIENT_ID = process.env.HUBSPOT_PUBLIC_APP_CLIENT_ID;
  const CLIENT_SECRET = process.env.HUBSPOT_PUBLIC_APP_CLIENT_SECRET;
  const REDIRECT_URI = process.env.HUBSPOT_PUBLIC_APP_REDIRECT_URI ||
    `https://${req.headers.host}/api/auth/callback`;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({
      error: 'configuration_error',
      message: 'OAuth credentials are not configured',
    });
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
    });

    // トークン情報を表示（本番では環境変数に手動設定）
    // セキュリティ上、本番環境ではこの表示を無効化することを推奨
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>HubSpot OAuth - Success</title>
        <style>
          body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
          h1 { color: #33475b; }
          .token-box { background: #f5f8fa; padding: 16px; border-radius: 8px; margin: 16px 0; overflow-x: auto; }
          code { font-family: monospace; word-break: break-all; }
          .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 4px; margin: 16px 0; }
        </style>
      </head>
      <body>
        <h1>HubSpot OAuth 認証成功</h1>
        <p>以下のトークンをVercelの環境変数に設定してください。</p>

        <div class="warning">
          <strong>注意:</strong> このページは一度だけ表示されます。トークンを安全な場所にコピーしてください。
        </div>

        <h3>HUBSPOT_PUBLIC_APP_ACCESS_TOKEN</h3>
        <div class="token-box"><code>${tokens.access_token}</code></div>

        <h3>HUBSPOT_PUBLIC_APP_REFRESH_TOKEN</h3>
        <div class="token-box"><code>${tokens.refresh_token}</code></div>

        <h3>追加情報</h3>
        <ul>
          <li>アクセストークン有効期限: ${tokens.expires_in}秒（約${Math.round(tokens.expires_in / 60)}分）</li>
          <li>トークンタイプ: ${tokens.token_type}</li>
        </ul>

        <h3>次のステップ</h3>
        <ol>
          <li>Vercelダッシュボードで環境変数を設定</li>
          <li>Webhooks APIでform_submission購読を作成</li>
          <li>フォーム送信テストを実行</li>
        </ol>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('OAuth token exchange error:', err);
    res.status(500).json({
      error: 'token_exchange_failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
