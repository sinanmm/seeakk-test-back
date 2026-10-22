import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  validateAudioFile,
  uploadCallRecording,
  buildRecordingStorageKey,
  getCanonicalAudioMime,
  ALLOWED_AUDIO_EXTENSIONS,
  ALLOWED_AUDIO_MIMES,
} from './callTracking.service';
import {
  getRecordingStreamOrUrl,
  streamRecording,
  getRecordingDiagnostic,
} from '../telephony/telephony.service';
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

test('10. Call session belonging to another lead throws 404', async () => {
  const leads = await (prisma as any).lead.findMany({
    where: { deletedAt: null },
    take: 2,
    select: { id: true, workspaceId: true },
  });

  if (leads.length < 2) return;

  const lead1 = leads[0];
  const lead2 = leads[1];

  const realUser = await (prisma as any).user.findFirst({
    where: { workspaceId: lead1.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!realUser) return;

  const session1 = await (prisma as any).leadCallSession.create({
    data: {
      workspaceId: lead1.workspaceId,
      leadId: lead1.id,
      initiatedById: realUser.id,
      phoneNumberSnapshot: '+919999999999',
      sourceContext: 'ALL_LEADS',
      localCallDate: '2026-10-18',
      status: 'COMPLETED',
    },
  });

  try {
    const dummyFile: any = {
      originalname: 'test.m4a',
      mimetype: 'audio/mp4',
      size: 512,
      buffer: Buffer.from([0x00, 0x00, 0x00, 0x20]),
    };

    // Attempt to upload to lead2 using session1 (which belongs to lead1)
    await assert.rejects(
      async () => {
        await uploadCallRecording({
          workspaceId: lead1.workspaceId,
          leadId: lead2.id,
          userId: realUser.id,
          callSessionId: session1.id,
          file: dummyFile,
        });
      },
      (err: any) => err.statusCode === 404,
    );
  } finally {
    await (prisma as any).leadCallSession.delete({ where: { id: session1.id } }).catch(() => {});
  }
});

test('11. Security Test: User A cannot upload to User B\'s call session', async () => {
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

  // Create or find a regular non-superadmin role
  const testRole =
    (await (prisma as any).role.findFirst({
      where: { workspaceId: realLead.workspaceId, isSystemRole: false, name: 'TEST_AGENT' },
    })) ||
    (await (prisma as any).role.create({
      data: {
        workspace: { connect: { id: realLead.workspaceId } },
        name: `TEST_AGENT_${Date.now()}`,
        status: 'ACTIVE',
      },
    }));

  const regularUserA = await (prisma as any).user.create({
    data: {
      name: 'Regular Agent A',
      email: `regular_agent_a_${Date.now()}@example.com`,
      workspace: { connect: { id: realLead.workspaceId } },
      role: { connect: { id: testRole.id } },
      isActive: true,
    },
  });

  // User B (realUser) initiates a call session
  const sessionB = await (prisma as any).leadCallSession.create({
    data: {
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      initiatedById: realUser.id,
      phoneNumberSnapshot: '+919999999999',
      sourceContext: 'ALL_LEADS',
      localCallDate: '2026-10-18',
      status: 'COMPLETED',
    },
  });

  try {
    const dummyFile: any = {
      originalname: 'userA_attempt.m4a',
      mimetype: 'audio/mp4',
      size: 512,
      buffer: Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
    };

    // User A attempts to upload to User B's session
    await assert.rejects(
      async () => {
        await uploadCallRecording({
          workspaceId: realLead.workspaceId,
          leadId: realLead.id,
          userId: regularUserA.id,
          callSessionId: sessionB.id,
          file: dummyFile,
        });
      },
      (err: any) => err.statusCode === 403,
    );
  } finally {
    await (prisma as any).leadCallSession.delete({ where: { id: sessionB.id } }).catch(() => {});
    await (prisma as any).user.delete({ where: { id: regularUserA.id } }).catch(() => {});
  }
});

test('12. Security Test: User A cannot play User B\'s recording without permission', async () => {
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

  const testRole =
    (await (prisma as any).role.findFirst({
      where: { workspaceId: realLead.workspaceId, isSystemRole: false, name: 'TEST_AGENT' },
    })) ||
    (await (prisma as any).role.create({
      data: {
        workspace: { connect: { id: realLead.workspaceId } },
        name: `TEST_AGENT_PLAY_${Date.now()}`,
        status: 'ACTIVE',
      },
    }));

  const regularUserA = await (prisma as any).user.create({
    data: {
      name: 'Regular Agent Play A',
      email: `regular_agent_play_${Date.now()}@example.com`,
      workspace: { connect: { id: realLead.workspaceId } },
      role: { connect: { id: testRole.id } },
      isActive: true,
    },
  });

  // Session owned by User B with recording available
  const session = await (prisma as any).leadCallSession.create({
    data: {
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      initiatedById: realUser.id,
      phoneNumberSnapshot: '+919999999999',
      sourceContext: 'ALL_LEADS',
      localCallDate: '2026-10-18',
      status: 'COMPLETED',
      recordingAvailable: true,
      recordingUrl: 'recordings/test/rec.m4a',
      recordingStatus: 'READY',
    },
  });

  try {
    // Regular User A who has no access to User B's session
    await assert.rejects(
      async () => {
        await getRecordingStreamOrUrl(realLead.workspaceId, regularUserA.id, session.id);
      },
      (err: any) => err.statusCode === 403,
    );
  } finally {
    await (prisma as any).leadCallSession.delete({ where: { id: session.id } }).catch(() => {});
    await (prisma as any).user.delete({ where: { id: regularUserA.id } }).catch(() => {});
  }
});

test('13. Cross-workspace playback isolation is enforced', async () => {
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

test('14. REAL END-TO-END TEST with Call recording +918606300137_261016_223731.m4a', async () => {
  const realLead = await (prisma as any).lead.findFirst({
    where: { deletedAt: null },
    select: { id: true, workspaceId: true, phone: true, name: true },
  });
  if (!realLead) return;

  const realUser = await (prisma as any).user.findFirst({
    where: { workspaceId: realLead.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!realUser) return;

  // Dedicated test session
  const testSession = await (prisma as any).leadCallSession.create({
    data: {
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      initiatedById: realUser.id,
      phoneNumberSnapshot: realLead.phone || '+918606300137',
      sourceContext: 'ALL_LEADS',
      localCallDate: '2026-10-18',
      status: 'COMPLETED',
      provider: 'DEVICE_DIALER',
      recordingAvailable: false,
    },
  });

  // Load real fixture audio
  const fixturePath = path.join(__dirname, 'fixtures', 'Call recording +918606300137_261016_223731.m4a');
  assert.ok(fs.existsSync(fixturePath), 'Real test recording fixture must exist');
  const realAudioBuffer = fs.readFileSync(fixturePath);
  assert.ok(realAudioBuffer.length > 0, 'Real audio buffer must not be empty');

  const realAudioFile: any = {
    originalname: 'Call recording +918606300137_261016_223731.m4a',
    mimetype: 'audio/mp4',
    size: realAudioBuffer.length,
    buffer: realAudioBuffer,
  };

  try {
    // 1. Mobile Upload Request
    const uploadRes = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: testSession.id,
      fileName: 'Call recording +918606300137_261016_223731.m4a',
      mimeType: 'audio/mp4',
      duration: 120,
      file: realAudioFile,
    });

    // 2. Validate upload response
    assert.equal(uploadRes.success, true);
    assert.equal(uploadRes.data?.recordingAvailable, true);
    assert.equal(uploadRes.data?.recordingStatus, 'READY');
    assert.equal(uploadRes.data?.recordingDuration, 120);
    assert.equal(uploadRes.data?.callSessionId, testSession.id);
    assert.ok(uploadRes.key);

    // 3. Verify PostgreSQL persistence
    const updatedSession = await (prisma as any).leadCallSession.findUnique({
      where: { id: testSession.id },
    });
    assert.equal(updatedSession.recordingAvailable, true);
    assert.equal(updatedSession.recordingStatus, 'READY');
    assert.equal(updatedSession.recordingDuration, 120);
    assert.ok(updatedSession.recordingUrl);

    // 4. Verify Wasabi object existence and metadata
    const { storage } = await import('../../lib/storage/storage.factory');
    if (typeof (storage as any).getObjectMetadata === 'function') {
      const meta = await (storage as any).getObjectMetadata(uploadRes.key);
      assert.equal(meta.exists, true, 'Object must exist in Wasabi bucket');
      assert.ok(meta.size > 0, 'Object size in Wasabi must be > 0');
      assert.equal(meta.contentType, 'audio/mp4', 'Object ContentType must match canonical audio/mp4');
    }

    // 5. Verify Lead History exposure
    const { getLeadHistory } = await import('../../controllers/User/leadController');
    let historyJson: any = null;
    const req: any = {
      user: { id: realUser.id, workspaceId: realLead.workspaceId },
      params: { id: realLead.id },
      headers: {},
    };
    const res: any = {
      status(code: number) {
        return {
          json(data: any) {
            historyJson = data;
          },
        };
      },
    };
    await getLeadHistory(req, res, () => {});
    assert.ok(historyJson?.success);
    const recEvent = historyJson.data.find(
      (e: any) => e.eventType === 'RECORDING_AVAILABLE' && e.metadata?.callSessionId === testSession.id,
    );
    assert.ok(recEvent, 'Lead history must expose RECORDING_AVAILABLE activity for this session');
    assert.equal(recEvent.metadata.recordingAvailable, true);
    assert.equal(recEvent.metadata.recordingStatus, 'READY');
    assert.equal(recEvent.metadata.recordingDuration, 120);

    // 6. Verify Playback API generates signed Wasabi URL
    const playback = await getRecordingStreamOrUrl(
      realLead.workspaceId,
      realUser.id,
      testSession.id,
    );
    assert.equal(playback.recordingAvailable, true);
    assert.ok(playback.url.startsWith('https://s3.wasabisys.com/geniusgroup/'));
    assert.ok(playback.url.includes('X-Amz-Signature='));

    // 7. Verify HTTP Range Streaming support
    const streamRes = await streamRecording(
      realLead.workspaceId,
      realUser.id,
      testSession.id,
      'bytes=0-1023',
    );
    assert.equal(streamRes.statusCode, 206, 'Byte range request must return 206 Partial Content');
    assert.ok(streamRes.contentRange?.startsWith('bytes 0-1023/'));
    assert.equal(streamRes.contentLength, 1024);
    assert.equal(streamRes.acceptRanges, 'bytes');

    // 8. Verify Diagnostic Endpoint
    const diag = await getRecordingDiagnostic(
      realLead.workspaceId,
      realUser.id,
      testSession.id,
    );
    assert.equal(diag.callSessionId, testSession.id);
    assert.equal(diag.recordingAvailable, true);
    assert.equal(diag.wasabiObjectExists, true);
    assert.equal(diag.playbackReady, true);
    assert.equal(diag.wasabiContentType, 'audio/mp4');

    // 9. Idempotency test: duplicate upload returns existing metadata without re-uploading
    const duplicateUpload = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: testSession.id,
      fileName: 'Call recording +918606300137_261016_223731.m4a',
      mimeType: 'audio/mp4',
      duration: 120,
      file: realAudioFile,
    });
    assert.equal(duplicateUpload.success, true);
    assert.equal(duplicateUpload.url, uploadRes.url);

  } finally {
    // Cleanup
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

test('15. Deterministic object key format is collision-safe and sanitized', () => {
  const key = buildRecordingStorageKey('ws_123', 'lead_456', 'session_789', '.M4A');
  assert.ok(key.includes('ws_123/lead_456/session_789/recording.m4a'));
  assert.ok(!key.includes('..'));

  const canonicalMime = getCanonicalAudioMime('.m4a', 'application/octet-stream');
  assert.equal(canonicalMime, 'audio/mp4');
});

test('16. Zero-byte audio file is rejected with 400', () => {
  const zeroByteFile: any = {
    originalname: 'empty.m4a',
    mimetype: 'audio/mp4',
    size: 0,
    buffer: Buffer.alloc(0),
  };
  const result = validateAudioFile(zeroByteFile);
  assert.equal(result.valid, false);
  assert.equal(result.statusCode, 400);
  assert.equal(result.error, 'Empty audio file provided.');
});

test('17. Missing callSessionId creates authentic incoming/sessionless call session and uploads successfully', async () => {
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

  const fixturePath = path.join(__dirname, 'fixtures', 'Call recording +918606300137_261016_223731.m4a');
  const buffer = fs.readFileSync(fixturePath);
  const audioFile: any = {
    originalname: 'Call recording +918606300137_261016_223731.m4a',
    mimetype: 'audio/mp4',
    size: buffer.length,
    buffer,
  };

  let createdSessionId: string | null = null;
  try {
    const res = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: null,
      direction: 'INCOMING',
      fileName: 'Call recording +918606300137_261016_223731.m4a',
      mimeType: 'audio/mp4',
      duration: 35,
      file: audioFile,
    });

    assert.equal(res.success, true);
    assert.ok(res.callSessionId, 'Must generate and return authentic callSessionId');
    assert.equal(res.leadId, realLead.id);
    assert.equal(res.recordingAvailable, true);
    assert.equal(res.recordingStatus, 'READY');
    assert.equal(res.recordingDuration, 35);
    createdSessionId = res.callSessionId;

    const dbSession = await (prisma as any).leadCallSession.findUnique({
      where: { id: res.callSessionId },
    });
    assert.ok(dbSession, 'Database callSession must exist');
    assert.equal(dbSession.direction, 'INBOUND');
    assert.equal(dbSession.provider, 'DEVICE_DIALER');
    assert.equal(dbSession.recordingAvailable, true);

    const activity = await (prisma as any).leadActivity.findFirst({
      where: {
        leadId: realLead.id,
        workspaceId: realLead.workspaceId,
        action: 'RECORDING_AVAILABLE',
        metadata: { path: ['callSessionId'], equals: res.callSessionId },
      },
    });
    assert.ok(activity, 'RECORDING_AVAILABLE activity must be generated');
    assert.equal(activity.metadata?.direction, 'INCOMING');

    // Idempotent retry of same sessionless file returns existing record
    const retryRes = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: null,
      file: audioFile,
    });
    assert.equal(retryRes.success, true);
    assert.equal(retryRes.callSessionId, createdSessionId);
  } finally {
    if (createdSessionId) {
      await (prisma as any).leadActivity.deleteMany({
        where: {
          leadId: realLead.id,
          workspaceId: realLead.workspaceId,
          action: 'RECORDING_AVAILABLE',
          metadata: { path: ['callSessionId'], equals: createdSessionId },
        },
      }).catch(() => {});
      await (prisma as any).leadCallSession.delete({
        where: { id: createdSessionId },
      }).catch(() => {});
    }
  }
});

test('18. Successful upload returns deterministic contract with top-level fields', async () => {
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

  const session = await (prisma as any).leadCallSession.create({
    data: {
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      initiatedById: realUser.id,
      phoneNumberSnapshot: realLead.phone || '+919999999999',
      sourceContext: 'ALL_LEADS',
      localCallDate: '2026-10-18',
      status: 'COMPLETED',
      provider: 'DEVICE_DIALER',
      recordingAvailable: false,
    },
  });

  const fixturePath = path.join(__dirname, 'fixtures', 'Call recording +918606300137_261016_223731.m4a');
  const buffer = fs.readFileSync(fixturePath);
  const audioFile: any = {
    originalname: 'Call recording +918606300137_261016_223731.m4a',
    mimetype: 'audio/mp4',
    size: buffer.length,
    buffer,
  };

  try {
    const res = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: session.id,
      fileName: 'Call recording +918606300137_261016_223731.m4a',
      mimeType: 'audio/mp4',
      duration: 41,
      file: audioFile,
    });

    assert.equal(res.success, true);
    assert.equal(res.callSessionId, session.id);
    assert.equal(res.leadId, realLead.id);
    assert.equal(res.recordingAvailable, true);
    assert.equal(res.recordingStatus, 'READY');
    assert.equal(res.recordingDuration, 41);

    // Also idempotent retry contract
    const retryRes = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: session.id,
      file: audioFile,
    });

    assert.equal(retryRes.success, true);
    assert.equal(retryRes.callSessionId, session.id);
    assert.equal(retryRes.leadId, realLead.id);
    assert.equal(retryRes.recordingAvailable, true);
    assert.equal(retryRes.recordingStatus, 'READY');
    assert.equal(retryRes.recordingDuration, 41);
  } finally {
    await (prisma as any).leadActivity.deleteMany({
      where: {
        leadId: realLead.id,
        workspaceId: realLead.workspaceId,
        action: 'RECORDING_AVAILABLE',
        metadata: { path: ['callSessionId'], equals: session.id },
      },
    }).catch(() => {});
    await (prisma as any).leadCallSession.delete({
      where: { id: session.id },
    }).catch(() => {});
  }
});


