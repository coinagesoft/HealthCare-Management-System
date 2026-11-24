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