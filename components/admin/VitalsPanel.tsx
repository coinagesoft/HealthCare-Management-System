'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/Toast';

/**
 * Vitals for one patient: record, correct, list and trend graphs.
 *  - variant "full":  form + history table + 4 trend graphs (Patient Record / history drawer)
 *  - variant "strip": compact latest-vitals bar with a quick-record form (prescription modal)
 * Self-contained: inline styles only, no chart library, no CSS file changes needed.
 */

export interface VitalsPanelProps {
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  userRole?: string;
  /** Pass the appointment when you have one (prescription modal); otherwise email/phone identify the patient. */
  appointmentId?: string;
  email?: string;
  phone?: string;
  variant?: 'full' | 'strip';
  /** Called after any save/edit/delete so a parent can refresh. */
  onChanged?: () => void;
}

interface Entry {
  id: string;
  appointmentId: string | null;
  visitDate: string;
  recordedAt: string;
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
  notes: string;
  recordedByName: string;
  recordedByRole: string;
  canEdit?: boolean;
}

interface FormState {
  visitDate: string;
  weightKg: string;
  heightCm: string;
  bpSystolic: string;
  bpDiastolic: string;
  pulse: string;
  notes: string;
}

const C = {
  border: '#E2E8F0',
  bg: '#F8FAFC',
  text: '#0F172A',
  muted: '#64748B',
  accent: 'var(--primary, #565ACF)',
  accentLight: 'var(--primary-light, #EEF0FF)',
  danger: '#B91C1C',
};

