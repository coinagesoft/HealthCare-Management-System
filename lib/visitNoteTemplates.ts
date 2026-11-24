/**
 * Visit-note templates (shared by the browser and the server — no server-only imports here).
 *
 * Templates are plain code, like lib/historyConstants.ts, so the clinic can add or change
 * them by editing THIS FILE ONLY. No database change is needed.
 *
 * Every note saves a full copy ("snapshot") of the template it was written with, so an old
 * note always shows exactly what the doctor saw, even after a template is edited here.
 *
 * Rules when editing:
 *  - Keep each field `key` unique inside a template and never reuse a key for a different meaning.
 *  - A field with `required: true` must be answered before a note can be FINALIZED (drafts are free).
 */

export type NoteFieldType =
  | 'text' //        one short line
  | 'textarea' //    longer text (optional quick-insert phrases)
  | 'select' //      one choice from `options`
  | 'multiselect' // several choices from `options`
  | 'scale' //       whole number from `min` to `max` (default 0-10)
  | 'checkbox' //    yes / no tick
  | 'date'; //       YYYY-MM-DD

export interface NoteField {
  key: string;
  label: string;
  type: NoteFieldType;
  options?: string[];
  placeholder?: string;
  help?: string;
  min?: number;
  max?: number;
  /** textarea only: one-click phrases the doctor can add to the text */
  quickPhrases?: string[];
  /** Must be answered before the note can be finalized */
  required?: boolean;
  /** Show at half width next to another half-width field */
  half?: boolean;
}

export interface NoteSection {
  key: string;
  title: string;
  hint?: string;
  fields: NoteField[];
}

export interface NoteTemplate {
  key: string;
  label: string;
  description: string;
  sections: NoteSection[];
}

export type AnswerValue = string | string[] | number | boolean | null;
export type AnswerMap = Record<string, AnswerValue>;

// ---------------------------------------------------------------------------
// Clinic-editable phrase lists
// ---------------------------------------------------------------------------

/** One-click phrases under the Examination box. Edit freely. */
export const EXAM_PHRASES: string[] = [
  'General condition good.',
  'No tenderness.',
  'Tenderness present.',
  'Swelling noted.',
  'Redness / inflammation noted.',
  'No discharge.',
  'Discharge noted.',
  'Patient comfortable during examination.',
];

// ---------------------------------------------------------------------------
// Reusable sections
// ---------------------------------------------------------------------------

const complaint = (required: boolean): NoteSection => ({
  key: 'complaint',
  title: 'Chief complaint',
  hint: "What the patient came for, in their own words.",
  fields: [
    {
      key: 'chief_complaint',
      label: 'Chief complaint',
      type: 'textarea',
      placeholder: 'e.g. Pain and discomfort for the last 3 weeks',
      required,
    },
  ],
});

const history: NoteSection = {
  key: 'hpi',
  title: 'History of present illness',
  fields: [
    { key: 'duration', label: 'Duration', type: 'text', placeholder: 'e.g. 3 weeks', half: true },
    { key: 'severity', label: 'Severity (0 = none, 10 = worst)', type: 'scale', min: 0, max: 10, half: true },
    { key: 'visit_type', label: 'Visit type', type: 'select', options: ['First visit', 'Follow-up'], half: true },
    {
      key: 'course',
      label: 'Course so far',
      type: 'select',
      options: ['Improving', 'Same', 'Worsening', 'Comes and goes'],
      half: true,
    },
    {
      key: 'hpi',
      label: 'Details',
      type: 'textarea',
      placeholder: 'When it started, how it has changed, what makes it better or worse',
    },
  ],
};

const examination: NoteSection = {
  key: 'exam',
  title: 'Examination findings',
  hint: 'Allergies and vitals for this visit are shown above, so you do not need to type them again.',
  fields: [
    {
      key: 'findings',
      label: 'Findings',
      type: 'textarea',
      placeholder: 'What you found on examination',
      quickPhrases: EXAM_PHRASES,
    },
  ],
};

