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
  canReadVitals,
  canRecordVitals,
  canEditVitals,
  canDeleteVitals,
} from '@/lib/emrPermissions';
import {
  cleanVitals,
  createVitals,
  doctorHasSeenPatient,
  getVitalsById,
  listVitals,
  resolvePatientId,
  softDeleteVitals,
  updateVitals,
  type Actor,
  type VitalsEntry,
} from '@/lib/vitals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ROLES: ('admin' | 'doctor' | 'receptionist')[] = ['admin', 'doctor', 'receptionist'];

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function actorOf(p: AdminTokenPayload): Actor {
  return { email: p.email, name: p.name, role: p.role };
}

/** Can this login see this patient's record at all? */
async function canAccessPatient(
  payload: AdminTokenPayload,
  patientId: number,
  appointmentId?: string
): Promise<boolean> {
  if (!canReadVitals(payload.role)) return false;

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

// GET /api/admin/vitals?appointmentId=...   or   ?email=...&phone=...
export async function GET(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }

  try {
    const sp = request.nextUrl.searchParams;
    const appointmentId = sp.get('appointmentId') || undefined;
    const patientId = await resolvePatientId({
      appointmentId,
      email: sp.get('email') || undefined,
      phone: sp.get('phone') || undefined,
    });

    // A patient with no record yet is normal, not an error.
    if (patientId === null) {
      return NextResponse.json({ patientId: null, vitals: [] });
    }
    if (!(await canAccessPatient(auth.payload, patientId, appointmentId))) {
      return fail('You do not have access to this patient\'s record.', 403);
    }

    const vitals = await listVitals(patientId);
    const mine = vitals.map((v) => ({ ...v, canEdit: canEditVitals(auth.payload, v) }));
    return NextResponse.json({
      patientId,
      vitals: mine,
      canRecord: canRecordVitals(auth.payload.role),
      canDelete: canDeleteVitals(auth.payload.role),
    });
  } catch (err) {
    console.error('[vitals] GET failed:', err);
    return fail('Failed to load vitals.', 500);
  }
}

// POST /api/admin/vitals — record vitals for a visit
export async function POST(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  if (!canRecordVitals(auth.payload.role)) return fail('Your role cannot record vitals.', 403);

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
    if (!(await canAccessPatient(auth.payload, patientId, appointmentId))) {
      return fail('You do not have access to this patient\'s record.', 403);
    }

    const cleaned = cleanVitals(body);
    if ('error' in cleaned) return fail(cleaned.error, 400);

    const saved = await createVitals({
      patientId,
      appointmentId,
      values: cleaned.value,
      actor: actorOf(auth.payload),
    });
    return NextResponse.json({ vitals: { ...saved, canEdit: true } });
  } catch (err) {
    console.error('[vitals] POST failed:', err);
    return fail('Failed to save vitals.', 500);
  }
}

// PATCH /api/admin/vitals — correct an existing entry. Body: { id, ...fields }
export async function PATCH(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }

  try {
    const body = await request.json();
    const existing: VitalsEntry | null = body.id ? await getVitalsById(String(body.id)) : null;
    if (!existing) return fail('Vitals entry not found.', 404);

    if (!(await canAccessPatient(auth.payload, existing.patientId, existing.appointmentId || undefined))) {
      return fail('You do not have access to this patient\'s record.', 403);
    }
    if (!canEditVitals(auth.payload, existing)) {
      return fail('You can only correct your own entry within 24 hours. Ask the doctor to edit it.', 403);
    }

    const cleaned = cleanVitals(body);
    if ('error' in cleaned) return fail(cleaned.error, 400);

    const saved = await updateVitals({
      existing,
      values: cleaned.value,
      actor: actorOf(auth.payload),
    });
    return NextResponse.json({ vitals: { ...saved, canEdit: true } });
  } catch (err) {
    console.error('[vitals] PATCH failed:', err);
    return fail('Failed to update vitals.', 500);
  }
}

// DELETE /api/admin/vitals?id=... — soft delete (doctor/admin only)
export async function DELETE(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  if (!canDeleteVitals(auth.payload.role)) {
    return fail('Only a doctor or admin can remove a vitals entry.', 403);
  }

  try {
    const id = request.nextUrl.searchParams.get('id') || '';
    const existing = id ? await getVitalsById(id) : null;
    if (!existing) return fail('Vitals entry not found.', 404);

    if (!(await canAccessPatient(auth.payload, existing.patientId, existing.appointmentId || undefined))) {
      return fail('You do not have access to this patient\'s record.', 403);
    }

    await softDeleteVitals(existing, actorOf(auth.payload));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[vitals] DELETE failed:', err);
    return fail('Failed to remove vitals.', 500);
  }
}