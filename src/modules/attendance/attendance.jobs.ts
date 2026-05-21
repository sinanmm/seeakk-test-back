import { autoAbsentMarking } from './attendance.service';
import prisma from '../../config/prisma';
import logger from '../../utils/logger';

export const startAttendanceJobs = () => {
  logger.info('Starting Attendance scheduler jobs (auto absent & holiday evaluations)...');
  
  // Run auto absent marking check every hour
  const intervalMs = 60 * 60 * 1000; // 1 hour
  
  const runJob = async () => {
    try {
      const workspaces = await prisma.workspace.findMany({ select: { id: true } });
      for (const ws of workspaces) {
        await autoAbsentMarking(ws.id);
      }
    } catch (err: any) {
      logger.error('Error in Attendance auto absent marking scheduler:', { error: err.message });
    }
  };

  setInterval(runJob, intervalMs);
  
  // Trigger once at startup after a short delay
  setTimeout(runJob, 10000);
};
