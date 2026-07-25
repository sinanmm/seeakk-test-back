import { Router } from 'express';
import { checkPermission, checkAnyPermission } from '../../middlewares/authMiddleware';
import * as controller from './salary.controller';

const router = Router();

// ─── SALARY CALCULATION ROUTES ───────────────────────────────────────────────
router.get(
  '/calculation',
  checkAnyPermission(['SALARY_CALCULATION_VIEW', 'SALARY_CALCULATION_GENERATE']),
  controller.listCalculations,
);
router.post(
  '/calculation/generate',
  checkPermission('SALARY_CALCULATION_GENERATE'),
  controller.generateSalary,
);
router.post(
  '/calculation/submit',
  checkPermission('SALARY_CALCULATION_GENERATE'),
  controller.submitSalaryForApproval,
);
router.put(
  '/calculation/:id',
  checkPermission('SALARY_CALCULATION_EDIT'),
  controller.updateCalculation,
);
router.delete(
  '/calculation/:id',
  checkPermission('SALARY_CALCULATION_DELETE'),
  controller.deleteCalculation,
);

// ─── APPROVAL STAGES ROUTES ──────────────────────────────────────────────────
router.get(
  '/stages',
  checkAnyPermission(['SALARY_STAGES_VIEW', 'SALARY_STAGES_CREATE', 'SALARY_STAGES_EDIT', 'SALARY_STAGES_DELETE']),
  controller.listStages,
);
router.post(
  '/stages',
  checkPermission('SALARY_STAGES_CREATE'),
  controller.createStage,
);
router.put(
  '/stages/reorder',
  checkPermission('SALARY_STAGES_EDIT'),
  controller.reorderStages,
);
router.put(
  '/stages/setting',
  checkPermission('SALARY_STAGES_EDIT'),
  controller.updateReleaseSetting,
);
router.put(
  '/stages/:id',
  checkPermission('SALARY_STAGES_EDIT'),
  controller.updateStage,
);
router.delete(
  '/stages/:id',
  checkPermission('SALARY_STAGES_DELETE'),
  controller.deleteStage,
);

// ─── PENDING APPROVALS ROUTES ────────────────────────────────────────────────
router.get(
  '/approvals/pending',
  checkAnyPermission(['SALARY_APPROVALS_VIEW', 'SALARY_APPROVALS_APPROVE']),
  controller.listPendingApprovals,
);
router.post(
  '/approvals/:id/action',
  checkAnyPermission(['SALARY_APPROVALS_APPROVE', 'SALARY_APPROVALS_REJECT', 'SALARY_APPROVALS_RETURN']),
  controller.processApproval,
);
router.put(
  '/approvals/:id/edit',
  checkPermission('SALARY_APPROVALS_EDIT'),
  controller.editSalaryBeforeApproval,
);

// ─── AUDIT HISTORY ────────────────────────────────────────────────────────────
router.get(
  '/:id/history',
  checkAnyPermission(['SALARY_CALCULATION_VIEW', 'SALARY_APPROVALS_VIEW', 'SALARY_APPROVALS_APPROVE']),
  controller.getHistory,
);

export default router;
