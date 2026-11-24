/**
 * Shared constants and helpers for pathology and biopsy tracking.
 * Safe for use in both browser components and server code.
 */

export type PathologyStatus = 'sent' | 'received' | 'reviewed' | 'cancelled';

export interface PathologyStatusMeta {
  key: PathologyStatus;
  label: string;
  badgeBg: string;
  badgeColor: string;
  badgeBorder: string;
}

export const PATHOLOGY_STATUSES: Record<PathologyStatus, PathologyStatusMeta> = {
  sent: {
    key: 'sent',
    label: 'Sent to Lab',
    badgeBg: '#EFF6FF',
    badgeColor: '#1D4ED8',
    badgeBorder: '#BFDBFE',
  },
  received: {
    key: 'received',
    label: 'Report Received',
    badgeBg: '#FEF3C7',
    badgeColor: '#B45309',
    badgeBorder: '#FDE68A',
  },
  reviewed: {
    key: 'reviewed',
    label: 'Reviewed & Signed',
    badgeBg: '#ECFDF5',
    badgeColor: '#047857',
    badgeBorder: '#A7F3D0',
  },
  cancelled: {
    key: 'cancelled',
    label: 'Cancelled',
    badgeBg: '#F3F4F6',
    badgeColor: '#4B5563',
    badgeBorder: '#E5E7EB',
  },
};

export const COMMON_SAMPLE_TYPES = [
  'Biopsy (Excisional)',
  'Biopsy (Punch / Incisional)',
  'Histopathology',
  'Pus Culture & Sensitivity',
  'FNAC (Fine Needle Aspiration)',
  'Fistula Tract Tissue',
  'Fluid Cytology',
  'Other',
] as const;

export const COMMON_ANATOMICAL_SITES = [
  'Perianal tissue',
  'Anal canal / verge',
  'Pilonidal sinus wall',
  'Fistula tract',
  'Perianal abscess cavity',
  'Skin lesion',
  'Subcutaneous nodule',
  'Other',
] as const;

export interface LabPartnerConfig {
  name: string;
  turnaroundDays: number;
}

export const LAB_PARTNERS: LabPartnerConfig[] = [
  { name: 'Metropolis Healthcare', turnaroundDays: 3 },
  { name: 'Dr Lal PathLabs', turnaroundDays: 3 },
  { name: 'SRL Diagnostics', turnaroundDays: 3 },
  { name: 'Thyrocare', turnaroundDays: 2 },
  { name: 'Local Hospital Lab', turnaroundDays: 2 },
  { name: 'In-house Lab', turnaroundDays: 1 },
  { name: 'Other Lab', turnaroundDays: 3 },
];

/**
 * Returns today's date in Asia/Kolkata timezone as YYYY-MM-DD.
 */
export function getTodayKolkata(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Calculates a suggested expected date (YYYY-MM-DD) based on the lab's turnaround.
 */
export function getSuggestedExpectedDate(labName: string, collectedDateStr?: string): string {
  const baseDateStr = collectedDateStr || getTodayKolkata();
  const match = LAB_PARTNERS.find(
    (l) => l.name.toLowerCase().trim() === labName.toLowerCase().trim()
  );
  const days = match ? match.turnaroundDays : 3;

  const [y, m, d] = baseDateStr.split('-').map(Number);
  if (!y || !m || !d) return baseDateStr;

  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Overdue logic:
 * A sample is overdue if its status is 'sent' and its expected report date
 * is strictly before today in the clinic's local timezone (Asia/Kolkata).
 */
export function isPathologyOverdue(status: string, expectedDate: string): boolean {
  if (status !== 'sent') return false;
  if (!expectedDate) return false;
  const today = getTodayKolkata();
  return expectedDate < today;
}
