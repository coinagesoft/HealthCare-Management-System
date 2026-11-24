import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import crypto from 'crypto';
import { getPool } from './db';
import { ensureVitalsSchema, writeAudit, type Actor } from './vitals';
import {
  cleanAnswers,
  findTemplate,
  hasAnyAnswer,
  missingRequired,
  sameAnswers,
  snapshotOf,
  type AnswerMap,
  type NoteTemplate,
} from './visitNoteTemplates';

/**
 * Structured visit notes.
 *
 * - One row per note in `visit_notes`. The answers are stored as JSON together with a full copy
 *   of the template they were written with, so old notes stay readable if a template changes.
 * - A note is a DRAFT (the author can keep editing) or FINAL. A final note is never silently
 *   overwritten: a change is an AMENDMENT (reason required) saved in `visit_note_amendments`,
 *   and the previous answers also go to `emr_audit_log`.
 * - Notes are keyed by patients.id like vitals and history, so a later "merge duplicate
 *   patients" step only has to UPDATE patient_id.
 * - Tables are created here on first use, so lib/db.ts does not need to change.
 */

declare global {
  // eslint-disable-next-line no-var
  var __visitNotesSchemaPromise: Promise<void> | undefined;
}

export type NoteStatus = 'draft' | 'final';

export interface VisitNote {
  id: string;
  patientId: number;
  appointmentId: string | null;
  visitDate: string;
  templateKey: string;
  snapshot: NoteTemplate;
  answers: AnswerMap;
  status: NoteStatus;
  revision: number;
  doctorSlug: string;
  authorEmail: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
}

export interface NoteAmendment {
  id: number;
  noteId: string;
  revision: number;
  reason: string;
  amendedByName: string;
  createdAt: string;
}

interface NoteRow extends RowDataPacket {
  id: string;
  patient_id: number;
  appointment_id: string | null;
  visit_date: string;
  template_key: string;
  snapshot: string;
  answers: string;
  status: string;
  revision: number;
  doctor_slug: string | null;
  author_email: string | null;
  author_name: string | null;
  author_role: string | null;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
  deleted_at: string | null;
}

interface AmendmentRow extends RowDataPacket {
  id: number;
  note_id: string;
  revision: number;
  reason: string;
  amended_by_name: string | null;
  created_at: string;
}

