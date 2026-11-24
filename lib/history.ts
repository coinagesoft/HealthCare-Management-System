import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'crypto';
import { getPool } from './db';
import { ensureVitalsSchema, writeAudit, type Actor } from './vitals';
import { HISTORY_TYPE_KEYS, NO_KNOWN_ALLERGIES_LABEL } from './historyConstants';

/**
 * Structured medical history: one row per item (allergy, current medicine, illness,
 * surgery, family history, habit). Keyed by patients.id like the vitals module.
 *
 * - Allergies need an explicit answer: either real allergies, or the "No known allergies"
 *   marker (is_none = 1). An empty list therefore means "not asked yet", not "none".
 * - Delete is a soft delete; every change goes to emr_audit_log (created by lib/vitals.ts).
 */

declare global {
  // eslint-disable-next-line no-var
  var __historySchemaPromise: Promise<void> | undefined;
}

export interface HistoryItem {
  id: string;
  patientId: number;
  type: string;
  label: string;
  details: string;
  since: string;
  status: 'active' | 'resolved';
  isNone: boolean;
  recordedBy: string;
  recordedByName: string;
  recordedByRole: string;
  createdAt: string;
  updatedAt: string;
}

interface HistoryRow extends RowDataPacket {
  id: string;
  patient_id: number;
  type: string;
  label: string;
  details: string | null;
  since: string | null;
  status: string;
  is_none: number;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_by_role: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function ensureHistorySchema(): Promise<void> {
  if (!global.__historySchemaPromise) {
    global.__historySchemaPromise = (async () => {
      await ensureVitalsSchema(); // patients + emr_audit_log
      await getPool().execute(`
        CREATE TABLE IF NOT EXISTS patient_history (
          id VARCHAR(64) PRIMARY KEY,
          patient_id INT NOT NULL,
          type VARCHAR(24) NOT NULL,
          label VARCHAR(255) NOT NULL,
          details VARCHAR(500) NULL,
          since VARCHAR(32) NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'active',
          is_none TINYINT(1) NOT NULL DEFAULT 0,
          recorded_by VARCHAR(255) NULL,
          recorded_by_name VARCHAR(255) NULL,
          recorded_by_role VARCHAR(32) NULL,
          created_at VARCHAR(64) NOT NULL,
          updated_at VARCHAR(64) NOT NULL,
          deleted_at VARCHAR(64) NULL,
          INDEX idx_history_patient (patient_id, type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    })().catch((err) => {
      global.__historySchemaPromise = undefined;
      throw err;
    });
  }
  return global.__historySchemaPromise;
}

function mapRow(r: HistoryRow): HistoryItem {
  return {
    id: r.id,
    patientId: Number(r.patient_id),
    type: r.type,
    label: r.label,
    details: r.details || '',
    since: r.since || '',
    status: r.status === 'resolved' ? 'resolved' : 'active',
    isNone: Boolean(r.is_none),
    recordedBy: r.recorded_by || '',
    recordedByName: r.recorded_by_name || '',
    recordedByRole: r.recorded_by_role || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface HistoryInput {
  type?: string;
  label?: string;
  details?: string;
  since?: string;
  status?: string;
  isNone?: boolean;
}

export interface CleanHistory {
  type: string;
  label: string;
  details: string;
  since: string;
  status: 'active' | 'resolved';
  isNone: boolean;
}

/** Validates a NEW entry. */
export function cleanNewHistory(input: HistoryInput): { error: string } | { value: CleanHistory } {
  const type = String(input.type || '');
  if (!HISTORY_TYPE_KEYS.includes(type)) return { error: 'Choose a valid history type.' };

  const isNone = Boolean(input.isNone);
  if (isNone && type !== 'allergy') {
    return { error: '"No known allergies" can only be recorded under Allergies.' };
  }

  const label = isNone ? NO_KNOWN_ALLERGIES_LABEL : String(input.label || '').trim();
  if (!label) return { error: 'Enter what to record.' };
  if (label.length > 255) return { error: 'The entry is too long (max 255 characters).' };

  const details = String(input.details || '').trim();
  const since = String(input.since || '').trim();
  if (details.length > 500) return { error: 'Details are too long (max 500 characters).' };
  if (since.length > 32) return { error: '"Since" is too long (max 32 characters).' };

  const status = input.status === 'resolved' && !isNone ? 'resolved' : 'active';
  return { value: { type, label, details, since, status, isNone } };
}

/** Validates an EDIT: only label, details, since and status can change (not the type). */
export function cleanEditHistory(
  existing: HistoryItem,
  input: HistoryInput
): { error: string } | { value: Pick<CleanHistory, 'label' | 'details' | 'since' | 'status'> } {
  const label = existing.isNone ? existing.label : String(input.label ?? existing.label).trim();
  if (!label) return { error: 'The entry cannot be empty.' };
  if (label.length > 255) return { error: 'The entry is too long (max 255 characters).' };

  const details = String(input.details ?? existing.details).trim();
  const since = String(input.since ?? existing.since).trim();
  if (details.length > 500) return { error: 'Details are too long (max 500 characters).' };
  if (since.length > 32) return { error: '"Since" is too long (max 32 characters).' };

  const status = input.status === 'resolved' || input.status === 'active' ? input.status : existing.status;
  return { value: { label, details, since, status } };
}

// ---------------------------------------------------------------------------
// Reads / writes
// ---------------------------------------------------------------------------

export async function listHistory(
  patientId: number,
  opts: { allergiesOnly?: boolean } = {}
): Promise<HistoryItem[]> {
  await ensureHistorySchema();
  const [rows] = await getPool().execute<HistoryRow[]>(
    `SELECT * FROM patient_history
     WHERE patient_id = ? AND deleted_at IS NULL ${opts.allergiesOnly ? "AND type = 'allergy'" : ''}
     ORDER BY type ASC, (status = 'active') DESC, created_at DESC
     LIMIT 500`,
    [patientId]
  );
  return rows.map(mapRow);
}

export async function getHistoryById(id: string): Promise<HistoryItem | null> {
  await ensureHistorySchema();
  const [rows] = await getPool().execute<HistoryRow[]>(
    `SELECT * FROM patient_history WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function createHistory(opts: {
  patientId: number;
  values: CleanHistory;
  actor: Actor;
}): Promise<{ error: string; status: number } | { item: HistoryItem }> {
  await ensureHistorySchema();
  const { patientId, values, actor } = opts;
  const pool = getPool();

  const [activeRows] = await pool.execute<HistoryRow[]>(
    `SELECT * FROM patient_history
     WHERE patient_id = ? AND type = ? AND deleted_at IS NULL AND status = 'active'`,
    [patientId, values.type]
  );
  const active = activeRows.map(mapRow);

  // No duplicates of the same active item
  if (active.some((a) => a.label.toLowerCase() === values.label.toLowerCase())) {
    return { error: `"${values.label}" is already recorded.`, status: 409 };
  }

  if (values.type === 'allergy') {
    if (values.isNone && active.some((a) => !a.isNone)) {
      return {
        error: 'This patient has allergies recorded. Remove or resolve them before marking "No known allergies".',
        status: 409,
      };
    }
    // Recording a real allergy replaces the "No known allergies" marker
    if (!values.isNone) {
      for (const marker of active.filter((a) => a.isNone)) {
        await pool.execute(`UPDATE patient_history SET deleted_at = ? WHERE id = ?`, [
          new Date().toISOString(),
          marker.id,
        ]);
        await writeAudit({
          entity: 'history',
          entityId: marker.id,
          patientId,
          action: 'delete',
          actor,
          before: marker,
          after: { reason: 'replaced by a recorded allergy' },
        });
      }
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await pool.execute(
    `INSERT INTO patient_history
      (id, patient_id, type, label, details, since, status, is_none,
       recorded_by, recorded_by_name, recorded_by_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      patientId,
      values.type,
      values.label,
      values.details || null,
      values.since || null,
      values.status,
      values.isNone ? 1 : 0,
      actor.email,
      actor.name,
      actor.role,
      now,
      now,
    ]
  );

  const item = (await getHistoryById(id)) as HistoryItem;
  await writeAudit({ entity: 'history', entityId: id, patientId, action: 'create', actor, after: item });
  return { item };
}

export async function updateHistory(opts: {
  existing: HistoryItem;
  values: Pick<CleanHistory, 'label' | 'details' | 'since' | 'status'>;
  actor: Actor;
}): Promise<HistoryItem> {
  await ensureHistorySchema();
  const { existing, values, actor } = opts;
  await getPool().execute(
    `UPDATE patient_history SET label = ?, details = ?, since = ?, status = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [values.label, values.details || null, values.since || null, values.status, new Date().toISOString(), existing.id]
  );
  const saved = (await getHistoryById(existing.id)) as HistoryItem;
  await writeAudit({
    entity: 'history',
    entityId: existing.id,
    patientId: existing.patientId,
    action: 'update',
    actor,
    before: existing,
    after: saved,
  });
  return saved;
}

export async function softDeleteHistory(existing: HistoryItem, actor: Actor): Promise<void> {
  await ensureHistorySchema();
  await getPool().execute(`UPDATE patient_history SET deleted_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    existing.id,
  ]);
  await writeAudit({
    entity: 'history',
    entityId: existing.id,
    patientId: existing.patientId,
    action: 'delete',
    actor,
    before: existing,
  });
}
