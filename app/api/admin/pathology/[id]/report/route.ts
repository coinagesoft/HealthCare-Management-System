import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { verifyAdminRequest, type AdminTokenPayload } from '@/lib/adminAuth';
import { canReadPathology, canRecordPathology } from '@/lib/emrPermissions';
import {
  getPathologySampleById,
  updatePathologySample,
  getPathologyUploadDir,
} from '@/lib/pathology';
import { type Actor } from '@/lib/vitals';

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

// POST /api/admin/pathology/[id]/report — upload local report file
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = verifyAdminRequest(request, ALLOWED_ROLES);
  if (!auth.authenticated || !auth.payload) {
    return fail(auth.error || 'Unauthorized access.', auth.statusCode || 401);
  }
  if (!canRecordPathology(auth.payload.role)) {
    return fail('Your role cannot upload pathology reports.', 403);
  }

  try {
    const existing = await getPathologySampleById(id);
    if (!existing) {
      return fail('Pathology sample not found.', 404);
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return fail('No file was uploaded.', 400);
    }

    // Limit to 15MB
    if (file.size > 15 * 1024 * 1024) {
      return fail('File size exceeds the 15MB limit.', 400);
    }

    const originalName = file.name || 'report.pdf';
    const ext = path.extname(originalName).toLowerCase() || '.pdf';
    const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];
    if (!allowedExts.includes(ext)) {
      return fail('Only PDF and image files (JPG, PNG) are allowed for pathology reports.', 400);
    }

    // Save to local storage folder
    const uploadDir = getPathologyUploadDir();
    const safeFileName = `report_${existing.id}_${Date.now()}${ext}`;
    const destinationPath = path.join(uploadDir, safeFileName);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.promises.writeFile(destinationPath, buffer);

    // If there was an old file, optionally remove or keep it
    if (existing.reportFile && existing.reportFile !== safeFileName) {
      try {
        const oldPath = path.join(uploadDir, existing.reportFile);
        if (fs.existsSync(oldPath)) {
          await fs.promises.unlink(oldPath);
        }
      } catch (err) {
        console.warn('[pathology] Failed to clean up old report file:', err);
      }
    }

    const updated = await updatePathologySample({
      existing,
      input: {
        reportFile: safeFileName,
        reportOriginalName: originalName,
      },
      actor: actorOf(auth.payload),
    });

    return NextResponse.json({
      success: true,
      sample: updated,
    });
  } catch (err) {
    console.error('[pathology] Report upload failed:', err);
    return fail('Failed to upload pathology report.', 500);
  }
}

// GET /api/admin/pathology/[id]/report — download / stream report file
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
    return fail('Your role does not have access to view pathology reports.', 403);
  }

  try {
    const sample = await getPathologySampleById(id);
    if (!sample || !sample.reportFile) {
      return fail('Report file not found for this sample.', 404);
    }

    const uploadDir = getPathologyUploadDir();
    const filePath = path.join(uploadDir, sample.reportFile);

    // Prevent directory traversal
    if (!filePath.startsWith(uploadDir) || !fs.existsSync(filePath)) {
      return fail('Report file does not exist on the server.', 404);
    }

    const fileBuffer = await fs.promises.readFile(filePath);
    const ext = path.extname(sample.reportFile).toLowerCase();

    let contentType = 'application/pdf';
    if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.png') contentType = 'image/png';

    const safeDownloadName = (sample.reportOriginalName || `Pathology_${sample.sampleType}.pdf`)
      .replace(/[^\w.-]/g, '_');

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${safeDownloadName}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[pathology] Report download failed:', err);
    return fail('Failed to retrieve report file.', 500);
  }
}
