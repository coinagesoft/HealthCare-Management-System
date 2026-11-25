import { NextRequest, NextResponse } from 'next/server';
import { DOCTOR_EMAIL } from '@/lib/google';
import { verifyAdminRequest } from '@/lib/adminAuth';
import crypto from 'crypto';

/**
 * 1.2 Security fix: generate a signed state for the OAuth callback to prevent CSRF.
 * Only authenticated admins may start the Google OAuth flow.
 */
function generateOAuthState(): string {
  const secret = process.env.ADMIN_JWT_SECRET!;
  const nonce = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', secret).update(nonce).digest('hex');
  return `${nonce}.${sig}`;
}

export async function GET(request: NextRequest) {
  const auth = verifyAdminRequest(request, ['admin']);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.statusCode || 401 });
  }

  const { getGoogleAuthUrl } = await import('@/lib/google');
  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/google/callback`;
  const state = generateOAuthState();
  const authUrl = getGoogleAuthUrl(redirectUri, state);

  if (!authUrl) {
    return NextResponse.json(
      {
        error:
          'Google OAuth credentials are not set in environment variables. Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your project environment.',
        doctorEmail: DOCTOR_EMAIL,
      },
      { status: 400 }
    );
  }

  return NextResponse.redirect(authUrl);
}
