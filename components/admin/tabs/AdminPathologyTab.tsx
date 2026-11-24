'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from '@/components/ui/Toast';
import {
  IconSearch,
  IconRefresh,
  IconPlus,
  IconMicroscope,
  IconUpload,
  IconDownload,
  IconCheck,
  IconTrash,
  IconClock,
  IconCross,
  IconEdit,
} from '@/components/admin/AdminIcons';
import type { PathologySample, PathologyStats, PatientGroup } from '@/components/admin/types';
import {
  COMMON_SAMPLE_TYPES,
  COMMON_ANATOMICAL_SITES,
  LAB_PARTNERS,
  PATHOLOGY_STATUSES,
  getSuggestedExpectedDate,
  getTodayKolkata,
} from '@/lib/pathologyConstants';

interface AdminPathologyTabProps {
  userRole?: string;
  adminFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  patients?: PatientGroup[];
  onSelectPatient?: (patient: PatientGroup) => void;
  onRefreshStats?: () => void;
}

export default function AdminPathologyTab({
  userRole = 'doctor',
  adminFetch,
  patients = [],
  onRefreshStats,
}: AdminPathologyTabProps) {
  const isDoctor = userRole === 'admin' || userRole === 'doctor';

  const [samples, setSamples] = useState<PathologySample[]>([]);
  const [stats, setStats] = useState<PathologyStats>({
    total: 0,
    sent: 0,
    received: 0,
    reviewed: 0,
    overdue: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<PathologySample | null>(null);
  const [reviewTarget, setReviewTarget] = useState<PathologySample | null>(null);
  const [uploadTarget, setUploadTarget] = useState<PathologySample | null>(null);

  // Load samples and stats
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter === 'overdue') {
        params.set('overdue', 'true');
      } else if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (search.trim()) {
        params.set('search', search.trim());
      }

      const res = await adminFetch(`/api/admin/pathology?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load pathology data');
      const data = await res.json();
      setSamples(data.samples || []);
      if (data.stats) {
        setStats(data.stats);
      }
      if (onRefreshStats) {
        onRefreshStats();
      }
    } catch (err) {
      console.error(err);
      toast.error('Could not load pathology samples. Please refresh.', 'Load Error');
    } finally {
      setIsLoading(false);
    }
  }, [adminFetch, statusFilter, search, onRefreshStats]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Form states for creation
  const [formPatientSearch, setFormPatientSearch] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [formSampleType, setFormSampleType] = useState<string>(COMMON_SAMPLE_TYPES[0]);
  const [formCustomSampleType, setFormCustomSampleType] = useState('');
  const [formSite, setFormSite] = useState<string>(COMMON_ANATOMICAL_SITES[0]);
  const [formCustomSite, setFormCustomSite] = useState('');
  const [formLabName, setFormLabName] = useState<string>(LAB_PARTNERS[0].name);
  const [formCustomLab, setFormCustomLab] = useState('');
  const [formCollectedDate, setFormCollectedDate] = useState<string>(getTodayKolkata());
  const [formExpectedDate, setFormExpectedDate] = useState<string>(
    getSuggestedExpectedDate(LAB_PARTNERS[0].name, getTodayKolkata())
  );
  const [formLabRef, setFormLabRef] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Update expected date when lab or collected date changes in creation modal
  const handleLabChange = (lab: string) => {
    setFormLabName(lab);
    if (lab !== 'Other Lab') {
      setFormExpectedDate(getSuggestedExpectedDate(lab, formCollectedDate));
    }
  };

  const handleCollectedDateChange = (date: string) => {
    setFormCollectedDate(date);
    setFormExpectedDate(getSuggestedExpectedDate(formLabName, date));
  };

  // Patient search filtering for create form
  const matchedPatients = useMemo(() => {
    if (!formPatientSearch.trim()) return patients.slice(0, 5);
    const q = formPatientSearch.toLowerCase();
    return patients
      .filter((p) => p.fullName.toLowerCase().includes(q) || p.phone.includes(q) || p.email.toLowerCase().includes(q))
      .slice(0, 8);
  }, [patients, formPatientSearch]);

  const handleCreateSample = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId) {
      toast.error('Please select a patient from the list.', 'Missing Patient');
      return;
    }
    const finalSampleType = formSampleType === 'Other' ? formCustomSampleType.trim() : formSampleType;
    if (!finalSampleType) {
      toast.error('Please specify the sample type.', 'Validation Error');
      return;
    }
    const finalSite = formSite === 'Other' ? formCustomSite.trim() : formSite;
    const finalLab = formLabName === 'Other Lab' ? formCustomLab.trim() : formLabName;
    if (!finalLab) {
      toast.error('Please specify the laboratory name.', 'Validation Error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await adminFetch('/api/admin/pathology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId: selectedPatientId,
          sampleType: finalSampleType,
          site: finalSite,
          collectedDate: formCollectedDate,
          labName: finalLab,
          labReference: formLabRef,
          expectedDate: formExpectedDate,
          notes: formNotes,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to create sample');
      }

      toast.success('Pathology sample logged successfully.', 'Sample Recorded');
      setShowCreateModal(false);
      resetCreateForm();
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save sample.', 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetCreateForm = () => {
    setSelectedPatientId(null);
    setFormPatientSearch('');
    setFormSampleType(COMMON_SAMPLE_TYPES[0]);
    setFormCustomSampleType('');
    setFormSite(COMMON_ANATOMICAL_SITES[0]);
    setFormCustomSite('');
    setFormLabName(LAB_PARTNERS[0].name);
    setFormCustomLab('');
    setFormCollectedDate(getTodayKolkata());
    setFormExpectedDate(getSuggestedExpectedDate(LAB_PARTNERS[0].name, getTodayKolkata()));
    setFormLabRef('');
    setFormNotes('');
  };

  // Receive sample workflow
  const [receiveDate, setReceiveDate] = useState(getTodayKolkata());
  const handleMarkReceived = async () => {
    if (!receiveTarget) return;
    setIsSubmitting(true);
    try {
      const res = await adminFetch(`/api/admin/pathology/${receiveTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'received',
          receivedDate: receiveDate,
        }),
      });
      if (!res.ok) throw new Error('Failed to update receipt status');
      toast.success('Sample marked as received from laboratory.', 'Status Updated');
      setReceiveTarget(null);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to mark received.', 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Review & sign-off workflow
  const [reviewResult, setReviewResult] = useState('');
  const [reviewInformed, setReviewInformed] = useState(false);
  const handleReviewSample = async () => {
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
      if (!res.ok) throw new Error('Failed to save review');
      toast.success('Pathology report reviewed and signed.', 'Reviewed');
      setReviewTarget(null);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save review.', 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Upload PDF workflow
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const handleUploadReport = async () => {
    if (!uploadTarget || !selectedFile) return;
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await adminFetch(`/api/admin/pathology/${uploadTarget.id}/report`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Upload failed');
      }
      toast.success('Pathology report PDF uploaded successfully.', 'Uploaded');
      setUploadTarget(null);
      setSelectedFile(null);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload report.', 'Upload Failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete sample
  const handleDeleteSample = async (sample: PathologySample) => {
    if (!confirm(`Are you sure you want to remove the sample record for "${sample.sampleType}"?`)) return;
    try {
      const res = await adminFetch(`/api/admin/pathology/${sample.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete sample');
      toast.success('Pathology record deleted.', 'Deleted');
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete record.', 'Delete Error');
    }
  };

  return (
    <div className="tab-pane-fade" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 5 KPI Metric Cards */}
      <div className="admin-kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#EFF6FF', color: '#2563EB' }}>
            <IconMicroscope size={22} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Total Samples</span>
            <strong className="kpi-value">{stats.total}</strong>
            <span className="kpi-meta">All logged specimens</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#EFF6FF', color: '#1D4ED8' }}>
            <IconClock size={22} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Sent to Lab</span>
            <strong className="kpi-value">{stats.sent}</strong>
            <span className="kpi-meta">In transit / processing</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#FEF3C7', color: '#D97706' }}>
            <IconUpload size={22} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Received Reports</span>
            <strong className="kpi-value">{stats.received}</strong>
            <span className="kpi-meta">Awaiting doctor review</span>
          </div>
        </div>

        <div className="kpi-card" style={stats.overdue > 0 ? { border: '1.5px solid #FCA5A5', background: '#FEF2F2' } : {}}>
          <div
            className="kpi-icon-box"
            style={{
              background: stats.overdue > 0 ? '#FEE2E2' : '#F3F4F6',
              color: stats.overdue > 0 ? '#DC2626' : '#6B7280',
            }}
          >
            <span style={{ fontSize: 18, fontWeight: 'bold' }}>!</span>
          </div>
          <div className="kpi-info">
            <span className="kpi-label" style={stats.overdue > 0 ? { color: '#B91C1C', fontWeight: 600 } : {}}>
              Overdue Reports
            </span>
            <strong className="kpi-value" style={stats.overdue > 0 ? { color: '#DC2626' } : {}}>
              {stats.overdue}
            </strong>
            <span className="kpi-meta">{stats.overdue > 0 ? 'Follow-up with lab needed' : 'All turnaround on schedule'}</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-icon-box" style={{ background: '#ECFDF5', color: '#059669' }}>
            <IconCheck size={22} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Reviewed & Signed</span>
            <strong className="kpi-value">{stats.reviewed}</strong>
            <span className="kpi-meta">Clinical diagnosis finalized</span>
          </div>
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          background: '#fff',
          padding: '16px 20px',
          borderRadius: 12,
          border: '1px solid #E2E8F0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 260 }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: 360 }}>
            <span
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94A3B8',
                display: 'flex',
              }}
            >
              <IconSearch size={16} />
            </span>
            <input
              type="text"
              placeholder="Search by patient, sample, lab or reference..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '9px 12px 9px 36px',
                borderRadius: 8,
                border: '1px solid #CBD5E1',
                fontSize: 13.5,
              }}
            />
          </div>

          {/* Status Filter Tabs */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { id: 'all', label: 'All' },
              { id: 'sent', label: 'Sent' },
              { id: 'received', label: 'Received' },
              { id: 'reviewed', label: 'Reviewed' },
              { id: 'overdue', label: `Overdue (${stats.overdue})` },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 6,
                  border: statusFilter === tab.id ? '1px solid #6366F1' : '1px solid #E2E8F0',
                  background:
                    statusFilter === tab.id
                      ? '#EEF2FF'
                      : tab.id === 'overdue' && stats.overdue > 0
                      ? '#FEF2F2'
                      : '#F8FAFC',
                  color:
                    statusFilter === tab.id
                      ? '#4F46E5'
                      : tab.id === 'overdue' && stats.overdue > 0
                      ? '#DC2626'
                      : '#475569',
                  fontWeight: statusFilter === tab.id ? 600 : 500,
                  fontSize: 12.5,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={loadData}
            title="Refresh"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 12px',
              borderRadius: 8,
              border: '1px solid #CBD5E1',
              background: '#fff',
              color: '#475569',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            <IconRefresh size={14} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 16px',
              borderRadius: 8,
              background: '#4F46E5',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)',
            }}
          >
            <IconPlus />
            <span>Log Sample Dispatch</span>
          </button>
        </div>
      </div>

      {/* Pathology Samples Table */}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          border: '1px solid #E2E8F0',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13.5 }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#64748B', fontWeight: 600, fontSize: 12 }}>
                <th style={{ padding: '12px 16px' }}>PATIENT</th>
                <th style={{ padding: '12px 16px' }}>SAMPLE &amp; SITE</th>
                <th style={{ padding: '12px 16px' }}>LAB &amp; REFERENCE</th>
                <th style={{ padding: '12px 16px' }}>DATES &amp; SCHEDULE</th>
                <th style={{ padding: '12px 16px' }}>STATUS</th>
                <th style={{ padding: '12px 16px' }}>REPORT FILE</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', color: '#64748B' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span className="spinner-border" />
                      <span>Loading pathology records...</span>
                    </div>
                  </td>
                </tr>
              ) : samples.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '50px 16px', textAlign: 'center', color: '#64748B' }}>
                    <div style={{ maxWidth: 360, margin: '0 auto' }}>
                      <div style={{ fontSize: 36, marginBottom: 8 }}>🔬</div>
                      <strong style={{ display: 'block', fontSize: 15, color: '#1E293B', marginBottom: 4 }}>
                        No Pathology Samples Found
                      </strong>
                      <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
                        {search || statusFilter !== 'all'
                          ? 'Try clearing the search or filter.'
                          : 'Log a new sample dispatch to start tracking biopsies, cultures, and histopathology.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                samples.map((s) => {
                  const meta = PATHOLOGY_STATUSES[s.status] || PATHOLOGY_STATUSES.sent;
                  return (
                    <tr
                      key={s.id}
                      style={{
                        borderBottom: '1px solid #F1F5F9',
                        background: s.isOverdue ? '#FFFDFD' : '#fff',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      {/* Patient column */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        <strong style={{ display: 'block', color: '#1E293B', fontWeight: 600 }}>
                          {s.patientName || `Patient #${s.patientId}`}
                        </strong>
                        <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                          {s.patientPhone && <span>{s.patientPhone} &bull; </span>}
                          {s.patientAge && <span>{s.patientAge} yrs</span>}
                        </div>
                      </td>

                      {/* Sample & Site */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        <span style={{ fontWeight: 600, color: '#0F172A' }}>{s.sampleType}</span>
                        {s.site && (
                          <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                            Site: <em>{s.site}</em>
                          </div>
                        )}
                        {s.resultSummary && (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 12,
                              color: '#15803D',
                              background: '#F0FDF4',
                              padding: '4px 8px',
                              borderRadius: 6,
                              maxWidth: 240,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={s.resultSummary}
                          >
                            Result: {s.resultSummary}
                          </div>
                        )}
                      </td>

                      {/* Lab & Reference */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        <span style={{ fontWeight: 500, color: '#334155' }}>{s.labName}</span>
                        {s.labReference && (
                          <div style={{ fontSize: 12, color: '#64748B', fontFamily: 'monospace', marginTop: 2 }}>
                            Ref: {s.labReference}
                          </div>
                        )}
                      </td>

                      {/* Dates & Schedule */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 12, color: '#475569' }}>
                          Collected: <strong>{s.collectedDate}</strong>
                        </div>
                        <div style={{ fontSize: 12, marginTop: 3 }}>
                          Expected:{' '}
                          <span style={{ fontWeight: 600, color: s.isOverdue ? '#DC2626' : '#1E293B' }}>
                            {s.expectedDate}
                          </span>
                        </div>
                        {s.receivedDate && (
                          <div style={{ fontSize: 11.5, color: '#059669', marginTop: 3 }}>
                            Received: {s.receivedDate}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              padding: '3px 9px',
                              borderRadius: 14,
                              background: meta.badgeBg,
                              color: meta.badgeColor,
                              border: `1px solid ${meta.badgeBorder}`,
                              fontSize: 12,
                              fontWeight: 600,
                            }}
                          >
                            {meta.label}
                          </span>

                          {s.isOverdue && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '2px 8px',
                                borderRadius: 12,
                                background: '#FEF2F2',
                                color: '#DC2626',
                                border: '1px solid #FECACA',
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              <span>⚠️ Overdue</span>
                            </span>
                          )}

                          {s.patientInformed && (
                            <span style={{ fontSize: 11, color: '#059669', display: 'flex', alignItems: 'center', gap: 3 }}>
                              ✓ Patient informed
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Report File */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                        {s.reportFile ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <a
                              href={`/api/admin/pathology/${s.id}/report`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                padding: '5px 10px',
                                borderRadius: 6,
                                background: '#F1F5F9',
                                color: '#0F172A',
                                border: '1px solid #CBD5E1',
                                fontSize: 12,
                                textDecoration: 'none',
                                fontWeight: 500,
                              }}
                              title={s.reportOriginalName || 'View Report'}
                            >
                              <IconDownload size={13} />
                              <span>View PDF</span>
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                setUploadTarget(s);
                                setSelectedFile(null);
                              }}
                              title="Replace PDF"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#64748B',
                                cursor: 'pointer',
                                padding: 4,
                              }}
                            >
                              <IconEdit size={13} />
                            </button>
                          </div>
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
                              gap: 5,
                              padding: '5px 10px',
                              borderRadius: 6,
                              background: '#F8FAFC',
                              color: '#475569',
                              border: '1px dashed #CBD5E1',
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            <IconUpload size={13} />
                            <span>Upload PDF</span>
                          </button>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {s.status === 'sent' && (
                            <button
                              type="button"
                              onClick={() => {
                                setReceiveTarget(s);
                                setReceiveDate(getTodayKolkata());
                              }}
                              style={{
                                padding: '5px 10px',
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
                                padding: '5px 10px',
                                borderRadius: 6,
                                background: '#EEF2FF',
                                color: '#4338CA',
                                border: '1px solid #C7D2FE',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Review &amp; Sign
                            </button>
                          )}

                          {isDoctor && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSample(s)}
                              title="Delete Record"
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#94A3B8',
                                cursor: 'pointer',
                                padding: 6,
                                borderRadius: 4,
                              }}
                            >
                              <IconTrash size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: Create Dispatched Sample */}
      {showCreateModal && (
        <div
          className="admin-drawer-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCreateModal(false);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              width: '100%',
              maxWidth: 580,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              padding: '24px 28px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>🔬</span>
                <h3 style={{ margin: 0, fontSize: 18, color: '#0F172A', fontWeight: 700 }}>
                  Log Sample Dispatch
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}
              >
                <IconCross />
              </button>
            </div>

            <form onSubmit={handleCreateSample} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Patient Selector */}
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Select Patient <span style={{ color: '#DC2626' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="Search patient by name or phone..."
                  value={formPatientSearch}
                  onChange={(e) => {
                    setFormPatientSearch(e.target.value);
                    setSelectedPatientId(null);
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    fontSize: 13.5,
                  }}
                />
                <div
                  style={{
                    marginTop: 6,
                    maxHeight: 120,
                    overflowY: 'auto',
                    border: '1px solid #E2E8F0',
                    borderRadius: 6,
                    background: '#F8FAFC',
                  }}
                >
                  {matchedPatients.map((p, idx) => {
                    const id = idx + 1; // Patient id
                    const isSelected = selectedPatientId === id;
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          setSelectedPatientId(id);
                          setFormPatientSearch(`${p.fullName} (${p.phone})`);
                        }}
                        style={{
                          padding: '6px 10px',
                          cursor: 'pointer',
                          background: isSelected ? '#EEF2FF' : 'transparent',
                          color: isSelected ? '#4338CA' : '#1E293B',
                          fontSize: 12.5,
                          borderBottom: '1px solid #F1F5F9',
                        }}
                      >
                        <strong>{p.fullName}</strong> &bull; {p.phone} {p.age ? `(${p.age} yrs)` : ''}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sample Type & Site */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Sample Type <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <select
                    value={formSampleType}
                    onChange={(e) => setFormSampleType(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
                  >
                    {COMMON_SAMPLE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  {formSampleType === 'Other' && (
                    <input
                      type="text"
                      placeholder="Specify sample type"
                      value={formCustomSampleType}
                      onChange={(e) => setFormCustomSampleType(e.target.value)}
                      style={{ marginTop: 6, width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12 }}
                    />
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Anatomical Site
                  </label>
                  <select
                    value={formSite}
                    onChange={(e) => setFormSite(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
                  >
                    {COMMON_ANATOMICAL_SITES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  {formSite === 'Other' && (
                    <input
                      type="text"
                      placeholder="Specify anatomical site"
                      value={formCustomSite}
                      onChange={(e) => setFormCustomSite(e.target.value)}
                      style={{ marginTop: 6, width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12 }}
                    />
                  )}
                </div>
              </div>

              {/* Lab Name & Lab Reference */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Pathology Laboratory <span style={{ color: '#DC2626' }}>*</span>
                  </label>
                  <select
                    value={formLabName}
                    onChange={(e) => handleLabChange(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
                  >
                    {LAB_PARTNERS.map((l) => (
                      <option key={l.name} value={l.name}>
                        {l.name} ({l.turnaroundDays}d turnaround)
                      </option>
                    ))}
                  </select>
                  {formLabName === 'Other Lab' && (
                    <input
                      type="text"
                      placeholder="Specify Lab name"
                      value={formCustomLab}
                      onChange={(e) => setFormCustomLab(e.target.value)}
                      style={{ marginTop: 6, width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 12 }}
                    />
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Lab Reference / Sample ID
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. BARCODE-49821"
                    value={formLabRef}
                    onChange={(e) => setFormLabRef(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
                  />
                </div>
              </div>

              {/* Collected Date & Expected Report Date */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Collected Date
                  </label>
                  <input
                    type="date"
                    value={formCollectedDate}
                    onChange={(e) => handleCollectedDateChange(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Expected Report Date
                  </label>
                  <input
                    type="date"
                    value={formExpectedDate}
                    onChange={(e) => setFormExpectedDate(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
                  />
                </div>
              </div>

              {/* Clinical Notes */}
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                  Clinical Indication / Instructions
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Excision of suspected pilonidal sinus wall. Rule out malignancy or fungal infection."
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    padding: '9px 16px',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    background: '#fff',
                    color: '#475569',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: '9px 20px',
                    borderRadius: 8,
                    background: '#4F46E5',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 13,
                    border: 'none',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    opacity: isSubmitting ? 0.7 : 1,
                  }}
                >
                  {isSubmitting ? 'Saving...' : 'Log Sample'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Mark Received */}
      {receiveTarget && (
        <div
          className="admin-drawer-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setReceiveTarget(null);
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 14,
              width: '100%',
              maxWidth: 460,
              padding: '24px 28px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: '#0F172A', fontWeight: 700 }}>
                Mark Report Received
              </h3>
              <button
                type="button"
                onClick={() => setReceiveTarget(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}
              >
                <IconCross />
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#475569', marginTop: 0, marginBottom: 16 }}>
              Confirm that the physical or digital report for{' '}
              <strong>{receiveTarget.sampleType}</strong> ({receiveTarget.patientName || 'Patient'}) has arrived from{' '}
              <strong>{receiveTarget.labName}</strong>.
            </p>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Received Date
              </label>
              <input
                type="date"
                value={receiveDate}
                onChange={(e) => setReceiveDate(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setReceiveTarget(null)}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMarkReceived}
                disabled={isSubmitting}
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  background: '#B45309',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  border: 'none',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                }}
              >
                {isSubmitting ? 'Updating...' : 'Confirm Received'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Doctor Review & Sign Off */}
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
              maxWidth: 540,
              padding: '24px 28px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: '#0F172A', fontWeight: 700 }}>
                Doctor Clinical Review &amp; Sign-Off
              </h3>
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}
              >
                <IconCross />
              </button>
            </div>

            <div style={{ background: '#F8FAFC', padding: '12px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
              <div>
                <strong>{reviewTarget.patientName || 'Patient'}</strong> &bull; {reviewTarget.sampleType} ({reviewTarget.site || 'Site unspec.'})
              </div>
              <div style={{ color: '#64748B', fontSize: 12, marginTop: 2 }}>
                Lab: {reviewTarget.labName} &bull; Ref: {reviewTarget.labReference || 'N/A'}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Result Summary / Diagnosis Findings <span style={{ color: '#DC2626' }}>*</span>
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Benign inflammatory granulation tissue consistent with chronic anal fissure. No dysplasia or malignancy."
                value={reviewResult}
                onChange={(e) => setReviewResult(e.target.value)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={reviewInformed}
                  onChange={(e) => setReviewInformed(e.target.checked)}
                />
                <span style={{ fontWeight: 500, color: '#1E293B' }}>
                  Patient has been informed of findings &amp; next clinical steps
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReviewSample}
                disabled={isSubmitting || !reviewResult.trim()}
                style={{
                  padding: '8px 20px',
                  borderRadius: 8,
                  background: '#059669',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  border: 'none',
                  cursor: isSubmitting || !reviewResult.trim() ? 'not-allowed' : 'pointer',
                  opacity: !reviewResult.trim() ? 0.6 : 1,
                }}
              >
                {isSubmitting ? 'Signing...' : 'Sign & Complete Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Upload Report PDF */}
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
              maxWidth: 460,
              padding: '24px 28px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 17, color: '#0F172A', fontWeight: 700 }}>
                Upload Pathology Report PDF
              </h3>
              <button
                type="button"
                onClick={() => setUploadTarget(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}
              >
                <IconCross />
              </button>
            </div>

            <p style={{ fontSize: 13, color: '#475569', marginTop: 0, marginBottom: 16 }}>
              Upload lab report for <strong>{uploadTarget.sampleType}</strong> ({uploadTarget.patientName || 'Patient'}).
            </p>

            <div style={{ marginBottom: 20 }}>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px dashed #CBD5E1',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
              <span style={{ display: 'block', fontSize: 11.5, color: '#64748B', marginTop: 4 }}>
                Supports PDF or clear image scan (Max 15MB)
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setUploadTarget(null)}
                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', fontSize: 13 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUploadReport}
                disabled={isSubmitting || !selectedFile}
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  background: '#4F46E5',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  border: 'none',
                  cursor: isSubmitting || !selectedFile ? 'not-allowed' : 'pointer',
                  opacity: !selectedFile ? 0.6 : 1,
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
