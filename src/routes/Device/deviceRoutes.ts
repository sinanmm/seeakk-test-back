import { Router } from "express";
import { protect } from "../../middlewares/authMiddleware";
import { registerPushToken, unregisterPushToken, testFollowupPush } from "../../controllers/Device/deviceController";

const router = Router();

router.post("/register", protect, registerPushToken);
router.post("/unregister", protect, unregisterPushToken);
router.post("/push-token", protect, registerPushToken);
router.post("/push-token/unregister", protect, unregisterPushToken);
router.post("/test-followup-push/:followUpId", protect, testFollowupPush);

export default router;