const assessment: NoteSection = {
  key: 'assessment',
  title: 'Assessment / diagnosis',
  fields: [
    {
      key: 'diagnosis',
      label: 'Diagnosis',
      type: 'textarea',
      placeholder: 'One diagnosis per line',
      required: true,
    },
  ],
};

const plan: NoteSection = {
  key: 'plan',
  title: 'Plan',
  hint: 'Medicines are written in the prescription below this note.',
  fields: [
    { key: 'treatment', label: 'Treatment given or advised', type: 'textarea' },
    { key: 'tests', label: 'Tests ordered', type: 'textarea', placeholder: 'e.g. Blood sugar, ultrasound' },
    { key: 'follow_up_date', label: 'Follow-up date', type: 'date', half: true },
  ],
};

const advice: NoteSection = {
  key: 'advice',
  title: 'Advice to the patient',
  fields: [{ key: 'advice', label: 'Advice', type: 'textarea', placeholder: 'Diet, lifestyle, things to avoid…' }],
};

const procedure: NoteSection = {
  key: 'procedure',
  title: 'Procedure details',
  fields: [
    { key: 'procedure_name', label: 'Procedure done', type: 'text', placeholder: 'e.g. Injection therapy', required: true },
    { key: 'procedure_site', label: 'Site', type: 'text', half: true },
    { key: 'procedure_agent', label: 'Agent / material used', type: 'text', half: true },
    { key: 'procedure_quantity', label: 'Quantity used', type: 'text', placeholder: 'e.g. 2 ml', half: true },
    { key: 'consent_taken', label: 'Patient consent taken', type: 'checkbox', half: true },
    {
      key: 'consent_details',
      label: 'Consent details',
      type: 'text',
      placeholder: 'e.g. Verbal and written, explained risks',
    },
    {
      key: 'complications',
      label: 'Complications',
      type: 'select',
      options: ['None', 'Yes — see details'],
      half: true,
    },
    { key: 'complication_details', label: 'Complication details', type: 'textarea' },
    {
      key: 'aftercare',
      label: 'Post-procedure advice',
      type: 'textarea',
      placeholder: 'Aftercare, what to watch for, when to come back',
    },
  ],
};

// ---------------------------------------------------------------------------
// The templates
// ---------------------------------------------------------------------------

export const TEMPLATES: NoteTemplate[] = [
  {
    key: 'general',
    label: 'General consultation',
    description: 'Full note for any patient and any condition.',
    sections: [complaint(true), history, examination, assessment, plan, advice],
  },
  {
    key: 'followup',
    label: 'Follow-up visit',
    description: 'Short note: progress since the last visit, new complaints and the plan.',
    sections: [
      {
        key: 'progress',
        title: 'Progress since last visit',
        fields: [
          {
            key: 'progress',
            label: 'Overall progress',
            type: 'select',
            options: ['Much better', 'Better', 'Same', 'Worse'],
            half: true,
          },
          { key: 'severity', label: 'Severity now (0-10)', type: 'scale', min: 0, max: 10, half: true },
          {
            key: 'adherence',
            label: 'Following the treatment',
            type: 'select',
            options: ['As advised', 'Partly', 'Not following'],
            half: true,
          },
          {
            key: 'new_complaints',
            label: 'New complaints',
            type: 'textarea',
            placeholder: 'Anything new since the last visit',
          },
        ],
      },
      examination,
      assessment,
      plan,
      advice,
    ],
  },
  {
    key: 'procedure',
    label: 'Procedure note',
    description: 'General sections plus site, agent, quantity, consent, complications and aftercare.',
    sections: [complaint(false), history, examination, assessment, procedure, plan],
  },
  {
    key: 'physio',
    label: 'Physiotherapy session',
    description: 'Same layout, with rehab-style assessment and a session treatment record.',
    sections: [
      complaint(true),
      {
        key: 'hpi',
        title: 'History',
        fields: [
          { key: 'duration', label: 'Duration', type: 'text', placeholder: 'e.g. 6 weeks', half: true },
          { key: 'severity', label: 'Pain (0 = none, 10 = worst)', type: 'scale', min: 0, max: 10, half: true },
          {
            key: 'hpi',
            label: 'Details',
            type: 'textarea',
            placeholder: 'Onset, what makes it better or worse, effect on daily activities',
          },
        ],
      },
      {
        key: 'exam',
        title: 'Assessment findings',
        hint: 'Range of motion, muscle strength, tone, balance, gait.',
        fields: [
          {
            key: 'findings',
            label: 'Findings',
            type: 'textarea',
            quickPhrases: [
              'Range of motion full.',
              'Range of motion reduced.',
              'Strength 5/5.',
              'Strength reduced.',
              'Gait normal.',
              'Balance impaired.',
            ],
          },
          { key: 'goals', label: 'Rehab goals', type: 'textarea' },
        ],
      },
      {
        key: 'assessment',
        title: 'Clinical impression',
        fields: [{ key: 'diagnosis', label: 'Impression / diagnosis', type: 'textarea', required: true }],
      },
      {
        key: 'session',
        title: 'This session',
        fields: [
          { key: 'treatment', label: 'Treatment given this session', type: 'textarea' },
          { key: 'home_exercises', label: 'Home exercises', type: 'textarea' },
          { key: 'follow_up_date', label: 'Next session', type: 'date', half: true },
        ],
      },
    ],
  },
];

