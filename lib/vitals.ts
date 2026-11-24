import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import crypto from 'crypto';
import { getPool, ensureDatabaseSchema } from './db';
import { getAppointmentById } from './storage';

/**
 * Vitals (weight, height, BMI, BP, pulse) per patient visit.
 *
 * - Every record is keyed by `patients.id` (not by email), so a later "merge duplicate
 *   patients" step only has to UPDATE patient_id on these rows.
 * - appointment_id is optional: walk-ins and check-ins without a booking still work.
 * - Deleting is a soft delete (deleted_at). Every change is written to emr_audit_log.
 * - Tables are created here on first use, so lib/db.ts does not need to change.
 */

declare global {
  // eslint-disable-next-line no-var
  var __vitalsSchemaPromise: Promise<void> | undefined;
}

export interface VitalsEntry {
  id: string;
  patientId: number;
  appointmentId: string | null;
  visitDate: string; // YYYY-MM-DD
  recordedAt: string; // ISO
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
  notes: string;
  recordedBy: string;
  recordedByName: string;
  recordedByRole: string;
  updatedAt: string;
}

export interface VitalsInput {
  weightKg?: number | null;
  heightCm?: number | null;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  pulse?: number | null;
  notes?: string;
  visitDate?: string;
}

export interface Actor {
  email: string;
  name: string;
  role: string;
}

