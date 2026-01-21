/**
 * HubSpot OAuth トークン管理モジュール
 */

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface ExchangeCodeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface RefreshTokenParams {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

/**
 * 認可コードをアクセストークンに交換
 */
export async function exchangeCodeForTokens(params: ExchangeCodeParams): Promise<TokenResponse> {
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
 * リフレッシュトークンでアクセストークンを更新
 */
export async function refreshAccessToken(params: RefreshTokenParams): Promise<TokenResponse> {
  const { refreshToken, clientId, clientSecret } = params;

  const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<TokenResponse>;
}

/**
 * 環境変数からトークンを取得し、必要に応じてリフレッシュ
 * 注意: この実装では環境変数の動的更新はできないため、
 *       トークン失効時は手動で更新が必要
 */
export async function getValidAccessToken(): Promise<string> {
  const accessToken = process.env.HUBSPOT_PUBLIC_APP_ACCESS_TOKEN;
  const refreshToken = process.env.HUBSPOT_PUBLIC_APP_REFRESH_TOKEN;
  const clientId = process.env.HUBSPOT_PUBLIC_APP_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_PUBLIC_APP_CLIENT_SECRET;

  if (!accessToken) {
    throw new Error('HUBSPOT_PUBLIC_APP_ACCESS_TOKEN is not set');
  }

  // アクセストークンの有効性をチェック（簡易版）
  // 本番環境では有効期限を保存して比較することを推奨
  try {
    const response = await fetch('https://api.hubapi.com/oauth/v1/access-tokens/' + accessToken);
    if (response.ok) {
      return accessToken;
    }
  } catch {
    // トークン検証失敗、リフレッシュを試行
  }

  // リフレッシュを試行
  if (refreshToken && clientId && clientSecret) {
    console.log('Access token expired, attempting refresh...');
    const newTokens = await refreshAccessToken({
      refreshToken,
      clientId,
      clientSecret,
    });
    console.log('Token refreshed. New access token:', newTokens.access_token.substring(0, 20) + '...');
    console.log('Please update HUBSPOT_PUBLIC_APP_ACCESS_TOKEN in Vercel environment variables.');
    return newTokens.access_token;
  }

  return accessToken;
}
