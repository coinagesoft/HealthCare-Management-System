import { NextRequest, NextResponse } from 'next/server';
import { saveGoogleConfig } from '@/lib/storage';
import { getGoogleAuthUrl } from '@/lib/google';
import { verifyAdminRequest } from '@/lib/adminAuth';

export async function POST(request: NextRequest) {
  // 1.2 Security fix: only authenticated admins may configure Google OAuth
  const auth = verifyAdminRequest(request, ['admin']);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.statusCode || 401 });
  }

  try {
    const { clientId, clientSecret } = await request.json();

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Both Client ID and Client Secret are required.' },
        { status: 400 }
      );
    }

    saveGoogleConfig({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
    });

    const authUrl = getGoogleAuthUrl();

    return NextResponse.json({
      success: true,
      authUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to configure Google OAuth';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