interface VitalsRow extends RowDataPacket {
  id: string;
  patient_id: number;
  appointment_id: string | null;
  visit_date: string;
  recorded_at: string;
  weight_kg: string | number | null;
  height_cm: string | number | null;
  bmi: string | number | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  pulse: number | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_by_role: string | null;
  updated_at: string;
  deleted_at: string | null;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function ensureVitalsSchema(): Promise<void> {
  if (!global.__vitalsSchemaPromise) {
    global.__vitalsSchemaPromise = (async () => {
      await ensureDatabaseSchema(); // makes sure `patients` exists first
      const pool = getPool();

      await pool.execute(`
        CREATE TABLE IF NOT EXISTS patient_vitals (
          id VARCHAR(64) PRIMARY KEY,
          patient_id INT NOT NULL,
          appointment_id VARCHAR(64) NULL,
          visit_date VARCHAR(16) NOT NULL,
          recorded_at VARCHAR(64) NOT NULL,
          weight_kg DECIMAL(5,1) NULL,
          height_cm DECIMAL(5,1) NULL,
          bmi DECIMAL(4,1) NULL,
          bp_systolic SMALLINT NULL,
          bp_diastolic SMALLINT NULL,
          pulse SMALLINT NULL,
          notes VARCHAR(255) NULL,
          recorded_by VARCHAR(255) NULL,
          recorded_by_name VARCHAR(255) NULL,
          recorded_by_role VARCHAR(32) NULL,
          updated_at VARCHAR(64) NOT NULL,
          deleted_at VARCHAR(64) NULL,
          INDEX idx_vitals_patient_date (patient_id, visit_date),
          INDEX idx_vitals_appt (appointment_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // Shared by all EMR modules (vitals now; history, notes and pathology later).
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS emr_audit_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          entity VARCHAR(32) NOT NULL,
          entity_id VARCHAR(64) NOT NULL,
          patient_id INT NULL,
          action VARCHAR(16) NOT NULL,
          actor_email VARCHAR(255) NULL,
          actor_name VARCHAR(255) NULL,
          actor_role VARCHAR(32) NULL,
          before_json LONGTEXT NULL,
          after_json LONGTEXT NULL,
          created_at VARCHAR(64) NOT NULL,
          INDEX idx_audit_entity (entity, entity_id),
          INDEX idx_audit_patient (patient_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    })().catch((err) => {
      global.__vitalsSchemaPromise = undefined; // allow a retry on the next request
      throw err;
    });
  }
  return global.__vitalsSchemaPromise;
}

export async function writeAudit(opts: {
  entity: string;
  entityId: string;
  patientId: number | null;
  action: 'create' | 'update' | 'delete';
  actor: Actor;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await getPool().execute(
      `INSERT INTO emr_audit_log
        (entity, entity_id, patient_id, action, actor_email, actor_name, actor_role, before_json, after_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        opts.entity,
        opts.entityId,
        opts.patientId,
        opts.action,
        opts.actor.email,
        opts.actor.name,
        opts.actor.role,
        opts.before === undefined ? null : JSON.stringify(opts.before),
        opts.after === undefined ? null : JSON.stringify(opts.after),
        new Date().toISOString(),
      ]
    );
  } catch (err) {
    // An audit failure must never lose the clinical entry itself, but it must be visible in the logs.
    console.error('[emr-audit] failed to write audit row:', err);
  }
}

// ---------------------------------------------------------------------------
// Patient identity
// ---------------------------------------------------------------------------

/**
 * Finds the `patients.id` for an appointment, an email or a phone number.
 * Returns null when the patient is not in the patients table yet.
 */
export async function resolvePatientId(opts: {
  appointmentId?: string;
  email?: string;
  phone?: string;
}): Promise<number | null> {
  await ensureVitalsSchema();
  const pool = getPool();

  let email = (opts.email || '').trim().toLowerCase();
  let phone = (opts.phone || '').trim();

  if (opts.appointmentId) {
    const appt = await getAppointmentById(opts.appointmentId);
    if (appt) {
      email = (appt.email || '').trim().toLowerCase() || email;
      phone = appt.phone || phone;
    }
  }

  if (email) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM patients WHERE email = ? LIMIT 1`,
      [email]
    );
    if (rows[0]) return Number(rows[0].id);
  }

  const last10 = phone.replace(/\D/g, '').slice(-10);
  if (last10.length === 10) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id FROM patients
       WHERE REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ?
       ORDER BY updated_at DESC LIMIT 1`,
      [`%${last10}`]
    );
    if (rows[0]) return Number(rows[0].id);
  }

  return null;
}

/** Used when a doctor is restricted to their own patients (see DOCTORS_SHARE_RECORDS). */
export async function doctorHasSeenPatient(patientId: number, doctorSlug: string): Promise<boolean> {
  const pool = getPool();
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM appointments a
     JOIN patients p ON LOWER(a.email) = p.email
     WHERE p.id = ? AND (a.doctor_slug = ? OR a.doctor_slug IS NULL OR a.doctor_slug = '')
     LIMIT 1`,
    [patientId, doctorSlug]
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Validation + BMI
// ---------------------------------------------------------------------------

export function calcBmi(weightKg: number | null, heightCm: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function inRange(n: number | null, min: number, max: number): boolean {
  return n === null || (Number.isFinite(n) && n >= min && n <= max);
}

export interface CleanVitals {
  weightKg: number | null;
  heightCm: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
  notes: string;
  visitDate?: string;
}

/** Cleans and validates user input. Returns an error string, or the cleaned values. */
export function cleanVitals(input: VitalsInput): { error: string } | { value: CleanVitals } {
  const weightKg = num(input.weightKg);
  const heightCm = num(input.heightCm);
  const sys = num(input.bpSystolic);
  const dia = num(input.bpDiastolic);
  const pulse = num(input.pulse);

  if (!inRange(weightKg, 1, 400)) return { error: 'Weight must be between 1 and 400 kg.' };
  if (!inRange(heightCm, 30, 250)) return { error: 'Height must be between 30 and 250 cm.' };
  if (!inRange(sys, 50, 300)) return { error: 'Systolic BP must be between 50 and 300.' };
  if (!inRange(dia, 30, 200)) return { error: 'Diastolic BP must be between 30 and 200.' };
  if (!inRange(pulse, 20, 250)) return { error: 'Pulse must be between 20 and 250 bpm.' };
  if ((sys === null) !== (dia === null)) {
    return { error: 'Enter both systolic and diastolic BP, or leave both empty.' };
  }
  if (sys !== null && dia !== null && sys <= dia) {
    return { error: 'Systolic BP must be higher than diastolic BP.' };
  }
  if (weightKg === null && heightCm === null && sys === null && pulse === null) {
    return { error: 'Enter at least one measurement.' };
  }

  let visitDate: string | undefined;
  if (input.visitDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.visitDate) || Number.isNaN(Date.parse(input.visitDate))) {
      return { error: 'Visit date is not valid.' };
    }
    visitDate = input.visitDate;
  }

  return {
    value: {
      weightKg: weightKg === null ? null : Math.round(weightKg * 10) / 10,
      heightCm: heightCm === null ? null : Math.round(heightCm * 10) / 10,
      bpSystolic: sys === null ? null : Math.round(sys),
      bpDiastolic: dia === null ? null : Math.round(dia),
      pulse: pulse === null ? null : Math.round(pulse),
      notes: String(input.notes || '').trim().slice(0, 255),
      visitDate,
    },
  };
}

// ---------------------------------------------------------------------------
// Reads / writes
// ---------------------------------------------------------------------------

function mapRow(r: VitalsRow): VitalsEntry {
  const n = (v: string | number | null) => (v === null || v === undefined ? null : Number(v));
  return {
    id: r.id,
    patientId: Number(r.patient_id),
    appointmentId: r.appointment_id,
    visitDate: r.visit_date,
    recordedAt: r.recorded_at,
    weightKg: n(r.weight_kg),
    heightCm: n(r.height_cm),
    bmi: n(r.bmi),
    bpSystolic: r.bp_systolic,
    bpDiastolic: r.bp_diastolic,
    pulse: r.pulse,
    notes: r.notes || '',
    recordedBy: r.recorded_by || '',
    recordedByName: r.recorded_by_name || '',
    recordedByRole: r.recorded_by_role || '',
    updatedAt: r.updated_at,
  };
}

function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** Newest first. */
export async function listVitals(patientId: number, limit = 200): Promise<VitalsEntry[]> {
  await ensureVitalsSchema();
  const [rows] = await getPool().execute<VitalsRow[]>(
    `SELECT * FROM patient_vitals
     WHERE patient_id = ? AND deleted_at IS NULL
     ORDER BY visit_date DESC, recorded_at DESC
     LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`,
    [patientId]
  );
  return rows.map(mapRow);
}

export async function getVitalsById(id: string): Promise<VitalsEntry | null> {
  await ensureVitalsSchema();
  const [rows] = await getPool().execute<VitalsRow[]>(
    `SELECT * FROM patient_vitals WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Latest height on file, so BMI can be calculated when only weight is entered at a visit. */
async function latestHeightCm(patientId: number): Promise<number | null> {
  const [rows] = await getPool().execute<RowDataPacket[]>(
    `SELECT height_cm FROM patient_vitals
     WHERE patient_id = ? AND deleted_at IS NULL AND height_cm IS NOT NULL
     ORDER BY visit_date DESC, recorded_at DESC LIMIT 1`,
    [patientId]
  );
  return rows[0] ? Number(rows[0].height_cm) : null;
}

export async function createVitals(opts: {
  patientId: number;
  appointmentId?: string | null;
  values: CleanVitals;
  actor: Actor;
}): Promise<VitalsEntry> {
  await ensureVitalsSchema();
  const { patientId, values, actor } = opts;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const height = values.heightCm ?? (await latestHeightCm(patientId));
  const bmi = calcBmi(values.weightKg, height);

  await getPool().execute<ResultSetHeader>(
    `INSERT INTO patient_vitals
      (id, patient_id, appointment_id, visit_date, recorded_at, weight_kg, height_cm, bmi,
       bp_systolic, bp_diastolic, pulse, notes, recorded_by, recorded_by_name, recorded_by_role, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      patientId,
      opts.appointmentId || null,
      values.visitDate || todayIst(),
      now,
      values.weightKg,
      values.heightCm,
      bmi,
      values.bpSystolic,
      values.bpDiastolic,
      values.pulse,
      values.notes || null,
      actor.email,
      actor.name,
      actor.role,
      now,
    ]
  );

  const saved = (await getVitalsById(id)) as VitalsEntry;
  await writeAudit({ entity: 'vitals', entityId: id, patientId, action: 'create', actor, after: saved });
  return saved;
}

export async function updateVitals(opts: {
  existing: VitalsEntry;
  values: CleanVitals;
  actor: Actor;
}): Promise<VitalsEntry> {
  await ensureVitalsSchema();
  const { existing, values, actor } = opts;
  const height = values.heightCm ?? (await latestHeightCm(existing.patientId));
  const bmi = calcBmi(values.weightKg, height);

  await getPool().execute(
    `UPDATE patient_vitals SET
       visit_date = ?, weight_kg = ?, height_cm = ?, bmi = ?,
       bp_systolic = ?, bp_diastolic = ?, pulse = ?, notes = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [
      values.visitDate || existing.visitDate,
      values.weightKg,
      values.heightCm,
      bmi,
      values.bpSystolic,
      values.bpDiastolic,
      values.pulse,
      values.notes || null,
      new Date().toISOString(),
      existing.id,
    ]
  );

  const saved = (await getVitalsById(existing.id)) as VitalsEntry;
  await writeAudit({
    entity: 'vitals',
    entityId: existing.id,
    patientId: existing.patientId,
    action: 'update',
    actor,
    before: existing,
    after: saved,
  });
  return saved;
}

export async function softDeleteVitals(existing: VitalsEntry, actor: Actor): Promise<void> {
  await ensureVitalsSchema();
  await getPool().execute(`UPDATE patient_vitals SET deleted_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    existing.id,
  ]);
  await writeAudit({
    entity: 'vitals',
    entityId: existing.id,
    patientId: existing.patientId,
    action: 'delete',
    actor,
    before: existing,
  });
}