export const TEMPLATE_KEYS: string[] = TEMPLATES.map((t) => t.key);

export function findTemplate(key?: string | null): NoteTemplate | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

/** A deep copy of a template, stored with each note so it stays readable forever. */
export function snapshotOf(tpl: NoteTemplate): NoteTemplate {
  return JSON.parse(JSON.stringify(tpl)) as NoteTemplate;
}

// ---------------------------------------------------------------------------
// Answer helpers
// ---------------------------------------------------------------------------

type TemplateLike = Pick<NoteTemplate, 'sections'>;

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** Keeps only fields that exist in the template and forces each value into its field's type. */
export function cleanAnswers(tpl: TemplateLike, raw: unknown): AnswerMap {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: AnswerMap = {};
  for (const section of tpl.sections) {
    for (const f of section.fields) {
      const v = src[f.key];
      switch (f.type) {
        case 'text':
          out[f.key] = str(v).trim().slice(0, 300);
          break;
        case 'textarea':
          out[f.key] = str(v).trim().slice(0, 4000);
          break;
        case 'select': {
          const s = str(v);
          out[f.key] = f.options && f.options.includes(s) ? s : '';
          break;
        }
        case 'multiselect':
          out[f.key] = Array.isArray(v)
            ? v.map(String).filter((o) => f.options && f.options.includes(o))
            : [];
          break;
        case 'scale': {
          const min = f.min ?? 0;
          const max = f.max ?? 10;
          const n = v === null || v === undefined || v === '' ? NaN : Number(v);
          out[f.key] = Number.isInteger(n) && n >= min && n <= max ? n : null;
          break;
        }
        case 'checkbox':
          out[f.key] = v === true;
          break;
        case 'date': {
          const s = str(v);
          out[f.key] = /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : '';
          break;
        }
      }
    }
  }
  return out;
}

export function isAnswered(v: AnswerValue | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return true;
  return v === true;
}

export function hasAnyAnswer(answers: AnswerMap): boolean {
  return Object.values(answers).some((v) => isAnswered(v));
}

/** Labels of required fields that are still empty (used when finalizing). */
export function missingRequired(tpl: TemplateLike, answers: AnswerMap): string[] {
  const missing: string[] = [];
  for (const section of tpl.sections) {
    for (const f of section.fields) {
      if (f.required && !isAnswered(answers[f.key])) missing.push(f.label);
    }
  }
  return missing;
}

export function sameAnswers(tpl: TemplateLike, a: unknown, b: unknown): boolean {
  return JSON.stringify(cleanAnswers(tpl, a)) === JSON.stringify(cleanAnswers(tpl, b));
}

/** Human-readable text of one answer ('' when empty). */
export function valueText(field: NoteField, v: AnswerValue | undefined): string {
  if (!isAnswered(v)) return '';
  if (field.type === 'checkbox') return 'Yes';
  if (field.type === 'scale') return `${v} / ${field.max ?? 10}`;
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}
