'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import AllergyBanner from './AllergyBanner';
import {
  TEMPLATES,
  findTemplate,
  isAnswered,
  sameAnswers,
  valueText,
  type AnswerMap,
  type AnswerValue,
  type NoteField,
  type NoteTemplate,
} from '@/lib/visitNoteTemplates';

/**
 * Structured visit notes.
 *  - variant "editor" (prescription modal): pick a template, write a draft, finalize, amend.
 *  - variant "list"   (patient drawer, "Visit notes" tab): read-only history of the patient's
 *    notes with the vitals of each visit and an allergy banner.
 * Self-contained: one <style> block with vn-* classes, no other CSS needed.
 */

export interface VisitNotePanelProps {
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  userRole?: string;
  /** Pass the appointment in the prescription modal; the drawer passes email/phone instead. */
  appointmentId?: string;
  email?: string;
  phone?: string;
  variant?: 'editor' | 'list';
  /** Editor only: lets the doctor copy the note's diagnosis into the prescription. */
  onDiagnosis?: (text: string) => void;
}

interface Amendment {
  id: number;
  revision: number;
  reason: string;
  amendedByName: string;
  createdAt: string;
}

interface Note {
  id: string;
  appointmentId: string | null;
  visitDate: string;
  templateKey: string;
  snapshot: NoteTemplate;
  answers: AnswerMap;
  status: 'draft' | 'final';
  revision: number;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  amendments?: Amendment[];
}

interface VitalsBrief {
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
}

type View =
  | { kind: 'none' }
  | { kind: 'new'; templateKey: string; answers: AnswerMap }
  | { kind: 'note'; id: string; answers: AnswerMap; amending: boolean; reason: string };

