import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest, type AdminTokenPayload } from '@/lib/adminAuth';
import { canReadPathology, canRecordPathology } from '@/lib/emrPermissions';
import { resolvePatientId, type Actor } from '@/lib/vitals';
import {
  listPathologySamples,
  createPathologySample,
  getPathologyOverviewStats,
} from '@/lib/pathology';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_ROLES: ('admin' | 'doctor' | 'receptionist')[] = ['admin', 'doctor', 'receptionist'];

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function actorOf(p: AdminTokenPayload): Actor {
  return { email: p.email, name: p.name, role: p.role };
}

// GET /api/admin/pathology
export async function GET(request: NextRequest) {
  const auth = verifyAdminRequest(request, ALLOWED_ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  if (!canReadPathology(auth.payload.role)) {
    return fail('Your role does not have access to pathology records.', 403);
  }

  try {
    const sp = request.nextUrl.searchParams;

    // Check if only stats requested
    if (sp.get('stats') === 'true' || sp.get('stats') === '1') {
      const stats = await getPathologyOverviewStats();
      return NextResponse.json({ stats });
    }

    let patientId: number | undefined;
    const rawPatientId = sp.get('patientId');
    if (rawPatientId) {
      patientId = Number(rawPatientId);
    } else if (sp.get('appointmentId') || sp.get('email') || sp.get('phone')) {
      const resolved = await resolvePatientId({
        appointmentId: sp.get('appointmentId') || undefined,
        email: sp.get('email') || undefined,
        phone: sp.get('phone') || undefined,
      });
      if (resolved !== null) {
        patientId = resolved;
      }
    }

    const status = sp.get('status') || undefined;
    const overdueOnly = sp.get('overdue') === 'true' || sp.get('overdue') === '1';
    const search = sp.get('search') || undefined;
    const appointmentId = sp.get('appointmentId') || undefined;

    const [samples, stats] = await Promise.all([
      listPathologySamples({
        patientId,
        appointmentId,
        status,
        overdueOnly,
        search,
      }),
      getPathologyOverviewStats(),
    ]);

    return NextResponse.json({
      samples,
      stats,
      userRole: auth.payload.role,
    });
  } catch (err) {
    console.error('[pathology] GET failed:', err);
    return fail('Failed to fetch pathology samples.', 500);
  }
}

// POST /api/admin/pathology - log new dispatched sample
export async function POST(request: NextRequest) {
  const auth = verifyAdminRequest(request, ALLOWED_ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  if (!canRecordPathology(auth.payload.role)) {
    return fail('Your role cannot log pathology samples.', 403);
  }

  try {
    const body = await request.json();

    let patientId: number | null = body.patientId ? Number(body.patientId) : null;
    if (!patientId) {
      patientId = await resolvePatientId({
        appointmentId: body.appointmentId ? String(body.appointmentId) : undefined,
        email: body.email ? String(body.email) : undefined,
        phone: body.phone ? String(body.phone) : undefined,
      });
    }

    if (!patientId) {
      return fail('Patient record not found. Please provide a valid patientId or appointment details.', 400);
    }

    if (!body.sampleType || !String(body.sampleType).trim()) {
      return fail('Sample type is required.', 400);
    }
    if (!body.labName || !String(body.labName).trim()) {
      return fail('Lab name is required.', 400);
    }

    const sample = await createPathologySample({
      input: {
        patientId,
        appointmentId: body.appointmentId ? String(body.appointmentId) : null,
        doctorSlug: body.doctorSlug ? String(body.doctorSlug) : null,
        sampleType: String(body.sampleType).trim(),
        site: body.site ? String(body.site).trim() : '',
        collectedDate: body.collectedDate ? String(body.collectedDate) : undefined,
        labName: String(body.labName).trim(),
        labReference: body.labReference ? String(body.labReference).trim() : '',
        expectedDate: body.expectedDate ? String(body.expectedDate) : undefined,
        notes: body.notes ? String(body.notes).trim() : '',
      },
      actor: actorOf(auth.payload),
    });

    return NextResponse.json({ sample }, { status: 201 });
  } catch (err) {
    console.error('[pathology] POST failed:', err);
    return fail('Failed to create pathology sample record.', 500);
  }
}
