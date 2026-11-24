import { NextRequest, NextResponse } from 'next/server';
import {
  verifyAdminRequest,
  canViewAppointment,
  canManageAppointment,
  getScopedDoctorSlug,
  type AdminTokenPayload,
} from '@/lib/adminAuth';
import { getAppointmentById } from '@/lib/storage';
import {
  DOCTORS_SHARE_RECORDS,
  canReadNotes,
  canWriteNotes,
  canEditNote,
  canDeleteNote,
  canSeeNote,
} from '@/lib/emrPermissions';
import { doctorHasSeenPatient, listVitals, resolvePatientId, type Actor } from '@/lib/vitals';
import {
  amendNote,
  createNote,
  getNoteById,
  listAmendments,
  listNotes,
  softDeleteDraft,
  updateDraft,
  type VisitNote,
} from '@/lib/visitNotes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Only doctor and admin reach this route. Receptionist and pharmacist get 403.
const ROLES: ('admin' | 'doctor')[] = ['admin', 'doctor'];

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function actorOf(p: AdminTokenPayload): Actor {
  return { email: p.email, name: p.name, role: p.role };
}

function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

async function canAccessPatient(
  payload: AdminTokenPayload,
  patientId: number,
  appointmentId?: string
): Promise<boolean> {
  if (!canReadNotes(payload.role)) return false;

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

function present(payload: AdminTokenPayload, note: VisitNote) {
  return {
    ...note,
    canEdit: canEditNote(payload, note),
    canDelete: canDeleteNote(payload, note),
  };
}

// GET /api/admin/visit-notes?appointmentId=...   (notes of that visit)
//  or  /api/admin/visit-notes?email=...&phone=... (all notes of the patient)
export async function GET(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  const payload = auth.payload;
  if (!canReadNotes(payload.role)) return fail('Your role cannot read visit notes.', 403);

  try {
    const sp = request.nextUrl.searchParams;
    const appointmentId = sp.get('appointmentId') || undefined;
    const patientId = await resolvePatientId({
      appointmentId,
      email: sp.get('email') || undefined,
      phone: sp.get('phone') || undefined,
    });

    if (patientId === null) {
      return NextResponse.json({ patientId: null, notes: [], vitals: {}, canWrite: false });
    }
    if (!(await canAccessPatient(payload, patientId, appointmentId))) {
      return fail("You do not have access to this patient's record.", 403);
    }

    const all = await listNotes({ patientId, appointmentId });
    const visible = all.filter((n) => canSeeNote(payload, n));
    const amendments = await listAmendments(visible.map((n) => n.id));

    // Latest vitals recorded for each visit, so a note can show them beside it.
    const vitalsByAppointment: Record<string, unknown> = {};
    const wanted = new Set(visible.map((n) => n.appointmentId).filter((x): x is string => Boolean(x)));
    if (wanted.size > 0) {
      for (const v of await listVitals(patientId)) {
        if (v.appointmentId && wanted.has(v.appointmentId) && !vitalsByAppointment[v.appointmentId]) {
          vitalsByAppointment[v.appointmentId] = {
            weightKg: v.weightKg,
            heightCm: v.heightCm,
            bmi: v.bmi,
            bpSystolic: v.bpSystolic,
            bpDiastolic: v.bpDiastolic,
            pulse: v.pulse,
          };
        }
      }
    }

    return NextResponse.json({
      patientId,
      notes: visible.map((n) => ({ ...present(payload, n), amendments: amendments[n.id] || [] })),
      vitals: vitalsByAppointment,
      canWrite: canWriteNotes(payload.role),
    });
  } catch (err) {
    console.error('[visit-notes] GET failed:', err);
    return fail('Failed to load visit notes.', 500);
  }
}

// POST /api/admin/visit-notes — new note. Body: { appointmentId, templateKey, answers, finalize? }
export async function POST(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  const payload = auth.payload;
  if (!canWriteNotes(payload.role)) return fail('Only a doctor can write visit notes.', 403);

  try {
    const body = await request.json();
    const appointmentId = body.appointmentId ? String(body.appointmentId) : '';
    if (!appointmentId) return fail('appointmentId is required.', 400);

    const appointment = await getAppointmentById(appointmentId);
    if (!appointment) return fail('Appointment not found.', 404);
    if (!canManageAppointment(payload, appointment)) {
      return fail('Only the assigned doctor can write a note for this visit. Assign the patient to yourself first.', 403);
    }

    const patientId = await resolvePatientId({ appointmentId });
    if (patientId === null) {
      return fail('Patient not found. The patient must have at least one appointment on record.', 404);
    }
    if (!(await canAccessPatient(payload, patientId, appointmentId))) {
      return fail("You do not have access to this patient's record.", 403);
    }

    const result = await createNote({
      patientId,
      appointmentId,
      visitDate: appointment.date || todayIst(),
      templateKey: String(body.templateKey || ''),
      answers: body.answers,
      finalize: body.finalize === true,
      doctorSlug: payload.doctorSlug || appointment.doctorSlug || '',
      actor: actorOf(payload),
    });
    if ('error' in result) return fail(result.error, result.status);
    return NextResponse.json({ note: { ...present(payload, result.note), amendments: [] } });
  } catch (err) {
    console.error('[visit-notes] POST failed:', err);
    return fail('Failed to save the note.', 500);
  }
}

// PATCH /api/admin/visit-notes
//   draft: { id, answers, finalize?, expectedUpdatedAt? }
//   final: { id, answers, amendReason }
export async function PATCH(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  const payload = auth.payload;
  if (!canWriteNotes(payload.role)) return fail('Only a doctor can change visit notes.', 403);

  try {
    const body = await request.json();
    const existing = body.id ? await getNoteById(String(body.id)) : null;
    if (!existing || !canSeeNote(payload, existing)) return fail('Note not found.', 404);

    if (!(await canAccessPatient(payload, existing.patientId))) {
      return fail("You do not have access to this patient's record.", 403);
    }
    if (!canEditNote(payload, existing)) {
      return fail('Only the doctor who wrote this note can change it.', 403);
    }
    if (body.expectedUpdatedAt && String(body.expectedUpdatedAt) !== existing.updatedAt) {
      return fail('This note was changed elsewhere. Reload it and try again.', 409);
    }

    const result =
      existing.status === 'draft'
        ? await updateDraft({
            existing,
            answers: body.answers,
            finalize: body.finalize === true,
            actor: actorOf(payload),
          })
        : await amendNote({
            existing,
            answers: body.answers,
            reason: String(body.amendReason || ''),
            actor: actorOf(payload),
          });

    if ('error' in result) return fail(result.error, result.status);
    return NextResponse.json({ note: present(payload, result.note) });
  } catch (err) {
    console.error('[visit-notes] PATCH failed:', err);
    return fail('Failed to update the note.', 500);
  }
}

// DELETE /api/admin/visit-notes?id=... — removes a DRAFT (final notes cannot be deleted)
export async function DELETE(request: NextRequest) {
  const auth = verifyAdminRequest(request, ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  const payload = auth.payload;
  if (!canWriteNotes(payload.role)) return fail('Only a doctor can delete a draft note.', 403);

  try {
    const id = request.nextUrl.searchParams.get('id') || '';
    const existing = id ? await getNoteById(id) : null;
    if (!existing || !canSeeNote(payload, existing)) return fail('Note not found.', 404);

    if (!canDeleteNote(payload, existing)) {
      return fail(
        existing.status === 'final'
          ? 'A final note cannot be deleted. Use an amendment instead.'
          : 'Only the doctor who wrote this draft can delete it.',
        403
      );
    }

    const result = await softDeleteDraft(existing, actorOf(payload));
    if ('error' in result) return fail(result.error, result.status);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[visit-notes] DELETE failed:', err);
    return fail('Failed to delete the draft.', 500);
  }
}