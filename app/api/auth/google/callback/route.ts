import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/google';
import crypto from 'crypto';

/**
 * 1.2 Security fix: the OAuth callback is validated via a signed `state` parameter.
 * The state is generated in /api/auth/google (GET) and must match on return.
 * Format: state = <nonce>.<hmac-sha256(nonce, ADMIN_JWT_SECRET)>
 */
function validateOAuthState(state: string | null): boolean {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!state || !secret) return false;
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const nonce = state.slice(0, dotIdx);
  const givenSig = state.slice(dotIdx + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(nonce).digest('hex');
  const a = Buffer.from(givenSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/google/callback`;

  if (error || !code) {
    return NextResponse.redirect(
      `${origin}/appointment?google_error=${encodeURIComponent(
        error || 'Authorization was cancelled or code was missing.'
      )}`
    );
  }

  // Validate state to prevent CSRF / open-callback abuse
  if (!validateOAuthState(state)) {
    return NextResponse.redirect(
      `${origin}/appointment?google_error=${encodeURIComponent(
        'Invalid or missing OAuth state. Please start the authorization flow again from the admin panel.'
      )}`
    );
  }

  try {
    await exchangeCodeForTokens(code, redirectUri);
    return NextResponse.redirect(`${origin}/appointment?google_connected=true`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to exchange token';
    console.error('Google OAuth callback error:', err);
    return NextResponse.redirect(
      `${origin}/appointment?google_error=${encodeURIComponent(message)}`
    );
  }
}
