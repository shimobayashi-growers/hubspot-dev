import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * OAuth認可エンドポイント
 * HubSpot OAuth認可画面へリダイレクト
 *
 * GET /api/auth/authorize
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const CLIENT_ID = process.env.HUBSPOT_PUBLIC_APP_CLIENT_ID;
  const REDIRECT_URI = process.env.HUBSPOT_PUBLIC_APP_REDIRECT_URI ||
    `https://${req.headers.host}/api/auth/callback`;

  if (!CLIENT_ID) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'HUBSPOT_PUBLIC_APP_CLIENT_ID is not set',
    });
  }

  // スコープ: HubSpotアプリ設定と一致させる
  // oauth, crm.objects.contacts.read, crm.objects.contacts.write, forms
  const scopes = [
    'oauth',
    'crm.objects.contacts.read',
    'crm.objects.contacts.write',
    'forms',
  ];

  const authUrl = new URL('https://app.hubspot.com/oauth/authorize');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', scopes.join(' '));

  // CSRF対策用のstate（簡易版）
  const state = Math.random().toString(36).substring(2, 15);
  authUrl.searchParams.set('state', state);

  res.redirect(302, authUrl.toString());
}
