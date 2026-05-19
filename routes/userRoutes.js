// routers/user.router.js
import { Router } from "express";
import {
  login,
  register,
  refresh,
  logout,
  sendOtp,
  verifyOtp,
  getProfile,
  updateProfile,
  uploadAvatar,   
  listPrefs,
  upsertPreference,
  removePreference,
  deleteAccount,
} from "../controllers/userController.js";
import { authenticate } from "../libs/auth.js";
// import { uploadAvatar } from "../middleware/uploadAvatar.js";
import { User } from "../models/User.js";
import redisClient from "../libs/redis.js";
import { sendMail } from "../utils/mailer.js"

const router = Router();

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post("/register", register);
router.post("/login",    login);
router.post("/refresh",  refresh);
router.post("/logout",   logout);

// ── OTP ───────────────────────────────────────────────────────────────────────
router.post("/send-otp",   sendOtp);
router.post("/verify-otp", verifyOtp);

// ── Profile (protected) ───────────────────────────────────────────────────────
router.get(    "/profile", authenticate, getProfile);
router.put(    "/profile", authenticate, updateProfile);
router.delete( "/profile", authenticate, deleteAccount);

// ── Preferences (protected) ───────────────────────────────────────────────────
router.get(    "/prefs",      authenticate, listPrefs);
router.post(   "/prefs",      authenticate, upsertPreference);
router.delete( "/prefs/:key", authenticate, removePreference);

router.post("/avatar", authenticate, uploadAvatar); 

// ── Expo Push Token (protected) ───────────────────────────────────────────────
// NOW  (Expo Go / development): stores expoPushTokens[]
// LATER (production EAS build): rename to /fcm-token, field becomes fcmTokens[]

// Register / refresh token — call on every app launch + token rotation
router.post("/expo-push-token", authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token?.trim()) {
      return res.status(400).json({ error: "Token is required" });
    }

    const isValid =
      token.startsWith("ExponentPushToken[") ||
      token.startsWith("ExpoPushToken[");

    if (!isValid) {
      return res.status(400).json({ error: "Invalid Expo push token format" });
    }

    // $addToSet prevents duplicate tokens per user (multi-device support)
    await User.findByIdAndUpdate(req.user.id, {
      $addToSet: { expoPushTokens: token.trim() },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[user.router] register expo token:", err);
    res.status(500).json({ error: err.message });
  }
});

// Remove token — call on logout so notifications stop on this device
router.delete("/expo-push-token", authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token is required" });

    await User.findByIdAndUpdate(req.user.id, {
      $pull: { expoPushTokens: token },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("[user.router] remove expo token:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Online status (protected) ─────────────────────────────────────────────────
// Accepts { userIds: string[] }, returns { userId: boolean } map.
// Used by screens that need online dots without an active socket connection.
router.post("/online-status", authenticate, async (req, res) => {
  try {
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "userIds must be a non-empty array" });
    }

    // Cap to 50 per request
    const ids     = userIds.slice(0, 50);
    const results = await Promise.all(
      ids.map((id) => redisClient.get(`online:${id}`))
    );

    const statuses = Object.fromEntries(
      ids.map((id, i) => [id, !!results[i]])
    );

    res.json(statuses);
  } catch (err) {
    console.error("[user.router] online-status:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/test-email", async (req, res) => {
  try {
    await sendMail({
      to: "fizatariq953@gmail.com",
      subject: "Test",
      html: "<p>OTP mailer is working</p>",
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

// ─────────────────────────────────────────────────────────────────────────────
// REMEMBER: add expoPushTokens to your User model if not already there:
//
//   expoPushTokens: { type: [String], default: [] }
//
// When going to production with Firebase, also add:
//
//   fcmTokens: { type: [String], default: [] }
//
// Both can coexist so Expo Go and production builds work side-by-side.
// ─────────────────────────────────────────────────────────────────────────────