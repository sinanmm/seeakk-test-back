import logger from '../../utils/logger';
import { runTargetLockingEvaluation } from './targetPerformance.service';
import { processDueTargetReEvaluations } from './targetReEvaluationJob.service';

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export const startTargetPerformanceJobs = () => {
  const run = async () => {
    try {
      await runTargetLockingEvaluation();
      await processDueTargetReEvaluations();
    } catch (error) {
      logger.error('Target locking evaluation / re-evaluation failed', { error });
    }
  };

  void run();
  intervalHandle = setInterval(run, 60 * 60 * 1000);
  logger.info('Target performance jobs scheduled (hourly locking evaluation & grace re-evaluation)');
};

export const stopTargetPerformanceJobs = () => {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
};
