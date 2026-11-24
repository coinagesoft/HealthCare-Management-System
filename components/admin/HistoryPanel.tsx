'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from '@/components/ui/Toast';
import {
  HISTORY_TYPES,
  NO_KNOWN_ALLERGIES_LABEL,
  summarizeHistory,
  type HistoryType,
} from '@/lib/historyConstants';
import { AllergyBannerView } from './AllergyBanner';

/**
 * Structured medical history for one patient (the "History" tab of the patient drawer).
 * Allergies, current medicines, illnesses, surgeries, family history and habits, with
 * one-click suggestion chips. Self-contained: inline styles only.
 */

export interface HistoryPanelProps {
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  userRole?: string;
  appointmentId?: string;
  email?: string;
  phone?: string;
  onChanged?: () => void;
}

interface Item {
  id: string;
  type: string;
  label: string;
  details: string;
  since: string;
  status: 'active' | 'resolved';
  isNone: boolean;
  recordedByName: string;
  recordedByRole: string;
  createdAt: string;
  canEdit?: boolean;
}

interface FormState {
  type: HistoryType;
  label: string;
  details: string;
  since: string;
  status: 'active' | 'resolved';
  isNone: boolean;
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

const emptyForm = (type: HistoryType = 'allergy'): FormState => ({
  type,
  label: '',
  details: '',
  since: '',
  status: 'active',
  isNone: false,
});

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function HistoryPanel({
  adminFetch,
  userRole,
  appointmentId,
  email,
  phone,
  onChanged,
}: HistoryPanelProps) {
  const [items, setItems] = useState<Item[]>([]);
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
      const res = await adminFetch(`/api/admin/history?${query}&_t=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || 'Could not load medical history.');
        setItems([]);
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setCanRecord(Boolean(data.canRecord));
      setCanDelete(Boolean(data.canDelete));
    } catch {
      setLoadError('Could not load medical history.');
    } finally {
      setLoading(false);
    }
  }, [adminFetch, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeHistory(items), [items]);
  const typeDef = HISTORY_TYPES.find((t) => t.key === form.type) ?? HISTORY_TYPES[0];
  const existingLabels = useMemo(
    () => new Set(items.filter((i) => i.type === form.type && i.status === 'active').map((i) => i.label.toLowerCase())),
    [items, form.type]
  );

  const openNew = (type: HistoryType = 'allergy') => {
    setEditingId(null);
    setForm(emptyForm(type));
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (i: Item) => {
    setEditingId(i.id);
    setForm({
      type: i.type as HistoryType,
      label: i.label,
      details: i.details,
      since: i.since,
      status: i.status,
      isNone: i.isNone,
    });
    setFormError('');
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setFormError('');
  };

  const save = async () => {
    setSaving(true);
    setFormError('');
    try {
      const res = await adminFetch('/api/admin/history', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          editingId
            ? { id: editingId, label: form.label, details: form.details, since: form.since, status: form.status }
            : { appointmentId, email, phone, ...form }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || 'Could not save.');
        return;
      }
      toast.success(editingId ? 'Entry updated.' : 'Added to medical history.', 'Saved');
      closeForm();
      await load();
      onChanged?.();
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleResolved = async (i: Item) => {
    try {
      const res = await adminFetch('/api/admin/history', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: i.id, status: i.status === 'active' ? 'resolved' : 'active' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not update the entry.', 'Update Failed');
        return;
      }
      await load();
      onChanged?.();
    } catch {
      toast.error('Network error. Please try again.', 'Update Failed');
    }
  };

  const remove = async (i: Item) => {
    if (!window.confirm(`Remove "${i.label}" from the medical history? This is logged in the audit trail.`)) return;
    try {
      const res = await adminFetch(`/api/admin/history?id=${encodeURIComponent(i.id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not remove the entry.', 'Remove Failed');
        return;
      }
      toast.success('Entry removed.', 'Removed');
      await load();
      onChanged?.();
    } catch {
      toast.error('Network error. Please try again.', 'Remove Failed');
    }
  };

  if (userRole === 'pharmacist') return null;

  // ---------------- add / edit form ----------------
  const formUi = formOpen && (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>
        {editingId ? `Edit ${typeDef.single.toLowerCase()}` : 'Add to medical history'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <label style={lbl}>
          Type
          <select
            value={form.type}
            disabled={Boolean(editingId)}
            onChange={(e) => setForm({ ...emptyForm(e.target.value as HistoryType) })}
            style={inp}
          >
            {HISTORY_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.single}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...lbl, gridColumn: 'span 2' }}>
          {typeDef.single}
          <input
            value={form.isNone ? NO_KNOWN_ALLERGIES_LABEL : form.label}
            disabled={form.isNone || (Boolean(editingId) && items.find((i) => i.id === editingId)?.isNone)}
            maxLength={255}
            placeholder={typeDef.placeholder}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            style={inp}
          />
        </label>
      </div>

      {!editingId && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {typeDef.chips.map((chip) => {
            const taken = existingLabels.has(chip.toLowerCase());
            return (
              <button
                key={chip}
                type="button"
                disabled={taken}
                onClick={() => setForm((f) => ({ ...f, label: chip, isNone: false }))}
                style={{ ...chipBtn, opacity: taken ? 0.45 : 1, cursor: taken ? 'not-allowed' : 'pointer' }}
                title={taken ? 'Already recorded' : `Use "${chip}"`}
              >
                {chip}
              </button>
            );
          })}
          {form.type === 'allergy' && (
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, isNone: !f.isNone, label: '' }))}
              style={{
                ...chipBtn,
                background: form.isNone ? '#166534' : '#F0FDF4',
                color: form.isNone ? '#fff' : '#166534',
                borderColor: '#BBF7D0',
              }}
            >
              ✓ {NO_KNOWN_ALLERGIES_LABEL}
            </button>
          )}
        </div>
      )}

      {!form.isNone && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
          <label style={{ ...lbl, gridColumn: 'span 2' }}>
            Details (optional)
            <input
              value={form.details}
              maxLength={500}
              placeholder="Reaction, dose, notes…"
              onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))}
              style={inp}
            />
          </label>
          <label style={lbl}>
            Since (optional)
            <input
              value={form.since}
              maxLength={32}
              placeholder="e.g. 2019 or 3 years"
              onChange={(e) => setForm((f) => ({ ...f, since: e.target.value }))}
              style={inp}
            />
          </label>
          <label style={lbl}>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'active' | 'resolved' }))}
              style={inp}
            >
              <option value="active">Active / ongoing</option>
              <option value="resolved">Resolved / past</option>
            </select>
          </label>
        </div>
      )}

      {formError && <div style={{ marginTop: 10, color: C.danger, fontSize: 12.5 }}>{formError}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        <button type="button" onClick={closeForm} disabled={saving} style={btnGhost}>
          Cancel
        </button>
        <button type="button" onClick={save} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving…' : editingId ? 'Update' : 'Add'}
        </button>
      </div>
    </div>
  );

  return (
    <section aria-label="Medical history" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Medical history</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
            Allergies, current medicines, past illness, surgeries, family history and habits
          </div>
        </div>
        {canRecord && !formOpen && (
          <button type="button" onClick={() => openNew()} style={btnPrimary}>
            + Add entry
          </button>
        )}
      </div>

      {!loading && !loadError && <AllergyBannerView summary={summary} />}

      {formUi}

      {loading ? (
        <div style={{ color: C.muted, fontSize: 13, padding: 12 }}>Loading medical history…</div>
      ) : loadError ? (
        <div style={{ color: C.danger, fontSize: 13, padding: 12 }}>{loadError}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
          {HISTORY_TYPES.map((t) => {
            const list = items.filter((i) => i.type === t.key);
            return (
              <div key={t.key} style={{ border: `1px solid ${C.border}`, borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '11px 16px',
                    borderBottom: `1px solid ${C.border}`,
                    background: C.bg,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                    {t.label} <span style={{ color: C.muted, fontWeight: 500 }}>({list.length})</span>
                  </span>
                  {canRecord && !formOpen && (
                    <button type="button" onClick={() => openNew(t.key)} style={linkBtn}>
                      + Add
                    </button>
                  )}
                </div>

                {list.length === 0 ? (
                  <div style={{ padding: '14px 16px', fontSize: 12.5, color: C.muted }}>None recorded</div>
                ) : (
                  list.map((i, idx) => (
                    <div
                      key={i.id}
                      style={{
                        padding: '10px 16px',
                        borderTop: idx === 0 ? 'none' : `1px solid ${C.border}`,
                        opacity: i.status === 'resolved' ? 0.62 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: i.type === 'allergy' && !i.isNone ? '#991B1B' : C.text }}>
                          {i.label}
                        </span>
                        {i.status === 'resolved' && (
                          <span style={{ ...pill, background: '#F1F5F9', color: C.muted }}>Resolved</span>
                        )}
                        {i.since && <span style={{ ...pill, background: C.accentLight, color: C.text }}>since {i.since}</span>}
                      </div>
                      {i.details && <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>{i.details}</div>}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8 }}>
                        <span style={{ fontSize: 11.5, color: C.muted }}>
                          {i.recordedByName || '—'}
                          {i.recordedByRole ? ` (${i.recordedByRole})` : ''} · {fmtDate(i.createdAt)}
                        </span>
                        <span style={{ whiteSpace: 'nowrap' }}>
                          {i.canEdit && !i.isNone && (
                            <button type="button" onClick={() => openEdit(i)} style={linkBtn}>
                              Edit
                            </button>
                          )}
                          {i.canEdit && !i.isNone && (
                            <button type="button" onClick={() => toggleResolved(i)} style={linkBtn}>
                              {i.status === 'active' ? 'Mark resolved' : 'Reactivate'}
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" onClick={() => remove(i)} style={{ ...linkBtn, color: C.danger }}>
                              Remove
                            </button>
                          )}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const lbl: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11.5,
  color: C.muted,
  fontWeight: 600,
};
const inp: React.CSSProperties = {
  padding: '8px 10px',
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  fontSize: 13,
  color: C.text,
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
};
const chipBtn: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  background: C.bg,
  color: C.text,
  borderRadius: 999,
  padding: '4px 11px',
  fontSize: 12,
  fontWeight: 600,
};
const pill: React.CSSProperties = { fontSize: 11, fontWeight: 600, borderRadius: 999, padding: '1px 8px' };
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
