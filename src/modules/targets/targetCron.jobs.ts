import logger from '../../utils/logger';
import { runTargetLockingEvaluation } from './targetPerformance.service';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export const startTargetPerformanceJobs = () => {
  const run = async () => {
    try {
      await runTargetLockingEvaluation();
    } catch (error) {
      logger.error('Target locking evaluation failed', { error });
    }
  };

  void run();
  intervalHandle = setInterval(run, 60 * 60 * 1000);
  logger.info('Target performance jobs scheduled (hourly locking evaluation)');
};

export const stopTargetPerformanceJobs = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};
