import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getOAuth2Client, DOCTOR_EMAIL } from '@/lib/google';
import { getGoogleTokens, getGoogleConfig } from '@/lib/storage';
import { verifyAdminRequest } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 1.2 Security fix: only authenticated admins may test Google connectivity
  const auth = verifyAdminRequest(request, ['admin']);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.statusCode || 401 });
  }

  const config = getGoogleConfig();
  const tokens = getGoogleTokens();

  const secretCheck = config?.clientSecret
    ? {
        length: config.clientSecret.length,
        hasCapitalL: config.clientSecret.includes('DwL'),
        hasLowerL: config.clientSecret.includes('Dwl'),
        preview: `${config.clientSecret.slice(0, 10)}...${config.clientSecret.slice(-4)}`,
      }
    : null;

  const diagnostics = {
    hasClientId: Boolean(config?.clientId),
    clientIdPrefix: config?.clientId ? config.clientId.slice(0, 15) : null,
    secretCheck,
    hasRefreshToken: Boolean(tokens?.refresh_token),
    refreshTokenPrefix: tokens?.refresh_token ? tokens.refresh_token.slice(0, 8) : null,
    doctorEmail: DOCTOR_EMAIL,
  };

  try {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) {
      return NextResponse.json({
        success: false,
        diagnostics,
        error: 'OAuth2 client could not be initialized (missing client ID or secret)',
      });
    }

    // Try refreshing the access token
    const tokenRes = await oauth2Client.getAccessToken();
    const hasAccessToken = Boolean(tokenRes?.token);

    // Try calling Google Calendar
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calList = await calendar.calendarList.list();

    return NextResponse.json({
      success: true,
      diagnostics,
      hasAccessToken,
      calendarCount: calList.data.items?.length,
      primaryCalendar: calList.data.items?.find((c) => c.primary)?.id,
    });
  } catch (err: unknown) {
    const error = err as {
      message?: string;
      response?: { status?: number; data?: unknown };
    };
    return NextResponse.json(
      {
        success: false,
        diagnostics,
        errorMessage: error.message,
        httpStatus: error.response?.status,
        googleErrorData: error.response?.data,
      },
      { status: 200 }
    );
  }
}

