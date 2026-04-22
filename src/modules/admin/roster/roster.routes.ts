import { Router } from 'express';
import { checkPermission, protect } from '../../../middlewares/authMiddleware';
import * as rosterController from './roster.controller';

const router = Router();

router.use(protect);

router.get('/users', checkPermission('USERS_VIEW'), rosterController.listRosterUsers);
router.post('/bulk/department', checkPermission('USERS_EDIT'), rosterController.bulkAssignDepartment);

router.post('/', checkPermission('USERS_EDIT'), rosterController.createRosterEntry);
router.get('/:userId', checkPermission('USERS_VIEW'), rosterController.getUserRosterEntries);
router.put('/:id', checkPermission('USERS_EDIT'), rosterController.updateRosterEntry);
router.delete('/:id', checkPermission('USERS_DELETE'), rosterController.deleteRosterEntry);

export default router;
