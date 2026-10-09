import { Router } from "express";
import { protect } from "../../middlewares/authMiddleware";
import { registerPushToken, unregisterPushToken } from "../../controllers/Device/deviceController";

const router = Router();

router.post("/register", protect, registerPushToken);
router.post("/unregister", protect, unregisterPushToken);
router.post("/push-token", protect, registerPushToken);
router.post("/push-token/unregister", protect, unregisterPushToken);

export default router;