test('19. Genuinely concurrent identical sessionless uploads result in exactly one logical recording', async () => {
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

  const fixturePath = path.join(__dirname, 'fixtures', 'Call recording +918606300137_261016_223731.m4a');
  const buffer = fs.readFileSync(fixturePath);

  // Send 3 genuinely concurrent identical uploads
  const uploadPromises = [1, 2, 3].map((idx) =>
    uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: null,
      direction: 'INCOMING',
      fileName: 'Call recording +918606300137_261016_223731.m4a',
      mimeType: 'audio/mp4',
      duration: 35,
      file: {
        originalname: 'Call recording +918606300137_261016_223731.m4a',
        mimetype: 'audio/mp4',
        size: buffer.length,
        buffer,
      } as any,
    })
  );

  const results = await Promise.all(uploadPromises);

  // All 3 concurrent calls must succeed
  for (const res of results) {
    assert.equal(res.success, true);
    assert.equal(res.leadId, realLead.id);
    assert.equal(res.recordingAvailable, true);
    assert.equal(res.recordingStatus, 'READY');
  }

  // All 3 calls must return the exact same canonical callSessionId and storageKey / url
  const canonicalSessionId = results[0].callSessionId;
  assert.ok(canonicalSessionId, 'Must have a valid canonical session ID');
  assert.equal(results[1].callSessionId, canonicalSessionId, 'Concurrent call 2 must share canonicalSessionId');
  assert.equal(results[2].callSessionId, canonicalSessionId, 'Concurrent call 3 must share canonicalSessionId');
  assert.equal(results[1].url, results[0].url, 'Concurrent call 2 must share url');
  assert.equal(results[2].url, results[0].url, 'Concurrent call 3 must share url');

  // Verify database has exactly 1 RECORDING_AVAILABLE activity for this fileHash on this lead
  const activities = await (prisma as any).leadActivity.findMany({
    where: {
      leadId: realLead.id,
      workspaceId: realLead.workspaceId,
      action: 'RECORDING_AVAILABLE',
      metadata: { path: ['callSessionId'], equals: canonicalSessionId },
    },
  });
  assert.equal(activities.length, 1, 'Exactly one Lead History RECORDING_AVAILABLE event must exist');

  // Cleanup
  await (prisma as any).leadActivity.deleteMany({
    where: {
      leadId: realLead.id,
      workspaceId: realLead.workspaceId,
      action: 'RECORDING_AVAILABLE',
      metadata: { path: ['callSessionId'], equals: canonicalSessionId },
    },
  }).catch(() => {});
  await (prisma as any).leadCallSession.delete({
    where: { id: canonicalSessionId },
  }).catch(() => {});
});


