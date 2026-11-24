import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminRequest, type AdminTokenPayload } from '@/lib/adminAuth';
import {
  canReadPathology,
  canReceivePathology,
  canReviewPathology,
  canDeletePathology,
} from '@/lib/emrPermissions';
import { type Actor } from '@/lib/vitals';
import {
  getPathologySampleById,
  updatePathologySample,
  softDeletePathologySample,
} from '@/lib/pathology';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_ROLES: ('admin' | 'doctor' | 'receptionist')[] = ['admin', 'doctor', 'receptionist'];

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function actorOf(p: AdminTokenPayload): Actor {
  return { email: p.email, name: p.name, role: p.role };
}

// GET /api/admin/pathology/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = verifyAdminRequest(request, ALLOWED_ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  if (!canReadPathology(auth.payload.role)) {
    return fail('Your role does not have access to pathology records.', 403);
  }

  try {
    const sample = await getPathologySampleById(id);
    if (!sample) {
      return fail('Pathology sample not found.', 404);
    }
    return NextResponse.json({ sample });
  } catch (err) {
    console.error('[pathology] GET by id failed:', err);
    return fail('Failed to fetch sample.', 500);
  }
}

// PATCH /api/admin/pathology/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = verifyAdminRequest(request, ALLOWED_ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }

  try {
    const existing = await getPathologySampleById(id);
    if (!existing) {
      return fail('Pathology sample not found.', 404);
    }

    const body = await request.json();

    // Check specific permissions based on the update action
    const wantsReview = body.status === 'reviewed' || body.resultSummary !== undefined;
    const wantsReceive = body.status === 'received' || body.receivedDate !== undefined;

    if (wantsReview && !canReviewPathology(auth.payload.role)) {
      return fail('Only a doctor or clinic administrator can review pathology results.', 403);
    }

    if (wantsReceive && !canReceivePathology(auth.payload.role)) {
      return fail('Your role cannot update sample receipt status.', 403);
    }

    const updated = await updatePathologySample({
      existing,
      input: {
        sampleType: body.sampleType,
        site: body.site,
        collectedDate: body.collectedDate,
        labName: body.labName,
        labReference: body.labReference,
        expectedDate: body.expectedDate,
        status: body.status,
        receivedDate: body.receivedDate,
        resultSummary: body.resultSummary,
        patientInformed: body.patientInformed,
        notes: body.notes,
      },
      actor: actorOf(auth.payload),
    });

    return NextResponse.json({ sample: updated });
  } catch (err) {
    console.error('[pathology] PATCH failed:', err);
    return fail('Failed to update pathology sample.', 500);
  }
}

// DELETE /api/admin/pathology/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = verifyAdminRequest(request, ALLOWED_ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  if (!canDeletePathology(auth.payload.role)) {
    return fail('Only doctors and administrators can delete pathology records.', 403);
  }

  try {
    const existing = await getPathologySampleById(id);
    if (!existing) {
      return fail('Pathology sample not found.', 404);
    }

    await softDeletePathologySample(existing, actorOf(auth.payload));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[pathology] DELETE failed:', err);
    return fail('Failed to delete sample.', 500);
  }
}