type Failure = { error: string; status: number };

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function ensureVisitNotesSchema(): Promise<void> {
  if (!global.__visitNotesSchemaPromise) {
    global.__visitNotesSchemaPromise = (async () => {
      await ensureVitalsSchema(); // patients + emr_audit_log
      const pool = getPool();

      await pool.execute(`
        CREATE TABLE IF NOT EXISTS visit_notes (
          id VARCHAR(64) PRIMARY KEY,
          patient_id INT NOT NULL,
          appointment_id VARCHAR(64) NULL,
          visit_date VARCHAR(16) NOT NULL,
          template_key VARCHAR(48) NOT NULL,
          snapshot LONGTEXT NOT NULL,
          answers LONGTEXT NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'draft',
          revision INT NOT NULL DEFAULT 0,
          doctor_slug VARCHAR(64) NULL,
          author_email VARCHAR(255) NULL,
          author_name VARCHAR(255) NULL,
          author_role VARCHAR(32) NULL,
          created_at VARCHAR(64) NOT NULL,
          updated_at VARCHAR(64) NOT NULL,
          finalized_at VARCHAR(64) NULL,
          deleted_at VARCHAR(64) NULL,
          INDEX idx_vnote_patient (patient_id, visit_date),
          INDEX idx_vnote_appt (appointment_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      await pool.execute(`
        CREATE TABLE IF NOT EXISTS visit_note_amendments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          note_id VARCHAR(64) NOT NULL,
          revision INT NOT NULL,
          reason VARCHAR(500) NOT NULL,
          answers_before LONGTEXT NOT NULL,
          answers_after LONGTEXT NOT NULL,
          amended_by_email VARCHAR(255) NULL,
          amended_by_name VARCHAR(255) NULL,
          created_at VARCHAR(64) NOT NULL,
          INDEX idx_vnamend_note (note_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    })().catch((err) => {
      global.__visitNotesSchemaPromise = undefined; // allow a retry on the next request
      throw err;
    });
  }
  return global.__visitNotesSchemaPromise;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function mapRow(r: NoteRow): VisitNote {
  return {
    id: r.id,
    patientId: Number(r.patient_id),
    appointmentId: r.appointment_id || null,
    visitDate: r.visit_date,
    templateKey: r.template_key,
    snapshot: parseJson<NoteTemplate>(r.snapshot, { key: r.template_key, label: r.template_key, description: '', sections: [] }),
    answers: parseJson<AnswerMap>(r.answers, {}),
    status: r.status === 'final' ? 'final' : 'draft',
    revision: Number(r.revision) || 0,
    doctorSlug: r.doctor_slug || '',
    authorEmail: r.author_email || '',
    authorName: r.author_name || '',
    authorRole: r.author_role || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    finalizedAt: r.finalized_at || null,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listNotes(opts: { patientId: number; appointmentId?: string }): Promise<VisitNote[]> {
  await ensureVisitNotesSchema();
  const params: (string | number)[] = [opts.patientId];
  let extra = '';
  if (opts.appointmentId) {
    extra = 'AND appointment_id = ?';
    params.push(opts.appointmentId);
  }
  const [rows] = await getPool().execute<NoteRow[]>(
    `SELECT * FROM visit_notes
     WHERE patient_id = ? AND deleted_at IS NULL ${extra}
     ORDER BY visit_date DESC, created_at DESC
     LIMIT 300`,
    params
  );
  return rows.map(mapRow);
}

export async function getNoteById(id: string): Promise<VisitNote | null> {
  await ensureVisitNotesSchema();
  const [rows] = await getPool().execute<NoteRow[]>(
    `SELECT * FROM visit_notes WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Amendment history (who / when / why) for a set of notes, grouped by note id. */
export async function listAmendments(noteIds: string[]): Promise<Record<string, NoteAmendment[]>> {
  const out: Record<string, NoteAmendment[]> = {};
  if (noteIds.length === 0) return out;
  await ensureVisitNotesSchema();
  const [rows] = await getPool().query<AmendmentRow[]>(
    `SELECT id, note_id, revision, reason, amended_by_name, created_at
     FROM visit_note_amendments WHERE note_id IN (?) ORDER BY revision ASC`,
    [noteIds]
  );
  for (const r of rows) {
    (out[r.note_id] ||= []).push({
      id: r.id,
      noteId: r.note_id,
      revision: r.revision,
      reason: r.reason,
      amendedByName: r.amended_by_name || '',
      createdAt: r.created_at,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function snapshotForAudit(n: VisitNote) {
  return { status: n.status, revision: n.revision, templateKey: n.templateKey, answers: n.answers };
}

/** Creates a note as a draft, or straight as final when `finalize` is true. */
export async function createNote(opts: {
  patientId: number;
  appointmentId: string | null;
  visitDate: string;
  templateKey: string;
  answers: unknown;
  finalize: boolean;
  doctorSlug: string;
  actor: Actor;
}): Promise<Failure | { note: VisitNote }> {
  const template = findTemplate(opts.templateKey);
  if (!template) return { error: 'Choose a valid note template.', status: 400 };

  const answers = cleanAnswers(template, opts.answers);
  if (opts.finalize) {
    const missing = missingRequired(template, answers);
    if (missing.length) return { error: `Fill in before finalizing: ${missing.join(', ')}.`, status: 400 };
  } else if (!hasAnyAnswer(answers)) {
    return { error: 'Write something in the note before saving.', status: 400 };
  }

  await ensureVisitNotesSchema();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await getPool().execute(
    `INSERT INTO visit_notes
      (id, patient_id, appointment_id, visit_date, template_key, snapshot, answers, status, revision,
       doctor_slug, author_email, author_name, author_role, created_at, updated_at, finalized_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.patientId,
      opts.appointmentId,
      opts.visitDate,
      template.key,
      JSON.stringify(snapshotOf(template)),
      JSON.stringify(answers),
      opts.finalize ? 'final' : 'draft',
      opts.doctorSlug || null,
      opts.actor.email,
      opts.actor.name,
      opts.actor.role,
      now,
      now,
      opts.finalize ? now : null,
    ]
  );

  const note = (await getNoteById(id)) as VisitNote;
  await writeAudit({
    entity: 'visit_note',
    entityId: id,
    patientId: opts.patientId,
    action: 'create',
    actor: opts.actor,
    after: snapshotForAudit(note),
  });
  return { note };
}

/** Edits a DRAFT (optionally finalizing it). A final note can never be changed here. */
export async function updateDraft(opts: {
  existing: VisitNote;
  answers: unknown;
  finalize: boolean;
  actor: Actor;
}): Promise<Failure | { note: VisitNote }> {
  const { existing, actor } = opts;
  if (existing.status !== 'draft') {
    return { error: 'This note is already final. Use an amendment to change it.', status: 409 };
  }

  // A draft follows the CURRENT template; if the template was removed from code, keep its copy.
  const current = findTemplate(existing.templateKey);
  const template = current ?? existing.snapshot;
  const answers = cleanAnswers(template, opts.answers);

  if (opts.finalize) {
    const missing = missingRequired(template, answers);
    if (missing.length) return { error: `Fill in before finalizing: ${missing.join(', ')}.`, status: 400 };
  } else if (!hasAnyAnswer(answers)) {
    return { error: 'Write something in the note before saving.', status: 400 };
  }

  const now = new Date().toISOString();
  const [res] = await getPool().execute<ResultSetHeader>(
    `UPDATE visit_notes
     SET snapshot = ?, answers = ?, status = ?, updated_at = ?, finalized_at = ?
     WHERE id = ? AND status = 'draft' AND deleted_at IS NULL`,
    [
      JSON.stringify(current ? snapshotOf(current) : existing.snapshot),
      JSON.stringify(answers),
      opts.finalize ? 'final' : 'draft',
      now,
      opts.finalize ? now : null,
      existing.id,
    ]
  );
  if (res.affectedRows !== 1) {
    return { error: 'This note was changed or finalized elsewhere. Reload and try again.', status: 409 };
  }

  const note = (await getNoteById(existing.id)) as VisitNote;
  await writeAudit({
    entity: 'visit_note',
    entityId: existing.id,
    patientId: existing.patientId,
    action: 'update',
    actor,
    before: snapshotForAudit(existing),
    after: snapshotForAudit(note),
  });
  return { note };
}

/** Changes a FINAL note. Needs a reason; the old answers are kept in the amendment row and the audit log. */
export async function amendNote(opts: {
  existing: VisitNote;
  answers: unknown;
  reason: string;
  actor: Actor;
}): Promise<Failure | { note: VisitNote }> {
  const { existing, actor } = opts;
  if (existing.status !== 'final') {
    return { error: 'Only a final note needs an amendment. Edit the draft instead.', status: 400 };
  }

  const reason = String(opts.reason || '').trim();
  if (reason.length < 3) return { error: 'Write a short reason for the amendment.', status: 400 };
  if (reason.length > 500) return { error: 'The reason is too long (max 500 characters).', status: 400 };

  // An amendment is checked against the template the note was WRITTEN with.
  const answers = cleanAnswers(existing.snapshot, opts.answers);
  const missing = missingRequired(existing.snapshot, answers);
  if (missing.length) return { error: `These cannot be left empty: ${missing.join(', ')}.`, status: 400 };
  if (sameAnswers(existing.snapshot, answers, existing.answers)) {
    return { error: 'No changes to save.', status: 400 };
  }

  await ensureVisitNotesSchema();
  const now = new Date().toISOString();
  const nextRevision = existing.revision + 1;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [res] = await conn.execute<ResultSetHeader>(
      `UPDATE visit_notes SET answers = ?, revision = ?, updated_at = ?
       WHERE id = ? AND status = 'final' AND revision = ? AND deleted_at IS NULL`,
      [JSON.stringify(answers), nextRevision, now, existing.id, existing.revision]
    );
    if (res.affectedRows !== 1) {
      await conn.rollback();
      return { error: 'This note was changed by someone else. Reload and try again.', status: 409 };
    }
    await conn.execute(
      `INSERT INTO visit_note_amendments
        (note_id, revision, reason, answers_before, answers_after, amended_by_email, amended_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        existing.id,
        nextRevision,
        reason,
        JSON.stringify(existing.answers),
        JSON.stringify(answers),
        actor.email,
        actor.name,
        now,
      ]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }

  const note = (await getNoteById(existing.id)) as VisitNote;
  await writeAudit({
    entity: 'visit_note',
    entityId: existing.id,
    patientId: existing.patientId,
    action: 'update',
    actor,
    before: { ...snapshotForAudit(existing), reason },
    after: snapshotForAudit(note),
  });
  return { note };
}

/** Soft-deletes a DRAFT. Final notes are never deleted. */
export async function softDeleteDraft(existing: VisitNote, actor: Actor): Promise<Failure | { ok: true }> {
  if (existing.status !== 'draft') {
    return { error: 'A final note cannot be deleted. Use an amendment instead.', status: 409 };
  }
  const [res] = await getPool().execute<ResultSetHeader>(
    `UPDATE visit_notes SET deleted_at = ? WHERE id = ? AND status = 'draft' AND deleted_at IS NULL`,
    [new Date().toISOString(), existing.id]
  );
  if (res.affectedRows !== 1) {
    return { error: 'This note was changed or finalized elsewhere. Reload and try again.', status: 409 };
  }
  await writeAudit({
    entity: 'visit_note',
    entityId: existing.id,
    patientId: existing.patientId,
    action: 'delete',
    actor,
    before: snapshotForAudit(existing),
  });
  return { ok: true };
}
