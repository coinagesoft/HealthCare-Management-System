/**
 * Shared (client + server) definitions for the structured medical history.
 * No server-only imports here, so React components can use it too.
 */

export interface HistoryTypeDef {
  key: 'allergy' | 'medicine' | 'illness' | 'surgery' | 'family' | 'habit';
  /** Section title */
  label: string;
  /** Singular label for forms */
  single: string;
  /** One-click suggestions that pre-fill the form */
  chips: string[];
  /** Hint under the label field */
  placeholder: string;
}

/** Order here = order of the sections in the History tab. */
export const HISTORY_TYPES: HistoryTypeDef[] = [
  {
    key: 'allergy',
    label: 'Allergies',
    single: 'Allergy',
    placeholder: 'e.g. Penicillin — rash',
    chips: ['Penicillin', 'Sulfa drugs', 'NSAIDs / Aspirin', 'Latex', 'Iodine / contrast', 'Dust', 'Dairy', 'Peanuts'],
  },
  {
    key: 'medicine',
    label: 'Current medicines',
    single: 'Current medicine',
    placeholder: 'e.g. Metformin 500 mg twice daily',
    chips: ['Blood thinner / anticoagulant', 'Blood pressure medicine', 'Diabetes medicine', 'Laxative', 'Painkillers (NSAID)', 'Iron supplement'],
  },
  {
    key: 'illness',
    label: 'Past & chronic illness',
    single: 'Illness',
    placeholder: 'e.g. Type 2 diabetes',
    chips: ['Diabetes', 'Hypertension', 'Thyroid disorder', 'Asthma', 'Heart disease', 'Chronic constipation', 'Irritable bowel syndrome', 'Anaemia'],
  },
  {
    key: 'surgery',
    label: 'Surgeries & procedures',
    single: 'Surgery',
    placeholder: 'e.g. Haemorrhoidectomy',
    chips: ['Previous piles surgery', 'Fistula surgery', 'Fissure surgery', 'Hernia repair', 'Appendectomy', 'C-section'],
  },
  {
    key: 'family',
    label: 'Family history',
    single: 'Family history',
    placeholder: 'e.g. Father — colorectal cancer',
    chips: ['Colorectal cancer', 'Diabetes', 'Hypertension', 'Piles / fistula', 'Heart disease'],
  },
  {
    key: 'habit',
    label: 'Habits & lifestyle',
    single: 'Habit',
    placeholder: 'e.g. Smokes 5 a day',
    chips: ['Smoking', 'Alcohol', 'Tobacco chewing', 'Low-fibre diet', 'Low water intake', 'Spicy food', 'Long sitting hours'],
  },
];

export type HistoryType = HistoryTypeDef['key'];
export const HISTORY_TYPE_KEYS: string[] = HISTORY_TYPES.map((t) => t.key);

export const NO_KNOWN_ALLERGIES_LABEL = 'No known allergies';

export interface HistoryLike {
  type: string;
  label: string;
  status: string;
  isNone: boolean;
}

export interface HistorySummary {
  /** Active, real allergies */
  allergies: string[];
  /** An active "No known allergies" marker exists (and no real allergy) */
  noKnownAllergies: boolean;
  /** Active current medicines */
  medicines: string[];
}

export function summarizeHistory(items: HistoryLike[]): HistorySummary {
  const active = items.filter((i) => i.status === 'active');
  const allergies = active.filter((i) => i.type === 'allergy' && !i.isNone).map((i) => i.label);
  const noKnownAllergies = allergies.length === 0 && active.some((i) => i.type === 'allergy' && i.isNone);
  const medicines = active.filter((i) => i.type === 'medicine').map((i) => i.label);
  return { allergies, noKnownAllergies, medicines };
}
