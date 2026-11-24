'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from '@/components/ui/Toast';
import {
  IconMicroscope,
  IconPlus,
  IconRefresh,
  IconDownload,
  IconUpload,
  IconCheck,
  IconTrash,
  IconCross,
} from '@/components/admin/AdminIcons';
import type { PathologySample } from '@/components/admin/types';
import {
  COMMON_SAMPLE_TYPES,
  COMMON_ANATOMICAL_SITES,
  LAB_PARTNERS,
  PATHOLOGY_STATUSES,
  getSuggestedExpectedDate,
  getTodayKolkata,
} from '@/lib/pathologyConstants';

export interface PathologyPanelProps {
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  userRole?: string;
  email?: string;
  phone?: string;
  patientName?: string;
  onChanged?: () => void;
}

export default function PathologyPanel({
  adminFetch,
  userRole = 'doctor',
  email,
  phone,
  patientName,
  onChanged,
}: PathologyPanelProps) {
  const isDoctor = userRole === 'admin' || userRole === 'doctor';

  const [samples, setSamples] = useState<PathologySample[]>([]);
  const [patientId, setPatientId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Modals state
  const [showLogModal, setShowLogModal] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<PathologySample | null>(null);
  const [uploadTarget, setUploadTarget] = useState<PathologySample | null>(null);

  // Form state
  const [sampleType, setSampleType] = useState<string>(COMMON_SAMPLE_TYPES[0]);
  const [customSampleType, setCustomSampleType] = useState('');
  const [site, setSite] = useState<string>(COMMON_ANATOMICAL_SITES[0]);
  const [customSite, setCustomSite] = useState('');
  const [labName, setLabName] = useState<string>(LAB_PARTNERS[0].name);
  const [customLab, setCustomLab] = useState('');
  const [collectedDate, setCollectedDate] = useState<string>(getTodayKolkata());
  const [expectedDate, setExpectedDate] = useState<string>(
    getSuggestedExpectedDate(LAB_PARTNERS[0].name, getTodayKolkata())
  );
  const [labRef, setLabRef] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load samples for this patient
  const loadSamples = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (email) params.set('email', email);
      if (phone) params.set('phone', phone);

      const res = await adminFetch(`/api/admin/pathology?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load pathology');
      const data = await res.json();
      setSamples(data.samples || []);
      if (data.samples?.[0]?.patientId) {
        setPatientId(data.samples[0].patientId);
      }
    } catch (err) {
      console.error(err);
      toast.error('Could not load pathology reports.', 'Error');
    } finally {
      setIsLoading(false);
    }
  }, [adminFetch, email, phone]);

  useEffect(() => {
    loadSamples();
  }, [loadSamples]);

  const handleLabChange = (lab: string) => {
    setLabName(lab);
    if (lab !== 'Other Lab') {
      setExpectedDate(getSuggestedExpectedDate(lab, collectedDate));
    }
  };

  const handleCollectedChange = (date: string) => {
    setCollectedDate(date);
    setExpectedDate(getSuggestedExpectedDate(labName, date));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSampleType = sampleType === 'Other' ? customSampleType.trim() : sampleType;
    if (!finalSampleType) {
      toast.error('Sample type is required.', 'Validation Error');
      return;
    }
    const finalSite = site === 'Other' ? customSite.trim() : site;
    const finalLab = labName === 'Other Lab' ? customLab.trim() : labName;

    setIsSubmitting(true);
    try {
      const res = await adminFetch('/api/admin/pathology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: patientId || undefined,
          email,
          phone,
          sampleType: finalSampleType,
          site: finalSite,
          collectedDate,
          labName: finalLab,
          labReference: labRef,
          expectedDate,
          notes,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to log sample');
      }

      toast.success('Pathology sample dispatch logged.', 'Success');
      setShowLogModal(false);
      loadSamples();
      if (onChanged) onChanged();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save sample.', 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Mark received
  const handleMarkReceived = async (sample: PathologySample) => {
    try {
      const res = await adminFetch(`/api/admin/pathology/${sample.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'received',
          receivedDate: getTodayKolkata(),
        }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      toast.success('Sample marked as received from lab.', 'Updated');
      loadSamples();
      if (onChanged) onChanged();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update receipt.', 'Error');
    }
  };

  // Review
  const [reviewResult, setReviewResult] = useState('');
  const [reviewInformed, setReviewInformed] = useState(false);
  const handleReview = async () => {
    if (!reviewTarget) return;
    setIsSubmitting(true);
    try {
      const res = await adminFetch(`/api/admin/pathology/${reviewTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'reviewed',
          resultSummary: reviewResult,
          patientInformed: reviewInformed,
        }),
      });
      if (!res.ok) throw new Error('Failed to sign review');
      toast.success('Pathology review signed and saved.', 'Signed');
      setReviewTarget(null);
      loadSamples();
      if (onChanged) onChanged();
    } catch (err: any) {
      toast.error(err.message || 'Failed to sign review.', 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Upload PDF
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const handleUpload = async () => {
    if (!uploadTarget || !selectedFile) return;
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await adminFetch(`/api/admin/pathology/${uploadTarget.id}/report`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      toast.success('Report PDF attached to sample.', 'Uploaded');
      setUploadTarget(null);
      setSelectedFile(null);
      loadSamples();
      if (onChanged) onChanged();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed.', 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete
  const handleDelete = async (sample: PathologySample) => {
    if (!confirm(`Delete sample record for "${sample.sampleType}"?`)) return;
    try {
      const res = await adminFetch(`/api/admin/pathology/${sample.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success('Pathology sample deleted.', 'Deleted');
      loadSamples();
      if (onChanged) onChanged();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete.', 'Error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h4 style={{ margin: 0, fontSize: 16, color: '#0F172A', fontWeight: 700 }}>
            Biopsy &amp; Pathology Records
          </h4>
          <span style={{ fontSize: 12.5, color: '#64748B' }}>
            Laboratory specimens, biopsy reports, culture &amp; histopathology
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={loadSamples}
            style={{
              padding: '7px 10px',
              borderRadius: 6,
              border: '1px solid #CBD5E1',
              background: '#fff',
              cursor: 'pointer',
              color: '#475569',
            }}
            title="Refresh"
          >
            <IconRefresh size={14} />
          </button>
          <button
            type="button"
            onClick={() => setShowLogModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '7px 12px',
              borderRadius: 6,
              background: '#4F46E5',
              color: '#fff',
              fontSize: 12.5,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <IconPlus />
            <span>Log Sample</span>
          </button>
        </div>
      </div>

      {/* Samples List */}
      {isLoading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#64748B', fontSize: 13 }}>
          Loading pathology records...
        </div>
      ) : samples.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            background: '#F8FAFC',
            borderRadius: 10,
            border: '1px dashed #CBD5E1',
          }}
        >
          <span style={{ fontSize: 28, display: 'block', marginBottom: 6 }}>🔬</span>
          <strong style={{ fontSize: 14, color: '#1E293B', display: 'block' }}>
            No pathology samples recorded
          </strong>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748B' }}>
            When a biopsy, tissue specimen or pus culture is sent to the lab, log it here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {samples.map((s) => {
            const meta = PATHOLOGY_STATUSES[s.status] || PATHOLOGY_STATUSES.sent;
            return (
              <div
                key={s.id}
                style={{
                  background: '#fff',
                  border: s.isOverdue ? '1.5px solid #FCA5A5' : '1px solid #E2E8F0',
                  borderRadius: 10,
                  padding: '14px 16px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontSize: 14.5, color: '#0F172A' }}>{s.sampleType}</strong>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 12,
                          background: meta.badgeBg,
                          color: meta.badgeColor,
                          border: `1px solid ${meta.badgeBorder}`,
                          fontSize: 11.5,
                          fontWeight: 600,
                        }}
                      >
                        {meta.label}
                      </span>
                      {s.isOverdue && (
                        <span
                          style={{
                            padding: '2px 6px',
                            borderRadius: 10,
                            background: '#FEF2F2',
                            color: '#DC2626',
                            border: '1px solid #FECACA',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          Overdue
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 12.5, color: '#475569', marginTop: 4 }}>
                      {s.site && <span>Site: <strong>{s.site}</strong> &bull; </span>}
                      <span>Lab: <strong>{s.labName}</strong></span>
                      {s.labReference && <span> (Ref: {s.labReference})</span>}
                    </div>

                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>
                      Collected: {s.collectedDate} &bull; Expected: <strong>{s.expectedDate}</strong>
                      {s.receivedDate && <span> &bull; Received: <strong style={{ color: '#059669' }}>{s.receivedDate}</strong></span>}
                    </div>

                    {s.resultSummary && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: '8px 12px',
                          background: '#F0FDF4',
                          border: '1px solid #BBF7D0',
                          borderRadius: 6,
                          fontSize: 12.5,
                          color: '#15803D',
                        }}
                      >
                        <strong>Findings:</strong> {s.resultSummary}
                        {s.reviewedByName && (
                          <span style={{ display: 'block', fontSize: 11.5, color: '#166534', marginTop: 3 }}>
                            Signed by {s.reviewedByName}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {s.reportFile ? (
                      <a
                        href={`/api/admin/pathology/${s.id}/report`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '5px 9px',
                          borderRadius: 6,
                          background: '#F1F5F9',
                          color: '#0F172A',
                          border: '1px solid #CBD5E1',
                          fontSize: 12,
                          textDecoration: 'none',
                          fontWeight: 500,
                        }}
                      >
                        <IconDownload size={13} />
                        <span>PDF</span>
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setUploadTarget(s);
                          setSelectedFile(null);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '5px 9px',
                          borderRadius: 6,
                          background: '#F8FAFC',
                          color: '#475569',
                          border: '1px dashed #CBD5E1',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <IconUpload size={13} />
                        <span>Upload</span>
                      </button>
                    )}

                    {s.status === 'sent' && (
                      <button
                        type="button"
                        onClick={() => handleMarkReceived(s)}
                        style={{
                          padding: '5px 9px',
                          borderRadius: 6,
                          background: '#FEF3C7',
                          color: '#B45309',
                          border: '1px solid #FDE68A',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Mark Received
                      </button>
                    )}

                    {isDoctor && s.status !== 'reviewed' && (
                      <button
                        type="button"
                        onClick={() => {
                          setReviewTarget(s);
                          setReviewResult(s.resultSummary || '');
                          setReviewInformed(s.patientInformed || false);
                        }}
                        style={{
                          padding: '5px 9px',
                          borderRadius: 6,
                          background: '#EEF2FF',
                          color: '#4338CA',
                          border: '1px solid #C7D2FE',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Review
                      </button>
                    )}

                    {isDoctor && (
                      <button
                        type="button"
                        onClick={() => handleDelete(s)}
                        style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 4 }}
                        title="Delete"
                      >
                        <IconTrash size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Log Sample Modal */}
      {showLogModal && (
        <div
          className="admin-drawer-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowLogModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              width: '100%',
              maxWidth: 500,
              padding: '22px 26px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 700 }}>Log Sample Dispatch</h3>
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}
              >
                <IconCross />
              </button>
            </div>

            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  Sample Type *
                </label>
                <select
                  value={sampleType}
                  onChange={(e) => setSampleType(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }}
                >
                  {COMMON_SAMPLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {sampleType === 'Other' && (
                  <input
                    type="text"
                    placeholder="Specify sample type"
                    value={customSampleType}
                    onChange={(e) => setCustomSampleType(e.target.value)}
                    style={{ marginTop: 6, width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12 }}
                  />
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  Anatomical Site
                </label>
                <select
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }}
                >
                  {COMMON_ANATOMICAL_SITES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Laboratory *
                  </label>
                  <select
                    value={labName}
                    onChange={(e) => handleLabChange(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }}
                  >
                    {LAB_PARTNERS.map((l) => (
                      <option key={l.name} value={l.name}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Lab Reference
                  </label>
                  <input
                    type="text"
                    placeholder="Sample ID / Barcode"
                    value={labRef}
                    onChange={(e) => setLabRef(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Collected Date
                  </label>
                  <input
                    type="date"
                    value={collectedDate}
                    onChange={(e) => handleCollectedChange(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                    Expected Date
                  </label>
                  <input
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                  Clinical Indication / Instructions
                </label>
                <textarea
                  rows={2}
                  placeholder="Notes for lab..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12.5 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', fontSize: 12.5 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 6,
                    background: '#4F46E5',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 12.5,
                    border: 'none',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSubmitting ? 'Saving...' : 'Save Sample'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewTarget && (
        <div
          className="admin-drawer-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReviewTarget(null);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              width: '100%',
              maxWidth: 480,
              padding: '22px 26px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 700 }}>Review Pathology Findings</h3>
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}
              >
                <IconCross />
              </button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 4 }}>
                Result Summary / Diagnosis Findings *
              </label>
              <textarea
                rows={3}
                placeholder="Enter report findings..."
                value={reviewResult}
                onChange={(e) => setReviewResult(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 13 }}
              />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={reviewInformed}
                  onChange={(e) => setReviewInformed(e.target.checked)}
                />
                <span style={{ color: '#1E293B', fontWeight: 500 }}>Patient informed of results</span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', fontSize: 12.5 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReview}
                disabled={isSubmitting || !reviewResult.trim()}
                style={{
                  padding: '7px 16px',
                  borderRadius: 6,
                  background: '#059669',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 12.5,
                  border: 'none',
                  cursor: isSubmitting || !reviewResult.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmitting ? 'Saving...' : 'Sign & Complete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload PDF Modal */}
      {uploadTarget && (
        <div
          className="admin-drawer-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setUploadTarget(null);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              width: '100%',
              maxWidth: 440,
              padding: '22px 26px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16.5, fontWeight: 700 }}>Upload Pathology PDF</h3>
              <button
                type="button"
                onClick={() => setUploadTarget(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}
              >
                <IconCross />
              </button>
            </div>

            <div style={{ marginBottom: 18 }}>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                style={{ width: '100%', padding: '8px', border: '1px dashed #CBD5E1', borderRadius: 6, fontSize: 12.5 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => setUploadTarget(null)}
                style={{ padding: '7px 12px', borderRadius: 6, border: '1px solid #CBD5E1', background: '#fff', fontSize: 12.5 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={isSubmitting || !selectedFile}
                style={{
                  padding: '7px 16px',
                  borderRadius: 6,
                  background: '#4F46E5',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 12.5,
                  border: 'none',
                  cursor: isSubmitting || !selectedFile ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmitting ? 'Uploading...' : 'Save File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