type Busy = 'save' | 'final' | 'amend' | 'delete' | null;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function fmtDate(d: string): string {
  const p = new Date(`${d}T00:00:00`);
  return Number.isNaN(p.getTime()) ? d : p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtStamp(iso: string): string {
  const p = new Date(iso);
  return Number.isNaN(p.getTime())
    ? iso
    : p.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function vitalsText(v?: VitalsBrief): string {
  if (!v) return '';
  const parts: string[] = [];
  if (v.weightKg !== null && v.weightKg !== undefined) parts.push(`Weight ${v.weightKg} kg`);
  if (v.heightCm !== null && v.heightCm !== undefined) parts.push(`Height ${v.heightCm} cm`);
  if (v.bmi !== null && v.bmi !== undefined) parts.push(`BMI ${v.bmi}`);
  if (v.bpSystolic && v.bpDiastolic) parts.push(`BP ${v.bpSystolic}/${v.bpDiastolic}`);
  if (v.pulse) parts.push(`Pulse ${v.pulse}`);
  return parts.join(' · ');
}

function diagnosisOf(answers: AnswerMap): string {
  const d = answers.diagnosis;
  return typeof d === 'string' ? d.trim() : '';
}

// ---------------------------------------------------------------------------
// One field
// ---------------------------------------------------------------------------

function FieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: NoteField;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const label = (
    <label className="vn-label" htmlFor={id}>
      {field.label}
      {field.required ? <span className="vn-req"> *</span> : null}
    </label>
  );
  const groupLabel = (
    <div className="vn-label">
      {field.label}
      {field.required ? <span className="vn-req"> *</span> : null}
    </div>
  );

  switch (field.type) {
    case 'text':
      return (
        <div>
          {label}
          <input
            id={id}
            className="vn-input"
            type="text"
            maxLength={300}
            disabled={disabled}
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case 'textarea': {
      const text = typeof value === 'string' ? value : '';
      return (
        <div>
          {label}
          <textarea
            id={id}
            className="vn-input"
            rows={3}
            maxLength={4000}
            disabled={disabled}
            value={text}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.quickPhrases && field.quickPhrases.length > 0 && !disabled && (
            <div className="vn-chips vn-quick">
              {field.quickPhrases.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="vn-chip vn-chip-sm"
                  onClick={() => onChange(text.trim() ? `${text.replace(/\s+$/, '')} ${p}` : p)}
                >
                  + {p.replace(/\.$/, '')}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    }

    case 'select': {
      const options = field.options || [];
      const current = typeof value === 'string' ? value : '';
      if (options.length <= 5) {
        return (
          <div role="group" aria-label={field.label}>
            {groupLabel}
            <div className="vn-chips">
              {options.map((o) => (
                <button
                  key={o}
                  type="button"
                  disabled={disabled}
                  className={`vn-chip ${current === o ? 'on' : ''}`}
                  onClick={() => onChange(current === o ? '' : o)}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        );
      }
      return (
        <div>
          {label}
          <select id={id} className="vn-input" disabled={disabled} value={current} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      );
    }

    case 'multiselect': {
      const options = field.options || [];
      const current = Array.isArray(value) ? value : [];
      return (
        <div role="group" aria-label={field.label}>
          {groupLabel}
          <div className="vn-chips">
            {options.map((o) => {
              const on = current.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  disabled={disabled}
                  className={`vn-chip ${on ? 'on' : ''}`}
                  onClick={() => onChange(on ? current.filter((x) => x !== o) : [...current, o])}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    case 'scale': {
      const min = field.min ?? 0;
      const max = field.max ?? 10;
      const nums: number[] = [];
      for (let n = min; n <= max; n++) nums.push(n);
      const current = typeof value === 'number' ? value : null;
      return (
        <div role="group" aria-label={field.label}>
          {groupLabel}
          <div className="vn-scale">
            {nums.map((n) => (
              <button
                key={n}
                type="button"
                disabled={disabled}
                className={`vn-num ${current === n ? 'on' : ''}`}
                onClick={() => onChange(current === n ? null : n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      );
    }

    case 'checkbox':
      return (
        <label className="vn-check" htmlFor={id}>
          <input id={id} type="checkbox" disabled={disabled} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span>{field.label}</span>
        </label>
      );

    case 'date':
      return (
        <div>
          {label}
          <input
            id={id}
            className="vn-input"
            type="date"
            disabled={disabled}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Read-only note
// ---------------------------------------------------------------------------

function NoteBody({ template, answers }: { template: NoteTemplate; answers: AnswerMap }) {
  const sections = template.sections
    .map((s) => ({
      ...s,
      rows: s.fields
        .map((f) => ({ f, text: valueText(f, answers[f.key]) }))
        .filter((r) => r.text !== ''),
    }))
    .filter((s) => s.rows.length > 0);

  if (sections.length === 0) return <p className="vn-muted">This note is empty.</p>;

  return (
    <div className="vn-read">
      {sections.map((s) => (
        <div key={s.key} className="vn-read-sec">
          <div className="vn-sec-title">{s.title}</div>
          {s.rows.map(({ f, text }) => (
            <div key={f.key} className="vn-read-row">
              <span className="vn-read-label">{f.label}</span>
              <span className="vn-read-value">{text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AmendmentList({ items }: { items: Amendment[] }) {
  if (items.length === 0) return null;
  return (
    <div className="vn-amends">
      <div className="vn-sec-title">Amendments</div>
      {items.map((a) => (
        <div key={a.id} className="vn-amend">
          <strong>Revision {a.revision}</strong> · {fmtStamp(a.createdAt)}
          {a.amendedByName ? ` · ${a.amendedByName}` : ''}
          <div className="vn-muted">Reason: {a.reason}</div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ note }: { note: Pick<Note, 'status' | 'revision'> }) {
  if (note.status === 'draft') return <span className="vn-badge draft">Draft</span>;
  return <span className="vn-badge final">Final{note.revision > 0 ? ` · amended ${note.revision}×` : ''}</span>;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function VisitNotePanel({
  adminFetch,
  appointmentId,
  email,
  phone,
  variant = 'editor',
  onDiagnosis,
}: VisitNotePanelProps) {
  const isEditor = variant === 'editor';

  // adminFetch is usually re-created on every parent render; keep it in a ref so effects stay stable.
  const fetchRef = useRef(adminFetch);
  fetchRef.current = adminFetch;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [vitals, setVitals] = useState<Record<string, VitalsBrief>>({});
  const [canWrite, setCanWrite] = useState(false);
  const [view, setView] = useState<View>({ kind: 'none' });
  const [busy, setBusy] = useState<Busy>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (appointmentId) q.set('appointmentId', appointmentId);
    if (email) q.set('email', email);
    if (phone) q.set('phone', phone);
    return q.toString();
  }, [appointmentId, email, phone]);

  const viewFor = (n: Note): View => ({ kind: 'note', id: n.id, answers: { ...n.answers }, amending: false, reason: '' });

  const fetchNotes = useCallback(async (): Promise<Note[] | null> => {
    try {
      const res = await fetchRef.current(`/api/admin/visit-notes?${query}&_t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || 'Could not load visit notes.');
        setNotes([]);
        return null;
      }
      const list: Note[] = Array.isArray(data.notes) ? data.notes : [];
      setLoadError('');
      setNotes(list);
      setVitals(data.vitals || {});
      setCanWrite(Boolean(data.canWrite));
      return list;
    } catch {
      setLoadError('Network error while loading visit notes.');
      return null;
    }
  }, [query]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchNotes().then((list) => {
      if (!alive) return;
      setLoading(false);
      if (list && list.length > 0) {
        if (isEditor) setView(viewFor(list[0]));
        else setOpen({ [list[0].id]: true });
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchNotes, isEditor]);

  // ---- what is on screen now ----
  const current: Note | null = view.kind === 'note' ? notes.find((n) => n.id === view.id) ?? null : null;
  const template: NoteTemplate | null =
    view.kind === 'new'
      ? findTemplate(view.templateKey) ?? null
      : current
        ? current.status === 'draft'
          ? findTemplate(current.templateKey) ?? current.snapshot
          : current.snapshot
        : null;

  const editable =
    canWrite &&
    (view.kind === 'new' ||
      (view.kind === 'note' && !!current && current.canEdit && (current.status === 'draft' || view.amending)));

  const dirty = useMemo(() => {
    if (view.kind === 'new') return Object.values(view.answers).some((v) => isAnswered(v));
    if (view.kind === 'note' && current && template && editable) {
      return !sameAnswers(template, view.answers, current.answers);
    }
    return false;
  }, [view, current, template, editable]);

  const guard = (go: () => void) => {
    if (dirty && !window.confirm('You have unsaved changes in this note. Leave without saving?')) return;
    go();
  };

  const setAnswer = (key: string, value: AnswerValue) =>
    setView((v) => (v.kind === 'none' ? v : { ...v, answers: { ...v.answers, [key]: value } }));

  // ---- actions ----
  const submit = async (mode: 'draft' | 'final' | 'amend') => {
    if (view.kind === 'none' || !template || busy) return;
    if (view.kind === 'note' && mode === 'amend' && view.reason.trim().length < 3) {
      toast.error('Write a short reason for the amendment.', 'Reason needed');
      return;
    }
    if (
      mode === 'final' &&
      !window.confirm(
        'Finalize this note? After this it cannot be edited directly. Any change will be recorded as an amendment with a reason.'
      )
    ) {
      return;
    }

    setBusy(mode === 'draft' ? 'save' : mode === 'final' ? 'final' : 'amend');
    try {
      const res =
        view.kind === 'new'
          ? await adminFetch('/api/admin/visit-notes', {
              method: 'POST',
              headers: JSON_HEADERS,
              body: JSON.stringify({
                appointmentId,
                templateKey: view.templateKey,
                answers: view.answers,
                finalize: mode === 'final',
              }),
            })
          : await adminFetch('/api/admin/visit-notes', {
              method: 'PATCH',
              headers: JSON_HEADERS,
              body: JSON.stringify({
                id: view.id,
                answers: view.answers,
                finalize: mode === 'final',
                amendReason: mode === 'amend' ? view.reason : undefined,
                expectedUpdatedAt: current?.updatedAt,
              }),
            });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not save the note.', 'Save Failed');
        return;
      }
      const saved = data.note as Note;
      toast.success(
        mode === 'final' ? 'Note finalized.' : mode === 'amend' ? 'Amendment saved.' : 'Draft saved.',
        'Visit note'
      );
      const list = await fetchNotes();
      setView(viewFor(list?.find((n) => n.id === saved.id) ?? saved));
    } catch {
      toast.error('Network error while saving the note.', 'Save Failed');
    } finally {
      setBusy(null);
    }
  };

  const deleteDraft = async () => {
    if (view.kind !== 'note' || busy) return;
    if (!window.confirm('Delete this draft note? This cannot be undone.')) return;
    setBusy('delete');
    try {
      const res = await adminFetch(`/api/admin/visit-notes?id=${encodeURIComponent(view.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not delete the draft.', 'Delete Failed');
        return;
      }
      toast.success('Draft deleted.', 'Visit note');
      const list = await fetchNotes();
      setView(list && list.length > 0 ? viewFor(list[0]) : { kind: 'none' });
    } catch {
      toast.error('Network error while deleting the draft.', 'Delete Failed');
    } finally {
      setBusy(null);
    }
  };

  const useDiagnosis = (answers: AnswerMap) => {
    const text = diagnosisOf(answers)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(', ');
    if (text && onDiagnosis) {
      onDiagnosis(text);
      toast.success('Diagnosis copied into the prescription.', 'Visit note');
    }
  };

  // ---------------------------------------------------------------------------
  // Render: patient drawer (read-only list)
  // ---------------------------------------------------------------------------
  if (!isEditor) {
    return (
      <div className="vn-wrap">
        <style>{CSS}</style>
        <AllergyBanner adminFetch={adminFetch} email={email} phone={phone} />

        {loading ? (
          <p className="vn-muted">Loading visit notes…</p>
        ) : loadError ? (
          <p className="vn-err">{loadError}</p>
        ) : notes.length === 0 ? (
          <div className="vn-card">
            <p className="vn-muted" style={{ margin: 0 }}>
              No visit notes yet. A doctor writes notes from the prescription window of a visit.
            </p>
          </div>
        ) : (
          notes.map((n) => {
            const isOpen = Boolean(open[n.id]);
            const vt = n.appointmentId ? vitalsText(vitals[n.appointmentId]) : '';
            const diag = diagnosisOf(n.answers);
            return (
              <div key={n.id} className="vn-card">
                <button
                  type="button"
                  className="vn-card-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((o) => ({ ...o, [n.id]: !o[n.id] }))}
                >
                  <span>
                    <strong>{fmtDate(n.visitDate)}</strong> · {n.snapshot.label || n.templateKey}
                    <span className="vn-muted"> · {n.authorName || 'Doctor'}</span>
                  </span>
                  <span className="vn-head-right">
                    <StatusBadge note={n} />
                    <span className="vn-caret">{isOpen ? '▲' : '▼'}</span>
                  </span>
                </button>
                {!isOpen && diag && <div className="vn-preview">{diag.split('\n')[0]}</div>}
                {isOpen && (
                  <div className="vn-card-body">
                    {vt && <div className="vn-vitals">{vt}</div>}
                    <NoteBody template={n.snapshot} answers={n.answers} />
                    <AmendmentList items={n.amendments || []} />
                  </div>
                )}
              </div>
            );
          })
        )}
        <p className="vn-hint">To write or amend a note, open the prescription of that visit.</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: editor (prescription modal)
  // ---------------------------------------------------------------------------
  return (
    <section className="vn-wrap vn-card" aria-label="Visit note">
      <style>{CSS}</style>
      <div className="vn-head">
        <h4 className="vn-title">Visit note</h4>
        <span className="vn-tag">Doctor only</span>
      </div>

      {loading ? (
        <p className="vn-muted">Loading visit note…</p>
      ) : loadError ? (
        <p className="vn-err">{loadError}</p>
      ) : (
        <>
          {(notes.length > 0 || canWrite) && (
            <div className="vn-chips" role="tablist" aria-label="Notes for this visit">
              {notes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="tab"
                  aria-selected={view.kind === 'note' && view.id === n.id}
                  className={`vn-chip ${view.kind === 'note' && view.id === n.id ? 'on' : ''}`}
                  onClick={() => guard(() => setView(viewFor(n)))}
                >
                  {n.snapshot.label || n.templateKey} · {n.status === 'final' ? 'Final' : 'Draft'}
                </button>
              ))}
              {canWrite && (
                <button
                  type="button"
                  className={`vn-chip vn-chip-add ${view.kind === 'none' || view.kind === 'new' ? 'on' : ''}`}
                  onClick={() => guard(() => setView({ kind: 'none' }))}
                >
                  + New note
                </button>
              )}
            </div>
          )}

          {view.kind === 'none' &&
            (canWrite ? (
              <div>
                <div className="vn-hint">Choose a template to start the note for this visit.</div>
                <div className="vn-picker">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className="vn-pick"
                      onClick={() => setView({ kind: 'new', templateKey: t.key, answers: {} })}
                    >
                      <strong>{t.label}</strong>
                      <span>{t.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="vn-muted">No visit note has been written for this visit.</p>
            ))}

          {view.kind !== 'none' && template && (
            <div className="vn-form">
              <div className="vn-meta">
                <strong>{template.label}</strong>
                {current ? (
                  <>
                    <StatusBadge note={current} />
                    <span className="vn-muted">
                      by {current.authorName || 'Doctor'} · {fmtStamp(current.updatedAt)}
                    </span>
                  </>
                ) : (
                  <span className="vn-badge draft">New · not saved yet</span>
                )}
              </div>

              {editable ? (
                <>
                  {view.kind === 'note' && view.amending && (
                    <div className="vn-warn">
                      You are amending a final note. The earlier version is kept in the record, together with your reason.
                    </div>
                  )}

                  {template.sections.map((s) => (
                    <div key={s.key} className="vn-section">
                      <div className="vn-sec-title">{s.title}</div>
                      {s.hint && <div className="vn-hint">{s.hint}</div>}
                      <div className="vn-grid">
                        {s.fields.map((f) => (
                          <div key={f.key} className={f.half ? '' : 'vn-full'}>
                            <FieldInput
                              field={f}
                              value={view.answers[f.key]}
                              onChange={(v) => setAnswer(f.key, v)}
                              disabled={busy !== null}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {view.kind === 'note' && view.amending && (
                    <div className="vn-section">
                      <label className="vn-label" htmlFor="vn-amend-reason">
                        Reason for the amendment <span className="vn-req">*</span>
                      </label>
                      <input
                        id="vn-amend-reason"
                        className="vn-input"
                        type="text"
                        maxLength={500}
                        value={view.reason}
                        placeholder="e.g. Corrected the diagnosis after the report"
                        onChange={(e) => setView({ ...view, reason: e.target.value })}
                      />
                    </div>
                  )}

                  <div className="vn-actions">
                    {view.kind === 'note' && view.amending ? (
                      <>
                        <button type="button" className="vn-btn primary" disabled={busy !== null || !dirty} onClick={() => submit('amend')}>
                          {busy === 'amend' ? 'Saving…' : 'Save amendment'}
                        </button>
                        <button
                          type="button"
                          className="vn-btn"
                          disabled={busy !== null}
                          onClick={() => guard(() => current && setView(viewFor(current)))}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="vn-btn" disabled={busy !== null || !dirty} onClick={() => submit('draft')}>
                          {busy === 'save' ? 'Saving…' : 'Save draft'}
                        </button>
                        <button type="button" className="vn-btn primary" disabled={busy !== null} onClick={() => submit('final')}>
                          {busy === 'final' ? 'Finalizing…' : 'Finalize note'}
                        </button>
                        {view.kind === 'note' && current?.canDelete && (
                          <button type="button" className="vn-btn danger" disabled={busy !== null} onClick={deleteDraft}>
                            {busy === 'delete' ? 'Deleting…' : 'Delete draft'}
                          </button>
                        )}
                      </>
                    )}
                    {onDiagnosis && diagnosisOf(view.answers) && (
                      <button type="button" className="vn-btn" disabled={busy !== null} onClick={() => useDiagnosis(view.answers)}>
                        Use diagnosis in prescription
                      </button>
                    )}
                    {dirty && <span className="vn-unsaved">Unsaved changes</span>}
                  </div>
                </>
              ) : (
                current && (
                  <>
                    <NoteBody template={template} answers={current.answers} />
                    <AmendmentList items={current.amendments || []} />
                    <div className="vn-actions">
                      {canWrite && current.canEdit && current.status === 'final' && view.kind === 'note' && (
                        <button type="button" className="vn-btn" onClick={() => setView({ ...view, amending: true })}>
                          Amend note
                        </button>
                      )}
                      {onDiagnosis && diagnosisOf(current.answers) && canWrite && (
                        <button type="button" className="vn-btn" onClick={() => useDiagnosis(current.answers)}>
                          Use diagnosis in prescription
                        </button>
                      )}
                      {current.status === 'final' && !current.canEdit && (
                        <span className="vn-muted">Only {current.authorName || 'the author'} can amend this note.</span>
                      )}
                    </div>
                  </>
                )
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = `
.vn-wrap { display: flex; flex-direction: column; gap: 12px; }
.vn-card { border: 1px solid #E2E8F0; border-radius: 14px; background: #fff; padding: 14px 16px; }
.vn-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.vn-title { margin: 0; font-size: 15px; font-weight: 800; color: #0F172A; }
.vn-tag { font-size: 11px; font-weight: 700; color: #64748B; background: #F1F5F9; border-radius: 999px; padding: 3px 10px; }
.vn-muted { color: #64748B; font-size: 13px; }
.vn-err { color: #B91C1C; font-size: 13px; font-weight: 600; margin: 0; }
.vn-hint { color: #64748B; font-size: 12.5px; margin: 2px 0 8px; }
.vn-req { color: #B91C1C; }
.vn-warn { background: #FFFBEB; border: 1px solid #FDE68A; color: #92400E; border-radius: 10px; padding: 8px 12px; font-size: 13px; }
.vn-unsaved { color: #B45309; font-size: 12.5px; font-weight: 700; }

.vn-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.vn-chip { padding: 6px 12px; border-radius: 999px; border: 1.5px solid #E2E8F0; background: #fff; color: #44476A; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; }
.vn-chip:hover:not(:disabled) { border-color: var(--primary, #565ACF); color: var(--primary, #565ACF); }
.vn-chip.on { background: var(--primary, #565ACF); border-color: var(--primary, #565ACF); color: #fff; }
.vn-chip:disabled { opacity: .6; cursor: not-allowed; }
.vn-chip-sm { padding: 3px 9px; font-size: 12px; font-weight: 600; }
.vn-chip-add { border-style: dashed; }
.vn-quick { margin-top: 6px; }

.vn-picker { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.vn-pick { display: flex; flex-direction: column; gap: 3px; text-align: left; border: 1.5px solid #E2E8F0; background: #F8FAFC; border-radius: 12px; padding: 10px 12px; cursor: pointer; font-family: inherit; color: #0F172A; }
.vn-pick span { font-size: 12.5px; color: #64748B; }
.vn-pick:hover { border-color: var(--primary, #565ACF); background: var(--primary-light, #EEF0FF); }

.vn-form { display: flex; flex-direction: column; gap: 12px; }
.vn-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 13.5px; color: #0F172A; }
.vn-section { border-top: 1px solid #EEF2F6; padding-top: 10px; }
.vn-sec-title { font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: #475569; margin-bottom: 6px; }
.vn-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.vn-full { grid-column: 1 / -1; }
.vn-label { display: block; font-size: 12.5px; font-weight: 700; color: #334155; margin-bottom: 5px; }
.vn-input { width: 100%; box-sizing: border-box; border: 1.5px solid #E2E8F0; border-radius: 10px; padding: 8px 10px; font-size: 14px; font-family: inherit; color: #0F172A; background: #fff; }
.vn-input:focus { outline: none; border-color: var(--primary, #565ACF); }
.vn-input:disabled { background: #F8FAFC; }
textarea.vn-input { resize: vertical; min-height: 70px; }
.vn-check { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; color: #334155; padding-top: 22px; }
.vn-scale { display: flex; flex-wrap: wrap; gap: 4px; }
.vn-num { width: 34px; height: 34px; border-radius: 8px; border: 1.5px solid #E2E8F0; background: #fff; font-weight: 700; font-size: 13px; cursor: pointer; font-family: inherit; color: #44476A; }
.vn-num.on { background: var(--primary, #565ACF); border-color: var(--primary, #565ACF); color: #fff; }

.vn-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; border-top: 1px solid #EEF2F6; padding-top: 12px; }
.vn-btn { padding: 8px 14px; border-radius: 10px; border: 1.5px solid #E2E8F0; background: #fff; color: #334155; font-weight: 700; font-size: 13px; cursor: pointer; font-family: inherit; }
.vn-btn:hover:not(:disabled) { border-color: var(--primary, #565ACF); color: var(--primary, #565ACF); }
.vn-btn.primary { background: var(--primary, #565ACF); border-color: var(--primary, #565ACF); color: #fff; }
.vn-btn.primary:hover:not(:disabled) { color: #fff; opacity: .92; }
.vn-btn.danger { color: #B91C1C; border-color: #FECACA; background: #FEF2F2; }
.vn-btn:disabled { opacity: .55; cursor: not-allowed; }

.vn-badge { font-size: 11px; font-weight: 800; border-radius: 999px; padding: 3px 9px; }
.vn-badge.draft { background: #FFFBEB; color: #92400E; border: 1px solid #FDE68A; }
.vn-badge.final { background: #F0FDF4; color: #166534; border: 1px solid #BBF7D0; }

.vn-read { display: flex; flex-direction: column; gap: 10px; }
.vn-read-sec { border-top: 1px solid #EEF2F6; padding-top: 8px; }
.vn-read-row { display: grid; grid-template-columns: 160px 1fr; gap: 10px; padding: 3px 0; font-size: 13.5px; }
.vn-read-label { color: #64748B; font-weight: 600; }
.vn-read-value { color: #0F172A; white-space: pre-wrap; word-break: break-word; }
.vn-amends { border-top: 1px solid #EEF2F6; padding-top: 8px; }
.vn-amend { font-size: 13px; color: #334155; padding: 3px 0; }

.vn-card-head { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; background: none; border: none; padding: 0; cursor: pointer; text-align: left; font-family: inherit; font-size: 14px; color: #0F172A; }
.vn-head-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.vn-caret { font-size: 10px; color: #94A3B8; }
.vn-preview { margin-top: 6px; font-size: 13px; color: #475569; }
.vn-card-body { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.vn-vitals { background: #F5F6FF; border: 1px solid #DDE1F8; border-radius: 10px; padding: 7px 12px; font-size: 13px; color: #44476A; font-weight: 600; }

@media (max-width: 560px) {
  .vn-grid, .vn-picker { grid-template-columns: 1fr; }
  .vn-read-row { grid-template-columns: 1fr; gap: 0; }
}
`;
