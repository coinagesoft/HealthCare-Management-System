import { NextRequest, NextResponse } from 'next/server';
import { isGoogleConnected, DOCTOR_EMAIL } from '@/lib/google';
import { getGoogleConfig } from '@/lib/storage';
import { verifyAdminRequest } from '@/lib/adminAuth';

export async function GET(request: NextRequest) {
  // 1.2 Security fix: only authenticated admins may read Google OAuth status
  const auth = verifyAdminRequest(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.statusCode || 401 });
  }

  const config = getGoogleConfig();
  const hasConfig = Boolean(config?.clientId && config?.clientSecret);
  const connected = isGoogleConnected();

  return NextResponse.json({
    connected,
    hasConfig,
    doctorEmail: DOCTOR_EMAIL,
  });
}
