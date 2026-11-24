import type { AdminTokenPayload } from '@/lib/adminAuth';

/**
 * Who may do what with EMR data (vitals, medical history; notes and pathology later).
 * Keep every EMR permission rule in this one file so it is easy to review and change.
 */

/**
 * true  = every doctor can see every patient's records (shared clinic record).
 * false = a doctor only sees patients who have an appointment with them (or an unassigned one).
 * Change this one line once you decide the clinic policy.
 */
export const DOCTORS_SHARE_RECORDS = true;

type Role = AdminTokenPayload['role'];

/** Receptionist may only fix their OWN entry, and only within this many hours. */
export const RECEPTIONIST_EDIT_WINDOW_HOURS = 24;

function receptionistMayEdit(
  payload: AdminTokenPayload,
  entry: { recordedBy?: string | null; recordedAt?: string; createdAt?: string }
): boolean {
  const mine = (entry.recordedBy || '').toLowerCase() === (payload.email || '').toLowerCase();
  const stamp = entry.recordedAt || entry.createdAt || '';
  const ageMs = Date.now() - new Date(stamp).getTime();
  return mine && Number.isFinite(ageMs) && ageMs <= RECEPTIONIST_EDIT_WINDOW_HOURS * 60 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Vitals
// ---------------------------------------------------------------------------

/** Admin, doctor and receptionist work with vitals. Pharmacist has no access. */
export function canReadVitals(role?: Role | string): boolean {
  return role === 'admin' || role === 'doctor' || role === 'receptionist';
}

export function canRecordVitals(role?: Role | string): boolean {
  return canReadVitals(role);
}

export function canEditVitals(
  payload: AdminTokenPayload | undefined,
  entry: { recordedBy?: string | null; recordedAt: string }
): boolean {
  if (!payload) return false;
  if (payload.role === 'admin' || payload.role === 'doctor') return true;
  if (payload.role === 'receptionist') return receptionistMayEdit(payload, entry);
  return false;
}

/** Only doctor/admin can remove an entry (it is a soft delete and stays in the audit log). */
export function canDeleteVitals(role?: Role | string): boolean {
  return role === 'admin' || role === 'doctor';
}

// ---------------------------------------------------------------------------
// Medical history (allergies, illnesses, surgeries, family history, habits, current medicines)
// ---------------------------------------------------------------------------

/** Admin, doctor and receptionist see the full history. */
export function canReadHistory(role?: Role | string): boolean {
  return role === 'admin' || role === 'doctor' || role === 'receptionist';
}

/** Pharmacist sees ALLERGIES ONLY (so they can check a prescription), nothing else. */
export function canReadAllergiesOnly(role?: Role | string): boolean {
  return role === 'pharmacist';
}

/** Receptionist records what the patient reports at check-in; the doctor can record anything. */
export function canRecordHistory(role?: Role | string): boolean {
  return canReadHistory(role);
}

export function canEditHistory(
  payload: AdminTokenPayload | undefined,
  entry: { recordedBy?: string | null; createdAt: string }
): boolean {
  if (!payload) return false;
  if (payload.role === 'admin' || payload.role === 'doctor') return true;
  if (payload.role === 'receptionist') return receptionistMayEdit(payload, entry);
  return false;
}

/** Only doctor/admin can remove an entry (soft delete, kept in the audit log). */
export function canDeleteHistory(role?: Role | string): boolean {
  return role === 'admin' || role === 'doctor';
}

// ---------------------------------------------------------------------------
// Visit notes (structured clinical notes)
// ---------------------------------------------------------------------------

/**
 * Doctor and admin can read FINAL notes. Receptionist and pharmacist have no access
 * (same rule as the clinical notes today). A DRAFT is visible only to the doctor who wrote it.
 */
export function canReadNotes(role?: Role | string): boolean {
  return role === 'admin' || role === 'doctor';
}

/** Only a doctor writes notes. Admin is read-only. */
export function canWriteNotes(role?: Role | string): boolean {
  return role === 'doctor';
}

function isNoteAuthor(payload: AdminTokenPayload | undefined, note: { authorEmail?: string | null }): boolean {
  if (!payload || payload.role !== 'doctor') return false;
  return (note.authorEmail || '').toLowerCase() === (payload.email || '').toLowerCase();
}

/** Only the author edits a draft or amends a final note. Other doctors can read final notes only. */
export function canEditNote(
  payload: AdminTokenPayload | undefined,
  note: { authorEmail?: string | null }
): boolean {
  return isNoteAuthor(payload, note);
}

/** Only the author can remove a DRAFT. A final note is never deleted. */
export function canDeleteNote(
  payload: AdminTokenPayload | undefined,
  note: { authorEmail?: string | null; status: string }
): boolean {
  return note.status === 'draft' && isNoteAuthor(payload, note);
}

/** Can this person see this note at all? Final notes: any doctor/admin. Drafts: the author only. */
export function canSeeNote(
  payload: AdminTokenPayload | undefined,
  note: { authorEmail?: string | null; status: string }
): boolean {
  if (!payload || !canReadNotes(payload.role)) return false;
  return note.status === 'final' || isNoteAuthor(payload, note);
}

// ---------------------------------------------------------------------------
// Biopsy & Pathology Tracking
// ---------------------------------------------------------------------------

/** Admin, doctor and receptionist can see pathology samples and tracking status. */
export function canReadPathology(role?: Role | string): boolean {
  return role === 'admin' || role === 'doctor' || role === 'receptionist';
}

/** Admin, doctor and receptionist can log a dispatched sample. */
export function canRecordPathology(role?: Role | string): boolean {
  return canReadPathology(role);
}

/** Receptionist, doctor and admin can mark a sample as received from the lab. */
export function canReceivePathology(role?: Role | string): boolean {
  return canReadPathology(role);
}

/** Only doctor and admin can review pathology results, enter result summaries, and sign off. */
export function canReviewPathology(role?: Role | string): boolean {
  return role === 'admin' || role === 'doctor';
}

/** Only doctor and admin can delete a pathology sample entry (soft delete in audit log). */
export function canDeletePathology(role?: Role | string): boolean {
  return role === 'admin' || role === 'doctor';
}
