import crypto from 'crypto';

interface SignatureValidationParams {
  signature: string;
  signatureVersion: string;
  clientSecret: string;
  requestBody: string;
  requestMethod: string;
  requestUrl: string;
  timestamp?: string;
}

/**
 * HubSpot Webhook署名を検証する
 * https://developers.hubspot.com/docs/api/webhooks#validate-signatures
 */
export function verifyHubSpotSignature(params: SignatureValidationParams): boolean {
  const {
    signature,
    signatureVersion,
    clientSecret,
    requestBody,
    requestMethod,
    requestUrl,
    timestamp,
  } = params;

  let expectedSignature: string;

  const isV3 = signatureVersion === 'v3' && timestamp;

  if (isV3) {
    // Signature v3: HMAC-SHA256(clientSecret, requestMethod + requestUri + requestBody + timestamp)
    const sourceString = `${requestMethod}${requestUrl}${requestBody}${timestamp}`;
    expectedSignature = crypto
      .createHmac('sha256', clientSecret)
      .update(sourceString, 'utf8')
      .digest('base64');
  } else {
    // Signature v1/v2: SHA256(clientSecret + requestBody)
    const sourceString = clientSecret + requestBody;
    expectedSignature = crypto
      .createHash('sha256')
      .update(sourceString, 'utf8')
      .digest('hex');
  }

  // タイミング攻撃対策のため、timingSafeEqualを使用
  try {
    const encoding = isV3 ? 'base64' : 'hex';
    const signatureBuffer = Buffer.from(signature, encoding);
    const expectedBuffer = Buffer.from(expectedSignature, encoding);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * タイムスタンプが有効期限内かチェック（5分以内）
 */
export function isTimestampValid(timestamp: string, maxAgeMs: number = 300000): boolean {
  const requestTime = parseInt(timestamp, 10);
  const currentTime = Date.now();
  return currentTime - requestTime <= maxAgeMs;
}
