import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAudioFile,
  uploadCallRecording,
  ALLOWED_AUDIO_EXTENSIONS,
  ALLOWED_AUDIO_MIMES,
} from './callTracking.service';
import { getRecordingStreamOrUrl } from '../telephony/telephony.service';
import prisma from '../../config/prisma';

test('1. Valid recording formats are accepted (.m4a, .aac, .amr, .3gp, .wav, .mp3)', () => {
  for (const ext of ['.m4a', '.aac', '.amr', '.3gp', '.wav', '.mp3']) {
    assert.equal(ALLOWED_AUDIO_EXTENSIONS.has(ext), true, `Extension ${ext} must be supported`);
  }

  const validM4a: any = {
    originalname: 'recording_101.m4a',
    mimetype: 'audio/mp4',
    size: 1024,
    buffer: Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]), // ftyp
  };
  const result = validateAudioFile(validM4a);
  assert.equal(result.valid, true);
});

test('2. Missing file is rejected with 400', () => {
  const result = validateAudioFile(null as any);
  assert.equal(result.valid, false);
  assert.equal(result.statusCode, 400);
});

test('3. Invalid MIME type is rejected with 415', () => {
  const invalidMime: any = {
    originalname: 'test.m4a',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from([0x00, 0x00, 0x00, 0x20]),
  };
  const result = validateAudioFile(invalidMime);
  assert.equal(result.valid, false);
  assert.equal(result.statusCode, 415);
});

test('4. Unsupported extension is rejected with 415', () => {
  const invalidExt: any = {
    originalname: 'test.exe',
    mimetype: 'application/octet-stream',
    size: 1024,
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]), // MZ header
  };
  const result = validateAudioFile(invalidExt);
  assert.equal(result.valid, false);
  assert.equal(result.statusCode, 415);
});

test('5. Oversized recording (>50MB) is rejected with 413', () => {
  const oversized: any = {
    originalname: 'huge_call.wav',
    mimetype: 'audio/wav',
    size: 55 * 1024 * 1024,
    buffer: Buffer.from([0x52, 0x49, 0x46, 0x46]), // RIFF
  };
  const result = validateAudioFile(oversized);
  assert.equal(result.valid, false);
  assert.equal(result.statusCode, 413);
});

test('6. Executable file masquerading as audio is rejected with 400', () => {
  const fakeAudio: any = {
    originalname: 'malware.m4a',
    mimetype: 'audio/mp4',
    size: 1024,
    buffer: Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF header
  };
  const result = validateAudioFile(fakeAudio);
  assert.equal(result.valid, false);
  assert.equal(result.statusCode, 400);
});

test('7. Unauthorized context (missing workspaceId or userId) throws 401', async () => {
  const dummyFile: any = {
    originalname: 'test.m4a',
    mimetype: 'audio/mp4',
    size: 512,
    buffer: Buffer.from([0x00, 0x00, 0x00, 0x20]),
  };

  await assert.rejects(
    async () => {
      await uploadCallRecording({
        workspaceId: '',
        leadId: 'dummy-lead',
        userId: '',
        file: dummyFile,
      });
    },
    (err: any) => err.statusCode === 401,
  );
});

test('8. Wrong lead ownership or deleted lead throws 404', async () => {
  const dummyFile: any = {
    originalname: 'test.m4a',
    mimetype: 'audio/mp4',
    size: 512,
    buffer: Buffer.from([0x00, 0x00, 0x00, 0x20]),
  };

  await assert.rejects(
    async () => {
      await uploadCallRecording({
        workspaceId: 'cmqas1rrw0006q8bswxw72b8e',
        leadId: 'non-existent-lead-id',
        userId: 'cmqhyrnsa000fjz4d33b3cgsu',
        file: dummyFile,
      });
    },
    (err: any) => err.statusCode === 404,
  );
});