test('20. Safe retry recovery: reuses PENDING or FAILED reservation session without duplicate', async () => {
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

  // Simulate a previous aborted upload that left a session in PENDING state
  const abortedSession = await (prisma as any).leadCallSession.create({
    data: {
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      initiatedById: realUser.id,
      phoneNumberSnapshot: realLead.phone || '+910000000000',
      sourceContext: 'RECORDING_IMPORT',
      localCallDate: '2026-10-22',
      status: 'COMPLETED',
      provider: 'DEVICE_DIALER',
      direction: 'INBOUND',
      recordingAvailable: false,
      recordingStatus: 'PENDING',
    },
  });

  const fixturePath = path.join(__dirname, 'fixtures', 'Call recording +918606300137_261016_223731.m4a');
  const buffer = fs.readFileSync(fixturePath);

  try {
    // Attempt upload - should reuse the pending session instead of creating a second one
    const res = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: null,
      direction: 'INCOMING',
      fileName: 'Call recording +918606300137_261016_223731.m4a',
      mimeType: 'audio/mp4',
      duration: 35,
      file: {
        originalname: 'Call recording +918606300137_261016_223731.m4a',
        mimetype: 'audio/mp4',
        size: buffer.length,
        buffer,
      } as any,
    });

    assert.equal(res.success, true);
    assert.equal(res.callSessionId, abortedSession.id, 'Must reuse the aborted reservation session');
    assert.equal(res.recordingStatus, 'READY');

    // Confirm session is now READY in database
    const updated = await (prisma as any).leadCallSession.findUnique({
      where: { id: abortedSession.id },
    });
    assert.equal(updated.recordingStatus, 'READY');
    assert.equal(updated.recordingAvailable, true);
  } finally {
    await (prisma as any).leadActivity.deleteMany({
      where: {
        leadId: realLead.id,
        workspaceId: realLead.workspaceId,
        action: 'RECORDING_AVAILABLE',
        metadata: { path: ['callSessionId'], equals: abortedSession.id },
      },
    }).catch(() => {});
    await (prisma as any).leadCallSession.delete({
      where: { id: abortedSession.id },
    }).catch(() => {});
  }
});

