import type { RowDataPacket } from 'mysql2/promise';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getPool } from './db';
import { ensureVitalsSchema, writeAudit, type Actor } from './vitals';
import {
  type PathologyStatus,
  isPathologyOverdue,
  getSuggestedExpectedDate,
  getTodayKolkata,
} from './pathologyConstants';

declare global {
  // eslint-disable-next-line no-var
  var __pathologySchemaPromise: Promise<void> | undefined;
}

export interface PathologySample {
  id: string;
  patientId: number;
  patientName?: string;
  patientPhone?: string;
  patientEmail?: string;
  patientAge?: number;
  appointmentId: string | null;
  doctorSlug: string | null;
  sampleType: string;
  site: string;
  collectedDate: string;
  labName: string;
  labReference: string;
  expectedDate: string;
  status: PathologyStatus;
  isOverdue: boolean;
  receivedDate: string | null;
  resultSummary: string;
  reportFile: string | null;
  reportOriginalName: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  patientInformed: boolean;
  patientInformedAt: string | null;
  notes: string;
  recordedBy: string;
  recordedByName: string;
  recordedByRole: string;
  createdAt: string;
  updatedAt: string;
}

interface PathologyRow extends RowDataPacket {
  id: string;
  patient_id: number;
  patient_name?: string | null;
  patient_phone?: string | null;
  patient_email?: string | null;
  patient_age?: number | null;
  appointment_id: string | null;
  doctor_slug: string | null;
  sample_type: string;
  site: string | null;
  collected_date: string;
  lab_name: string;
  lab_reference: string | null;
  expected_date: string;
  status: string;
  received_date: string | null;
  result_summary: string | null;
  report_file: string | null;
  report_original_name: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  patient_informed: number;
  patient_informed_at: string | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_by_name: string | null;
  recorded_by_role: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function getPathologyUploadDir(): string {
  const dir = process.env.PATHOLOGY_UPLOAD_DIR || path.join(process.cwd(), 'uploads', 'pathology');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function ensurePathologySchema(): Promise<void> {
  if (!global.__pathologySchemaPromise) {
    global.__pathologySchemaPromise = (async () => {
      await ensureVitalsSchema(); // Ensures patients & emr_audit_log exist
      const pool = getPool();

      await pool.execute(`
        CREATE TABLE IF NOT EXISTS pathology_samples (
          id VARCHAR(64) PRIMARY KEY,
          patient_id INT NOT NULL,
          appointment_id VARCHAR(64) NULL,
          doctor_slug VARCHAR(64) NULL,
          sample_type VARCHAR(128) NOT NULL,
          site VARCHAR(128) NULL,
          collected_date VARCHAR(16) NOT NULL,
          lab_name VARCHAR(128) NOT NULL,
          lab_reference VARCHAR(128) NULL,
          expected_date VARCHAR(16) NOT NULL,
          status VARCHAR(32) NOT NULL DEFAULT 'sent',
          received_date VARCHAR(16) NULL,
          result_summary LONGTEXT NULL,
          report_file VARCHAR(255) NULL,
          report_original_name VARCHAR(255) NULL,
          reviewed_by VARCHAR(255) NULL,
          reviewed_by_name VARCHAR(255) NULL,
          reviewed_at VARCHAR(64) NULL,
          patient_informed TINYINT(1) NOT NULL DEFAULT 0,
          patient_informed_at VARCHAR(64) NULL,
          notes TEXT NULL,
          recorded_by VARCHAR(255) NULL,
          recorded_by_name VARCHAR(255) NULL,
          recorded_by_role VARCHAR(32) NULL,
          created_at VARCHAR(64) NOT NULL,
          updated_at VARCHAR(64) NOT NULL,
          deleted_at VARCHAR(64) NULL,
          INDEX idx_pathology_patient (patient_id, collected_date),
          INDEX idx_pathology_status (status, expected_date),
          INDEX idx_pathology_appt (appointment_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
    })().catch((err) => {
      global.__pathologySchemaPromise = undefined;
      throw err;
    });
  }
  return global.__pathologySchemaPromise;
}

function mapRow(r: PathologyRow): PathologySample {
  const status = (r.status as PathologyStatus) || 'sent';
  const expectedDate = r.expected_date || '';
  return {
    id: r.id,
    patientId: Number(r.patient_id),
    patientName: r.patient_name || undefined,
    patientPhone: r.patient_phone || undefined,
    patientEmail: r.patient_email || undefined,
    patientAge: r.patient_age !== null && r.patient_age !== undefined ? Number(r.patient_age) : undefined,
    appointmentId: r.appointment_id || null,
    doctorSlug: r.doctor_slug || null,
    sampleType: r.sample_type,
    site: r.site || '',
    collectedDate: r.collected_date,
    labName: r.lab_name,
    labReference: r.lab_reference || '',
    expectedDate,
    status,
    isOverdue: isPathologyOverdue(status, expectedDate),
    receivedDate: r.received_date || null,
    resultSummary: r.result_summary || '',
    reportFile: r.report_file || null,
    reportOriginalName: r.report_original_name || null,
    reviewedBy: r.reviewed_by || null,
    reviewedByName: r.reviewed_by_name || null,
    reviewedAt: r.reviewed_at || null,
    patientInformed: Boolean(r.patient_informed),
    patientInformedAt: r.patient_informed_at || null,
    notes: r.notes || '',
    recordedBy: r.recorded_by || '',
    recordedByName: r.recorded_by_name || '',
    recordedByRole: r.recorded_by_role || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface ListPathologyOptions {
  patientId?: number;
  appointmentId?: string;
  status?: string;
  overdueOnly?: boolean;
  search?: string;
  limit?: number;
}

export async function listPathologySamples(opts: ListPathologyOptions = {}): Promise<PathologySample[]> {
  await ensurePathologySchema();
  const pool = getPool();

  const conditions: string[] = ['s.deleted_at IS NULL'];
  const params: (string | number)[] = [];

  if (opts.patientId) {
    conditions.push('s.patient_id = ?');
    params.push(opts.patientId);
  }
  if (opts.appointmentId) {
    conditions.push('s.appointment_id = ?');
    params.push(opts.appointmentId);
  }
  if (opts.status && opts.status !== 'all') {
    conditions.push('s.status = ?');
    params.push(opts.status);
  }
  if (opts.overdueOnly) {
    const today = getTodayKolkata();
    conditions.push("s.status = 'sent' AND s.expected_date < ?");
    params.push(today);
  }

  const query = `
    SELECT
      s.*,
      p.full_name AS patient_name,
      p.phone AS patient_phone,
      p.email AS patient_email,
      p.age AS patient_age
    FROM pathology_samples s
    LEFT JOIN patients p ON s.patient_id = p.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY s.collected_date DESC, s.created_at DESC
    ${opts.limit ? `LIMIT ${Number(opts.limit)}` : ''}
  `;

  const [rows] = await pool.execute<PathologyRow[]>(query, params);
  let list = rows.map(mapRow);

  if (opts.search) {
    const q = opts.search.toLowerCase().trim();
    list = list.filter((item) => {
      return (
        item.sampleType.toLowerCase().includes(q) ||
        item.site.toLowerCase().includes(q) ||
        item.labName.toLowerCase().includes(q) ||
        item.labReference.toLowerCase().includes(q) ||
        (item.patientName && item.patientName.toLowerCase().includes(q)) ||
        (item.patientPhone && item.patientPhone.includes(q)) ||
        (item.resultSummary && item.resultSummary.toLowerCase().includes(q))
      );
    });
  }

  return list;
}

export async function getPathologySampleById(id: string): Promise<PathologySample | null> {
  await ensurePathologySchema();
  const pool = getPool();

  const [rows] = await pool.execute<PathologyRow[]>(
    `SELECT
      s.*,
      p.full_name AS patient_name,
      p.phone AS patient_phone,
      p.email AS patient_email,
      p.age AS patient_age
    FROM pathology_samples s
    LEFT JOIN patients p ON s.patient_id = p.id
    WHERE s.id = ? AND s.deleted_at IS NULL
    LIMIT 1`,
    [id]
  );

  return rows[0] ? mapRow(rows[0]) : null;
}

export interface CreatePathologyInput {
  patientId: number;
  appointmentId?: string | null;
  doctorSlug?: string | null;
  sampleType: string;
  site?: string;
  collectedDate?: string;
  labName: string;
  labReference?: string;
  expectedDate?: string;
  notes?: string;
}

export async function createPathologySample(opts: {
  input: CreatePathologyInput;
  actor: Actor;
}): Promise<PathologySample> {
  await ensurePathologySchema();
  const { input, actor } = opts;
  const pool = getPool();

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const collectedDate = input.collectedDate || getTodayKolkata();
  const expectedDate =
    input.expectedDate || getSuggestedExpectedDate(input.labName, collectedDate);

  await pool.execute(
    `INSERT INTO pathology_samples
      (id, patient_id, appointment_id, doctor_slug, sample_type, site,
       collected_date, lab_name, lab_reference, expected_date, status,
       notes, recorded_by, recorded_by_name, recorded_by_role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.patientId,
      input.appointmentId || null,
      input.doctorSlug || null,
      input.sampleType.trim(),
      (input.site || '').trim() || null,
      collectedDate,
      input.labName.trim(),
      (input.labReference || '').trim() || null,
      expectedDate,
      (input.notes || '').trim() || null,
      actor.email,
      actor.name,
      actor.role,
      now,
      now,
    ]
  );

  const created = (await getPathologySampleById(id)) as PathologySample;
  await writeAudit({
    entity: 'pathology',
    entityId: id,
    patientId: input.patientId,
    action: 'create',
    actor,
    after: created,
  });

  return created;
}

export interface UpdatePathologyInput {
  sampleType?: string;
  site?: string;
  collectedDate?: string;
  labName?: string;
  labReference?: string;
  expectedDate?: string;
  status?: PathologyStatus;
  receivedDate?: string | null;
  resultSummary?: string;
  reportFile?: string | null;
  reportOriginalName?: string | null;
  reviewedBy?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  patientInformed?: boolean;
  patientInformedAt?: string | null;
  notes?: string;
}

export async function updatePathologySample(opts: {
  existing: PathologySample;
  input: UpdatePathologyInput;
  actor: Actor;
}): Promise<PathologySample> {
  await ensurePathologySchema();
  const { existing, input, actor } = opts;
  const pool = getPool();

  const sampleType = input.sampleType !== undefined ? input.sampleType.trim() : existing.sampleType;
  const site = input.site !== undefined ? input.site.trim() || null : existing.site || null;
  const collectedDate = input.collectedDate !== undefined ? input.collectedDate : existing.collectedDate;
  const labName = input.labName !== undefined ? input.labName.trim() : existing.labName;
  const labReference = input.labReference !== undefined ? input.labReference.trim() || null : existing.labReference || null;
  const expectedDate = input.expectedDate !== undefined ? input.expectedDate : existing.expectedDate;
  const status = input.status !== undefined ? input.status : existing.status;
  const receivedDate = input.receivedDate !== undefined ? input.receivedDate : existing.receivedDate;
  const resultSummary = input.resultSummary !== undefined ? input.resultSummary : existing.resultSummary;
  const reportFile = input.reportFile !== undefined ? input.reportFile : existing.reportFile;
  const reportOriginalName = input.reportOriginalName !== undefined ? input.reportOriginalName : existing.reportOriginalName;

  // Review logic
  let reviewedBy = existing.reviewedBy;
  let reviewedByName = existing.reviewedByName;
  let reviewedAt = existing.reviewedAt;

  if (input.status === 'reviewed' && existing.status !== 'reviewed') {
    reviewedBy = actor.email;
    reviewedByName = actor.name;
    reviewedAt = new Date().toISOString();
  } else if (input.reviewedBy !== undefined) {
    reviewedBy = input.reviewedBy;
    reviewedByName = input.reviewedByName || null;
    reviewedAt = input.reviewedAt || null;
  }

  // Patient informed logic
  let patientInformed = existing.patientInformed;
  let patientInformedAt = existing.patientInformedAt;
  if (input.patientInformed !== undefined) {
    patientInformed = input.patientInformed;
    if (patientInformed && !existing.patientInformed) {
      patientInformedAt = new Date().toISOString();
    } else if (!patientInformed) {
      patientInformedAt = null;
    }
  }

  const notes = input.notes !== undefined ? input.notes : existing.notes;
  const now = new Date().toISOString();

  await pool.execute(
    `UPDATE pathology_samples SET
      sample_type = ?,
      site = ?,
      collected_date = ?,
      lab_name = ?,
      lab_reference = ?,
      expected_date = ?,
      status = ?,
      received_date = ?,
      result_summary = ?,
      report_file = ?,
      report_original_name = ?,
      reviewed_by = ?,
      reviewed_by_name = ?,
      reviewed_at = ?,
      patient_informed = ?,
      patient_informed_at = ?,
      notes = ?,
      updated_at = ?
    WHERE id = ? AND deleted_at IS NULL`,
    [
      sampleType,
      site,
      collectedDate,
      labName,
      labReference,
      expectedDate,
      status,
      receivedDate,
      resultSummary || null,
      reportFile,
      reportOriginalName,
      reviewedBy,
      reviewedByName,
      reviewedAt,
      patientInformed ? 1 : 0,
      patientInformedAt,
      notes || null,
      now,
      existing.id,
    ]
  );

  const updated = (await getPathologySampleById(existing.id)) as PathologySample;
  await writeAudit({
    entity: 'pathology',
    entityId: existing.id,
    patientId: existing.patientId,
    action: 'update',
    actor,
    before: existing,
    after: updated,
  });

  return updated;
}

export async function softDeletePathologySample(existing: PathologySample, actor: Actor): Promise<void> {
  await ensurePathologySchema();
  const pool = getPool();
  const now = new Date().toISOString();

  await pool.execute(`UPDATE pathology_samples SET deleted_at = ? WHERE id = ?`, [now, existing.id]);
  await writeAudit({
    entity: 'pathology',
    entityId: existing.id,
    patientId: existing.patientId,
    action: 'delete',
    actor,
    before: existing,
  });
}

export interface PathologyStats {
  total: number;
  sent: number;
  received: number;
  reviewed: number;
  overdue: number;
}

export async function getPathologyOverviewStats(): Promise<PathologyStats> {
  await ensurePathologySchema();
  const pool = getPool();
  const today = getTodayKolkata();

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) AS received,
      SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed,
      SUM(CASE WHEN status = 'sent' AND expected_date < ? THEN 1 ELSE 0 END) AS overdue
    FROM pathology_samples
    WHERE deleted_at IS NULL`,
    [today]
  );

  const r = rows[0] || {};
  return {
    total: Number(r.total || 0),
    sent: Number(r.sent || 0),
    received: Number(r.received || 0),
    reviewed: Number(r.reviewed || 0),
    overdue: Number(r.overdue || 0),
  };
}