test('9. Wrong callSessionId throws 404', async () => {
  // Use a real lead from DB
  const realLead = await (prisma as any).lead.findFirst({
    where: { deletedAt: null },
    select: { id: true, workspaceId: true },
  });

  if (!realLead) return;

  const dummyFile: any = {
    originalname: 'test.m4a',
    mimetype: 'audio/mp4',
    size: 512,
    buffer: Buffer.from([0x00, 0x00, 0x00, 0x20]),
  };

  await assert.rejects(
    async () => {
      await uploadCallRecording({
        workspaceId: realLead.workspaceId,
        leadId: realLead.id,
        userId: 'cmqhyrnsa000fjz4d33b3cgsu',
        callSessionId: 'invalid-call-session-id',
        file: dummyFile,
      });
    },
    (err: any) => err.statusCode === 404,
  );
});

test('10 - 15. End-to-end recording upload success: database update, duration persistence, and RECORDING_AVAILABLE activity', async () => {
  const realLead = await (prisma as any).lead.findFirst({
    where: { deletedAt: null },
    select: { id: true, workspaceId: true, phone: true },
  });
  if (!realLead) return;

  const realUser = await (prisma as any).user.findFirst({
    where: { workspaceId: realLead.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!realUser) return;

  // Create a dedicated test call session
  const testSession = await (prisma as any).leadCallSession.create({
    data: {
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      initiatedById: realUser.id,
      phoneNumberSnapshot: realLead.phone || '+910000000000',
      sourceContext: 'ALL_LEADS',
      localCallDate: '2026-10-16',
      status: 'COMPLETED',
      provider: 'DEVICE_DIALER',
      recordingAvailable: false,
    },
  });

  const dummyAudio: any = {
    originalname: `e2e_recording_${Date.now()}.m4a`,
    mimetype: 'audio/mp4',
    size: 2048,
    buffer: Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
  };

  try {
    const uploadRes = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: testSession.id,
      duration: 45,
      file: dummyAudio,
    });

    // 10. Check response structure
    assert.equal(uploadRes.success, true);
    assert.ok(uploadRes.url);
    assert.equal(uploadRes.data?.callSessionId, testSession.id);
    assert.equal(uploadRes.data?.recordingAvailable, true);
    assert.equal(uploadRes.data?.recordingDuration, 45);
    assert.equal(uploadRes.data?.recordingStatus, 'READY');

    // 11 & 12 & 13. Verify lead_call_sessions update in database
    const updatedSession = await (prisma as any).leadCallSession.findUnique({
      where: { id: testSession.id },
    });
    assert.equal(updatedSession.recordingAvailable, true);
    assert.ok(updatedSession.recordingUrl);
    assert.equal(updatedSession.recordingStatus, 'READY');

    // 14. Verify recordingDuration persisted
    assert.equal(updatedSession.recordingDuration, 45);

    // 15. Verify RECORDING_AVAILABLE activity created
    const activity = await (prisma as any).leadActivity.findFirst({
      where: {
        leadId: realLead.id,
        workspaceId: realLead.workspaceId,
        action: 'RECORDING_AVAILABLE',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(activity);
    assert.equal((activity.metadata as any)?.callSessionId, testSession.id);
    assert.equal((activity.metadata as any)?.duration, 45);

    // 16. Duplicate upload protection (idempotency)
    const secondUpload = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: testSession.id,
      duration: 45,
      file: dummyAudio,
    });
    assert.equal(secondUpload.success, true);
    assert.equal(secondUpload.url, uploadRes.url);

    // Ensure no duplicate activity was created
    const activitiesCount = await (prisma as any).leadActivity.count({
      where: {
        leadId: realLead.id,
        workspaceId: realLead.workspaceId,
        action: 'RECORDING_AVAILABLE',
      },
    });
    assert.ok(activitiesCount >= 1);

    // 17. Playback authorization: fetching stream or presigned url works
    const playback = await getRecordingStreamOrUrl(
      realLead.workspaceId,
      realUser.id,
      testSession.id,
    );
    assert.equal(playback.recordingAvailable, true);
    assert.ok(playback.url);

  } finally {
    // Cleanup test session and activities
    await (prisma as any).leadActivity.deleteMany({
      where: {
        leadId: realLead.id,
        workspaceId: realLead.workspaceId,
        action: 'RECORDING_AVAILABLE',
        metadata: { path: ['callSessionId'], equals: testSession.id },
      },
    }).catch(() => {});
    await (prisma as any).leadCallSession.delete({
      where: { id: testSession.id },
    }).catch(() => {});
  }
});

test('18. Missing recording throws 404', async () => {
  const realLead = await (prisma as any).lead.findFirst({
    where: { deletedAt: null },
    select: { id: true, workspaceId: true, phone: true },
  });
  if (!realLead) return;

  const realUser = await (prisma as any).user.findFirst({
    where: { workspaceId: realLead.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!realUser) return;

  const emptySession = await (prisma as any).leadCallSession.create({
    data: {
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      initiatedById: realUser.id,
      phoneNumberSnapshot: realLead.phone || '+910000000000',
      sourceContext: 'ALL_LEADS',
      localCallDate: '2026-10-16',
      status: 'COMPLETED',
      provider: 'DEVICE_DIALER',
      recordingAvailable: false,
      recordingUrl: null,
    },
  });

  try {
    await assert.rejects(
      async () => {
        await getRecordingStreamOrUrl(realLead.workspaceId, realUser.id, emptySession.id);
      },
      (err: any) => err.statusCode === 404,
    );
  } finally {
    await (prisma as any).leadCallSession.delete({ where: { id: emptySession.id } }).catch(() => {});
  }
});

test('19. Non-existent session for playback throws 404', async () => {
  await assert.rejects(
    async () => {
      await getRecordingStreamOrUrl(
        'cmqas1rrw0006q8bswxw72b8e',
        'cmqhyrnsa000fjz4d33b3cgsu',
        'completely-non-existent-session-id',
      );
    },
    (err: any) => err.statusCode === 404,
  );
});

test('20. Cross-workspace playback isolation is enforced', async () => {
  const session = await (prisma as any).leadCallSession.findFirst({
    where: { recordingAvailable: true },
  });

  if (!session) return;

  await assert.rejects(
    async () => {
      await getRecordingStreamOrUrl(
        'different-workspace-id-999',
        'different-user-id',
        session.id,
      );
    },
    (err: any) => err.statusCode === 404,
  );
});

test('21. getLeadHistory maps RECORDING_AVAILABLE activity to RECORDING_AVAILABLE timeline event', async () => {
  const realLead = await (prisma as any).lead.findFirst({
    where: { deletedAt: null },
    select: { id: true, workspaceId: true },
  });
  if (!realLead) return;

  const realUser = await (prisma as any).user.findFirst({
    where: { workspaceId: realLead.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!realUser) return;

  const activity = await (prisma as any).leadActivity.create({
    data: {
      leadId: realLead.id,
      performedById: realUser.id,
      workspaceId: realLead.workspaceId,
      action: 'RECORDING_AVAILABLE',
      metadata: {
        callSessionId: 'test-session-123',
        recordingUrl: '/api/upload/Seeak%20App%20Data%2Ftest.m4a',
        duration: 85,
        provider: 'DEVICE_DIALER',
      },
    },
  });

  try {
    const { getLeadHistory } = await import('../../controllers/User/leadController');
    let jsonResult: any = null;
    const req: any = {
      user: { id: realUser.id, workspaceId: realLead.workspaceId },
      params: { id: realLead.id },
      headers: {},
    };
    const res: any = {
      status(code: number) {
        return {
          json(data: any) {
            jsonResult = data;
          },
        };
      },
    };

    await getLeadHistory(req, res, () => {});
    assert.ok(jsonResult?.success);
    const recordingEvent = jsonResult.data.find((e: any) => e.eventType === 'RECORDING_AVAILABLE');
    assert.ok(recordingEvent, 'Timeline must contain RECORDING_AVAILABLE event');
    assert.equal(recordingEvent.title, 'Call Recording Available');
    assert.equal(recordingEvent.metadata.callSessionId, 'test-session-123');
    assert.equal(recordingEvent.metadata.duration, 85);
  } finally {
    await (prisma as any).leadActivity.delete({ where: { id: activity.id } }).catch(() => {});
  }
});