test('21. Two distinct calls with different audio bytes remain completely separate', async () => {
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

  const fixturePath = path.join(__dirname, 'fixtures', 'Call recording +918606300137_261016_223731.m4a');
  const buffer1 = fs.readFileSync(fixturePath);
  // Modify 1 byte to produce a distinct valid audio file with distinct hash
  const buffer2 = Buffer.from(buffer1);
  buffer2[buffer2.length - 1] = (buffer2[buffer2.length - 1] ^ 0xff);

  let session1Id: string | null = null;
  let session2Id: string | null = null;

  try {
    const res1 = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: null,
      direction: 'INCOMING',
      fileName: 'Call_1.m4a',
      mimeType: 'audio/mp4',
      duration: 30,
      file: {
        originalname: 'Call_1.m4a',
        mimetype: 'audio/mp4',
        size: buffer1.length,
        buffer: buffer1,
      } as any,
    });
    session1Id = res1.callSessionId;

    const res2 = await uploadCallRecording({
      workspaceId: realLead.workspaceId,
      leadId: realLead.id,
      userId: realUser.id,
      callSessionId: null,
      direction: 'INCOMING',
      fileName: 'Call_2.m4a',
      mimeType: 'audio/mp4',
      duration: 45,
      file: {
        originalname: 'Call_2.m4a',
        mimetype: 'audio/mp4',
        size: buffer2.length,
        buffer: buffer2,
      } as any,
    });
    session2Id = res2.callSessionId;

    assert.notEqual(session1Id, session2Id, 'Distinct calls must have distinct session IDs');
    assert.notEqual(res1.url, res2.url, 'Distinct calls must have distinct storage keys');
  } finally {
    if (session1Id) {
      await (prisma as any).leadActivity.deleteMany({
        where: { metadata: { path: ['callSessionId'], equals: session1Id } },
      }).catch(() => {});
      await (prisma as any).leadCallSession.delete({
        where: { id: session1Id },
      }).catch(() => {});
    }
    if (session2Id) {
      await (prisma as any).leadActivity.deleteMany({
        where: { metadata: { path: ['callSessionId'], equals: session2Id } },
      }).catch(() => {});
      await (prisma as any).leadCallSession.delete({
        where: { id: session2Id },
      }).catch(() => {});
    }
  }
});

test.after(async () => {
  try {
    const { redisClient } = await import('../../config/redis');
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch {}
  await prisma.$disconnect().catch(() => {});
  setTimeout(() => process.exit(0), 500).unref();
});