function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function fmtDate(d?: string): string {
  if (!d) return '—';
  const p = new Date(`${d}T00:00:00`);
  return Number.isNaN(p.getTime())
    ? d
    : p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtShort(d: string): string {
  const p = new Date(`${d}T00:00:00`);
  return Number.isNaN(p.getTime()) ? d : p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

const val = (n: number | null | undefined, unit = '') => (n === null || n === undefined ? '—' : `${n}${unit}`);
const bp = (e: Entry) => (e.bpSystolic && e.bpDiastolic ? `${e.bpSystolic}/${e.bpDiastolic}` : '—');

function emptyForm(latestHeight?: number | null): FormState {
  return {
    visitDate: todayIst(),
    weightKg: '',
    heightCm: latestHeight ? String(latestHeight) : '',
    bpSystolic: '',
    bpDiastolic: '',
    pulse: '',
    notes: '',
  };
}

function toForm(e: Entry): FormState {
  return {
    visitDate: e.visitDate,
    weightKg: e.weightKg === null ? '' : String(e.weightKg),
    heightCm: e.heightCm === null ? '' : String(e.heightCm),
    bpSystolic: e.bpSystolic === null ? '' : String(e.bpSystolic),
    bpDiastolic: e.bpDiastolic === null ? '' : String(e.bpDiastolic),
    pulse: e.pulse === null ? '' : String(e.pulse),
    notes: e.notes || '',
  };
}

// ---------------------------------------------------------------------------
// Tiny SVG trend chart (no dependencies)
// ---------------------------------------------------------------------------

interface Series {
  name: string;
  color: string;
  points: { x: string; y: number }[];
}

function TrendChart({ title, unit, series }: { title: string; unit: string; series: Series[] }) {
  const W = 260;
  const H = 110;
  const PAD = { l: 34, r: 10, t: 10, b: 22 };

  const all = series.flatMap((s) => s.points);
  const dates = Array.from(new Set(all.map((p) => p.x))).sort();

  if (all.length < 2 || dates.length < 2) {
    return (
      <div style={chartBox}>
        <div style={chartTitle}>{title}</div>
        <div style={{ color: C.muted, fontSize: 12, padding: '26px 0', textAlign: 'center' }}>
          {all.length === 0 ? 'No readings yet' : 'Needs 2 or more visits to show a trend'}
        </div>
      </div>
    );
  }

  const ys = all.map((p) => p.y);
  let min = Math.min(...ys);
  let max = Math.max(...ys);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padY = (max - min) * 0.12;
  min -= padY;
  max += padY;

  const xAt = (d: string) =>
    PAD.l + (dates.indexOf(d) / (dates.length - 1)) * (W - PAD.l - PAD.r);
  const yAt = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);

  return (
    <div style={chartBox}>
      <div style={{ ...chartTitle, display: 'flex', justifyContent: 'space-between' }}>
        <span>{title}</span>
        <span style={{ color: C.muted, fontWeight: 500 }}>{unit}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${title} trend`}>
        {[0, 0.5, 1].map((t) => {
          const v = min + (max - min) * (1 - t);
          const y = PAD.t + t * (H - PAD.t - PAD.b);
          return (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke={C.border} strokeDasharray="3 3" />
              <text x={PAD.l - 5} y={y + 3} fontSize="9" textAnchor="end" fill={C.muted}>
                {Math.round(v * 10) / 10}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <g key={s.name}>
            {series.length === 1 && (
              <polygon
                fill={s.color}
                fillOpacity="0.10"
                points={`${xAt(s.points[0].x)},${H - PAD.b} ${s.points
                  .map((p) => `${xAt(p.x)},${yAt(p.y)}`)
                  .join(' ')} ${xAt(s.points[s.points.length - 1].x)},${H - PAD.b}`}
              />
            )}
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              points={s.points.map((p) => `${xAt(p.x)},${yAt(p.y)}`).join(' ')}
            />
            {s.points.map((p, i) => (
              <circle key={i} cx={xAt(p.x)} cy={yAt(p.y)} r="2.8" fill={s.color}>
                <title>{`${s.name}: ${p.y} on ${fmtDate(p.x)}`}</title>
              </circle>
            ))}
          </g>
        ))}
        <text x={PAD.l} y={H - 6} fontSize="9" fill={C.muted}>
          {fmtShort(dates[0])}
        </text>
        <text x={W - PAD.r} y={H - 6} fontSize="9" textAnchor="end" fill={C.muted}>
          {fmtShort(dates[dates.length - 1])}
        </text>
      </svg>
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.muted }}>
          {series.map((s) => (
            <span key={s.name}>
              <span style={{ color: s.color }}>●</span> {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const chartBox: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: 14,
  padding: '14px 16px',
  background: '#fff',
};
const chartTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 };

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function VitalsPanel({
  adminFetch,
  userRole,
  appointmentId,
  email,
  phone,
  variant = 'full',
  onChanged,
}: VitalsPanelProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [canRecord, setCanRecord] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (appointmentId) q.set('appointmentId', appointmentId);
    if (email) q.set('email', email);
    if (phone) q.set('phone', phone);
    return q.toString();
  }, [appointmentId, email, phone]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await adminFetch(`/api/admin/vitals?${query}&_t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || 'Could not load vitals.');
        setEntries([]);
        return;
      }
      setEntries(Array.isArray(data.vitals) ? data.vitals : []);
      setCanRecord(Boolean(data.canRecord));
      setCanDelete(Boolean(data.canDelete));
    } catch {
      setLoadError('Could not load vitals.');
    } finally {
      setLoading(false);
    }
  }, [adminFetch, query]);

  useEffect(() => {
    void load();
  }, [load]);

  // entries come newest first
  const latest = entries[0];
  const previous = entries[1];
  const latestHeight = useMemo(() => entries.find((e) => e.heightCm !== null)?.heightCm ?? null, [entries]);

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm(latestHeight));
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (e: Entry) => {
    setEditingId(e.id);
    setForm(toForm(e));
    setFormError('');
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setFormError('');
  };

  const set = (k: keyof FormState) => (ev: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: ev.target.value }));

  const liveBmi = useMemo(() => {
    const w = Number(form.weightKg);
    const h = Number(form.heightCm) || latestHeight || 0;
    if (!w || !h) return null;
    return Math.round((w / ((h / 100) * (h / 100))) * 10) / 10;
  }, [form.weightKg, form.heightCm, latestHeight]);

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        ...(editingId ? { id: editingId } : { appointmentId, email, phone }),
        visitDate: form.visitDate,
        weightKg: form.weightKg,
        heightCm: form.heightCm,
        bpSystolic: form.bpSystolic,
        bpDiastolic: form.bpDiastolic,
        pulse: form.pulse,
        notes: form.notes,
      };
      const res = await adminFetch('/api/admin/vitals', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || 'Could not save vitals.');
        return;
      }
      toast.success(editingId ? 'Vitals updated.' : 'Vitals recorded.', 'Saved');
      closeForm();
      await load();
      onChanged?.();
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: Entry) => {
    if (!window.confirm(`Remove the vitals recorded on ${fmtDate(e.visitDate)}? This is logged in the audit trail.`)) return;
    try {
      const res = await adminFetch(`/api/admin/vitals?id=${encodeURIComponent(e.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not remove the entry.', 'Remove Failed');
        return;
      }
      toast.success('Vitals entry removed.', 'Removed');
      await load();
      onChanged?.();
    } catch {
      toast.error('Network error. Please try again.', 'Remove Failed');
    }
  };

  // Chronological series for the charts (oldest -> newest)
  const chrono = useMemo(() => [...entries].reverse(), [entries]);
  const pts = (pick: (e: Entry) => number | null) =>
    chrono.flatMap((e) => {
      const y = pick(e);
      return y === null ? [] : [{ x: e.visitDate, y }];
    });

  // Pharmacists and anyone the API refuses see nothing at all.
  if (userRole === 'pharmacist') return null;

  // ---------------- form ----------------
  const field = (label: string, key: keyof FormState, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: C.muted, fontWeight: 600 }}>
      {label}
      <input
        value={form[key]}
        onChange={set(key)}
        style={inputStyle}
        inputMode={props.type === 'date' ? undefined : 'decimal'}
        {...props}
      />
    </label>
  );

  const formUi = formOpen && (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>
        {editingId ? 'Correct vitals entry' : 'Record vitals'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
        {field('Visit date', 'visitDate', { type: 'date' })}
        {field('Weight (kg)', 'weightKg', { placeholder: 'e.g. 68.5' })}
        {field('Height (cm)', 'heightCm', { placeholder: 'e.g. 170' })}
        {field('BP systolic', 'bpSystolic', { placeholder: '120' })}
        {field('BP diastolic', 'bpDiastolic', { placeholder: '80' })}
        {field('Pulse (bpm)', 'pulse', { placeholder: '72' })}
      </div>
      <div style={{ marginTop: 10 }}>{field('Note (optional)', 'notes', { maxLength: 255, placeholder: 'e.g. measured after rest' })}</div>
      <div style={{ marginTop: 8, fontSize: 12, color: C.muted }}>
        BMI: <strong style={{ color: C.text }}>{liveBmi ?? '—'}</strong>{' '}
        {!form.heightCm && latestHeight && liveBmi ? `(using last height ${latestHeight} cm)` : ''}
      </div>
      {formError && <div style={{ marginTop: 8, color: C.danger, fontSize: 12 }}>{formError}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={closeForm} disabled={saving} style={btnGhost}>
          Cancel
        </button>
        <button type="button" onClick={save} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving…' : editingId ? 'Update' : 'Save vitals'}
        </button>
      </div>
    </div>
  );

  // ---------------- strip variant ----------------
  if (variant === 'strip') {
    const delta =
      latest?.weightKg != null && previous?.weightKg != null
        ? Math.round((latest.weightKg - previous.weightKg) * 10) / 10
        : null;
    return (
      <section aria-label="Vitals" style={{ margin: '0 0 14px' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: '8px 12px',
            background: '#fff',
          }}
        >
          <strong style={{ fontSize: 12, color: C.text }}>Vitals</strong>
          {loading ? (
            <span style={{ fontSize: 12, color: C.muted }}>Loading…</span>
          ) : loadError ? (
            <span style={{ fontSize: 12, color: C.danger }}>{loadError}</span>
          ) : !latest ? (
            <span style={{ fontSize: 12, color: C.muted }}>No vitals recorded yet</span>
          ) : (
            <>
              <Chip label="Wt" value={val(latest.weightKg, ' kg')} extra={delta !== null && delta !== 0 ? `${delta > 0 ? '+' : ''}${delta}` : undefined} />
              <Chip label="BMI" value={val(latest.bmi)} />
              <Chip label="BP" value={bp(latest)} />
              <Chip label="Pulse" value={val(latest.pulse)} />
              <span style={{ fontSize: 11, color: C.muted }}>{fmtDate(latest.visitDate)}</span>
            </>
          )}
          {canRecord && !formOpen && (
            <button type="button" onClick={openNew} style={{ ...btnGhost, marginLeft: 'auto' }}>
              + Record vitals
            </button>
          )}
        </div>
        {formOpen && <div style={{ marginTop: 8 }}>{formUi}</div>}
      </section>
    );
  }

  // ---------------- full variant ----------------
  const diff = (cur: number | null | undefined, prev: number | null | undefined, digits = 1) => {
    if (cur == null || prev == null) return undefined;
    const d = Math.round((cur - prev) * 10 ** digits) / 10 ** digits;
    if (d === 0) return 'no change';
    return `${d > 0 ? '+' : ''}${d} since last visit`;
  };

  return (
    <section aria-label="Vitals" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Vitals &amp; trends</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
            Weight, BMI, blood pressure and pulse recorded at each visit
          </div>
        </div>
        {canRecord && !formOpen && (
          <button type="button" onClick={openNew} style={btnPrimary}>
            + Record vitals
          </button>
        )}
      </div>

      {formUi}

      {loading ? (
        <div style={{ color: C.muted, fontSize: 13, padding: 12 }}>Loading vitals…</div>
      ) : loadError ? (
        <div style={{ color: C.danger, fontSize: 13, padding: 12 }}>{loadError}</div>
      ) : entries.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${C.border}`,
            borderRadius: 14,
            padding: '48px 24px',
            textAlign: 'center',
            background: C.bg,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>No vitals recorded yet</div>
          <div style={{ fontSize: 13, color: C.muted, margin: '6px 0 16px' }}>
            Record weight, BP and pulse at check-in and the trends will appear here.
          </div>
          {canRecord && !formOpen && (
            <button type="button" onClick={openNew} style={btnPrimary}>
              + Record first vitals
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Latest readings */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <Tile label="Weight" value={val(latest.weightKg, ' kg')} sub={diff(latest.weightKg, previous?.weightKg)} />
            <Tile label="BMI" value={val(latest.bmi)} sub={diff(latest.bmi, previous?.bmi)} />
            <Tile label="Blood pressure" value={bp(latest)} sub="mmHg" />
            <Tile label="Pulse" value={val(latest.pulse, ' bpm')} sub={diff(latest.pulse, previous?.pulse, 0)} />
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: -6 }}>
            Latest reading: {fmtDate(latest.visitDate)}
            {latest.recordedByName ? ` · recorded by ${latest.recordedByName}` : ''}
          </div>

          {/* Trends */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            <TrendChart title="Weight" unit="kg" series={[{ name: 'Weight', color: '#0EA5E9', points: pts((e) => e.weightKg) }]} />
            <TrendChart title="BMI" unit="kg/m²" series={[{ name: 'BMI', color: '#8B5CF6', points: pts((e) => e.bmi) }]} />
            <TrendChart
              title="Blood pressure"
              unit="mmHg"
              series={[
                { name: 'Systolic', color: '#EF4444', points: pts((e) => e.bpSystolic) },
                { name: 'Diastolic', color: '#F59E0B', points: pts((e) => e.bpDiastolic) },
              ]}
            />
            <TrendChart title="Pulse" unit="bpm" series={[{ name: 'Pulse', color: '#10B981', points: pts((e) => e.pulse) }]} />
          </div>

          {/* History */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: C.text, borderBottom: `1px solid ${C.border}` }}>
              History <span style={{ color: C.muted, fontWeight: 500 }}>({entries.length})</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: C.bg, textAlign: 'left', color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    {['Date', 'Weight', 'Height', 'BMI', 'BP', 'Pulse', 'Recorded by', ''].map((h) => (
                      <th key={h} style={{ padding: '9px 14px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDate(e.visitDate)}</td>
                      <td style={td}>{val(e.weightKg, ' kg')}</td>
                      <td style={td}>{val(e.heightCm, ' cm')}</td>
                      <td style={td}>{val(e.bmi)}</td>
                      <td style={td}>{bp(e)}</td>
                      <td style={td}>{val(e.pulse)}</td>
                      <td style={{ ...td, color: C.muted }}>
                        {e.recordedByName || '—'}
                        {e.recordedByRole ? ` (${e.recordedByRole})` : ''}
                        {e.notes ? <div style={{ fontSize: 11.5 }}>{e.notes}</div> : null}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {e.canEdit && (
                          <button type="button" onClick={() => openEdit(e)} style={linkBtn}>
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button type="button" onClick={() => remove(e)} style={{ ...linkBtn, color: C.danger }}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 16px', background: '#fff' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: C.text, margin: '4px 0 2px' }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted, minHeight: 16 }}>{sub || ''}</div>
    </div>
  );
}

function Chip({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        background: C.accentLight,
        borderRadius: 999,
        padding: '3px 10px',
        color: C.text,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: C.muted }}>{label} </span>
      <strong>{value}</strong>
      {extra ? <span style={{ color: C.muted }}> ({extra})</span> : null}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '7px 9px',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontSize: 13,
  color: C.text,
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
};
const td: React.CSSProperties = { padding: '11px 14px', verticalAlign: 'top', color: C.text };
const btnPrimary: React.CSSProperties = {
  background: C.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  background: '#fff',
  color: C.text,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};
const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: C.accent,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  padding: '2px 6px',
};