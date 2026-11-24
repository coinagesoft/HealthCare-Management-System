'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { summarizeHistory, type HistoryLike, type HistorySummary } from '@/lib/historyConstants';

/**
 * Allergy / current-medicine banner.
 *  - <AllergyBannerView summary=... />  pure display (used inside the History tab)
 *  - default export fetches the patient's history itself (used at the top of the prescription modal)
 * Three states: allergies on file (red), "no known allergies" confirmed (green),
 * or not recorded yet (amber) — so a blank list is never mistaken for "no allergies".
 */

export function AllergyBannerView({ summary }: { summary: HistorySummary }) {
  const hasAllergies = summary.allergies.length > 0;

  const tone = hasAllergies
    ? { bg: '#FEF2F2', border: '#FECACA', text: '#991B1B', icon: '⚠' }
    : summary.noKnownAllergies
      ? { bg: '#F0FDF4', border: '#BBF7D0', text: '#166534', icon: '✓' }
      : { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', icon: '?' };

  return (
    <div
      role={hasAllergies ? 'alert' : 'status'}
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 12,
        padding: '10px 14px',
        color: tone.text,
        fontSize: 13,
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <span style={{ fontSize: 16, lineHeight: '20px', fontWeight: 800 }}>{tone.icon}</span>
      <div style={{ minWidth: 0 }}>
        {hasAllergies ? (
          <div>
            <strong>Allergies:</strong> {summary.allergies.join(', ')}
          </div>
        ) : summary.noKnownAllergies ? (
          <div>
            <strong>No known allergies</strong> recorded
          </div>
        ) : (
          <div>
            <strong>Allergies not recorded yet.</strong> Ask the patient and record the answer in the History tab.
          </div>
        )}
        {summary.medicines.length > 0 && (
          <div style={{ marginTop: 3, color: '#475569' }}>
            <strong>Current medicines:</strong> {summary.medicines.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  appointmentId?: string;
  email?: string;
  phone?: string;
}

export default function AllergyBanner({ adminFetch, appointmentId, email, phone }: Props) {
  const [items, setItems] = useState<HistoryLike[] | null>(null);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (appointmentId) q.set('appointmentId', appointmentId);
    if (email) q.set('email', email);
    if (phone) q.set('phone', phone);
    return q.toString();
  }, [appointmentId, email, phone]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await adminFetch(`/api/admin/history?${query}&_t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return; // no access / error: show nothing rather than a misleading state
        const data = await res.json();
        if (alive && data.patientId !== null && Array.isArray(data.items)) setItems(data.items);
      } catch {
        /* silent: the banner is informational */
      }
    })();
    return () => {
      alive = false;
    };
  }, [adminFetch, query]);

  if (items === null) return null;
  return (
    <div style={{ margin: '0 0 12px' }}>
      <AllergyBannerView summary={summarizeHistory(items)} />
    </div>
  );
}
