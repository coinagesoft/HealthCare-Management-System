import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAdminRequest,
  canViewAppointment,
  getScopedDoctorSlug,
  type AdminTokenPayload,
} from '@/lib/adminAuth';
import { getAppointmentById } from '@/lib/storage';
import {
  DOCTORS_SHARE_RECORDS,
  canReadHistory,
  canReadAllergiesOnly,
  canRecordHistory,
  canEditHistory,
  canDeleteHistory,
} from '@/lib/emrPermissions';
import { doctorHasSeenPatient, resolvePatientId, type Actor } from '@/lib/vitals';
import {
  cleanEditHistory,
  cleanNewHistory,
  createHistory,
  getHistoryById,
  listHistory,
  softDeleteHistory,
  updateHistory,
} from '@/lib/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Pharmacist may call GET (allergies only); every write checks its own permission below.
const ROLES: ('admin' | 'doctor' | 'receptionist' | 'pharmacist')[] = [
  'admin',
  'doctor',
  'receptionist',
  'pharmacist',
];

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function actorOf(p: AdminTokenPayload): Actor {
  return { email: p.email, name: p.name, role: p.role };
}

async function canAccessPatient(
  payload: AdminTokenPayload,
  patientId: number,
  appointmentId?: string
): Promise<boolean> {
  if (!canReadHistory(payload.role) && !canReadAllergiesOnly(payload.role)) return false;

  if (appointmentId) {
    const appt = await getAppointmentById(appointmentId);
    if (appt && !canViewAppointment(payload, appt)) return false;
  }

  const scoped = getScopedDoctorSlug(payload);
  if (scoped && !DOCTORS_SHARE_RECORDS) {
    return doctorHasSeenPatient(patientId, scoped);
  }
  return true;
}

// GET /api/admin/history?appointmentId=...   or   ?email=...&phone=...
export async function GET(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  const payload = auth.payload;

  try {
    const sp = request.nextUrl.searchParams;
    const appointmentId = sp.get('appointmentId') || undefined;
    const patientId = await resolvePatientId({
      appointmentId,
      email: sp.get('email') || undefined,
      phone: sp.get('phone') || undefined,
    });

    if (patientId === null) {
      return NextResponse.json({ patientId: null, items: [], canRecord: false, canDelete: false });
    }
    if (!(await canAccessPatient(payload, patientId, appointmentId))) {
      return fail('You do not have access to this patient\'s record.', 403);
    }

    const items = await listHistory(patientId, { allergiesOnly: canReadAllergiesOnly(payload.role) });
    return NextResponse.json({
      patientId,
      items: items.map((i) => ({ ...i, canEdit: canEditHistory(payload, i) })),
      canRecord: canRecordHistory(payload.role),
      canDelete: canDeleteHistory(payload.role),
    });
  } catch (err) {
    console.error('[history] GET failed:', err);
    return fail('Failed to load medical history.', 500);
  }
}

// POST /api/admin/history — add an entry
export async function POST(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  const payload = auth.payload;
  if (!canRecordHistory(payload.role)) return fail('Your role cannot add medical history.', 403);

  try {
    const body = await request.json();
    const appointmentId = body.appointmentId ? String(body.appointmentId) : undefined;
    const patientId = await resolvePatientId({
      appointmentId,
      email: body.email ? String(body.email) : undefined,
      phone: body.phone ? String(body.phone) : undefined,
    });
    if (patientId === null) {
      return fail('Patient not found. The patient must have at least one appointment on record.', 404);
    }
    if (!(await canAccessPatient(payload, patientId, appointmentId))) {
      return fail('You do not have access to this patient\'s record.', 403);
    }

    const cleaned = cleanNewHistory(body);
    if ('error' in cleaned) return fail(cleaned.error, 400);

    const result = await createHistory({ patientId, values: cleaned.value, actor: actorOf(payload) });
    if ('error' in result) return fail(result.error, result.status);
    return NextResponse.json({ item: { ...result.item, canEdit: true } });
  } catch (err) {
    console.error('[history] POST failed:', err);
    return fail('Failed to save the entry.', 500);
  }
}

// PATCH /api/admin/history — edit or resolve an entry. Body: { id, label?, details?, since?, status? }
export async function PATCH(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  const payload = auth.payload;

  try {
    const body = await request.json();
    const existing = body.id ? await getHistoryById(String(body.id)) : null;
    if (!existing) return fail('Entry not found.', 404);

    if (!(await canAccessPatient(payload, existing.patientId))) {
      return fail('You do not have access to this patient\'s record.', 403);
    }
    if (!canEditHistory(payload, existing)) {
      return fail('You can only correct your own entry within 24 hours. Ask the doctor to edit it.', 403);
    }

    const cleaned = cleanEditHistory(existing, body);
    if ('error' in cleaned) return fail(cleaned.error, 400);

    const saved = await updateHistory({ existing, values: cleaned.value, actor: actorOf(payload) });
    return NextResponse.json({ item: { ...saved, canEdit: true } });
  } catch (err) {
    console.error('[history] PATCH failed:', err);
    return fail('Failed to update the entry.', 500);
  }
}

// DELETE /api/admin/history?id=... — soft delete (doctor/admin only)
export async function DELETE(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  const payload = auth.payload;
  if (!canDeleteHistory(payload.role)) {
    return fail('Only a doctor or admin can remove a history entry.', 403);
  }

  try {
    const id = request.nextUrl.searchParams.get('id') || '';
    const existing = id ? await getHistoryById(id) : null;
    if (!existing) return fail('Entry not found.', 404);

    if (!(await canAccessPatient(payload, existing.patientId))) {
      return fail('You do not have access to this patient\'s record.', 403);
    }

    await softDeleteHistory(existing, actorOf(payload));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[history] DELETE failed:', err);
    return fail('Failed to remove the entry.', 500);
  }
}