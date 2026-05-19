// controllers/user.controller.js
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import fs from "fs-extra";
import path from "path";
import sharp from "sharp";

import { generateOtp } from "../utils/otp.js";
import { sendMail } from "../utils/mailer.js";

import {
  createOtp,
  findValidOtp,
  findValidOtpByCode,
  markOtpUsed
} from "../models/otp.model.js";

import {
  createPending,
  findPendingById,
  findPendingByEmail,
  deletePendingById
} from "../models/pendingRegistration.model.js";

import {
  createUser,
  getUserById,
  updateUser,
  findByEmail
} from "../models/User.js";

import {
  loginUser,
  refreshAuth,
  logoutUser
} from "../services/user.service.js";

import {
  getPrefsByUser,
  upsertPref,
  deletePref
} from "../models/preference.model.js";

const MS = 1000;
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "avatars");

fs.ensureDirSync(UPLOAD_DIR);

// Helper to resolve name fields
const resolveFullName = ({ full_name, first_name, last_name, name }) => {
  if (full_name && full_name.trim()) return full_name.trim();
  if (name && name.trim()) return name.trim();
  const a = (first_name || "").trim();
  const b = (last_name || "").trim();
  const joined = `${a} ${b}`.trim();
  return joined || null;
};

// register -> create pending and send OTP
export const register = async (req, res) => {
  try {
    const { full_name, first_name, last_name, name, phone, email, password } = req.body;
    const resolvedName = resolveFullName({ full_name, first_name, last_name, name });

    if (!resolvedName || !phone || !email || !password) {
      return res.status(400).json({ error: "full_name, phone, email and password are required" });
    }

    // hash password for pending storage
    const password_hash = await bcrypt.hash(password, 10);

    const pendingId = uuidv4();
    await createPending({
      id: pendingId,
      full_name: resolvedName,
      phone: phone || null,
      email: email.toLowerCase(),
      password_hash
    });

    // create OTP and send (email_verif type)
    const code = generateOtp(6);
    const ttl = parseInt(process.env.OTP_TTL_SECONDS || "300", 10);
    const expiresAt = new Date(Date.now() + ttl * MS);
    await createOtp({ target: email.toLowerCase(), code, type: "email_verif", expiresAt });

 // ✅ Replace with this
sendMail({
  to: email,
  subject: "Verify your email",
  html: `<p>Your verification code is <strong>${code}</strong>. It expires in ${ttl} seconds.</p>`
}).catch(err => console.error("sendMail failed:", err));

    return res.status(201).json({ message: "otp_sent", pendingId });
  } catch (error) {
    console.error("register error", error);
    res.status(400).json({ error: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.ip || req.headers["x-forwarded-for"] || req.connection?.remoteAddress;
    const result = await loginUser({ email, password, ip });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const ip = req.ip;
    const result = await refreshAuth({ refreshToken, ip });
    res.json(result);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
};

export const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const result = await logoutUser({ refreshToken });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// send OTP for email or phone
export const sendOtp = async (req, res) => {
  try {
    const { email, phone, type } = req.body;
    if (!email && !phone) return res.status(400).json({ error: "email or phone required" });
    const target = email ? email.toLowerCase() : phone;
    const code = generateOtp(6);
    const ttl = parseInt(process.env.OTP_TTL_SECONDS || "300", 10);
    const expiresAt = new Date(Date.now() + ttl * MS);
    await createOtp({ target, code, type: type || "login", expiresAt });

    if (email) {
      await sendMail({ to: email, subject: "Your OTP code", html: `<p>Your code is <strong>${code}</strong></p>` });
    } else {
      // SMS integration placeholder — you can add Twilio here
      console.log(`[SMS-LOG] to ${phone}, otp: ${code}`);
    }

    return res.json({ message: "otp_sent" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

/**
 * verifyOtp - registration-only, code-only verification.
 * - Request body: { code }
 * - Behavior: find most recent valid OTP with that code (type='email_verif'),
 *   create the user from the pending registration that matches otp.target (email),
 *   mark OTP used, delete pending, mark email verified.
 *
 * NOTE: This will not be used for login flow. Login remains unchanged.
 */
export const verifyOtp = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "missing_code" });
    }

    // Find the most recent valid OTP by code, restrict to registration OTPs
    const otp = await findValidOtpByCode({ code, type: "email_verif" });
    if (!otp) {
      return res.status(400).json({ error: "invalid_or_expired" });
    }

    // otp.target should be the email used during register
    const target = otp.target;
    if (!target || !target.includes("@")) {
      // unexpected: registration OTPs should have email targets
      return res.status(400).json({ error: "invalid_otp_target" });
    }

    // Find pending registration by the email stored in the OTP target
    const pending = await findPendingByEmail(target.toLowerCase());
    if (!pending) {
      return res.status(400).json({ error: "pending_registration_not_found" });
    }

    // Create new user from pending data
    // Ensure we provide `full_name` because the User Mongoose schema requires it
    const resolvedFullName = pending.full_name || pending.first_name || pending.name || null;
    // Derive a sensible first_name if possible
    const resolvedFirstName = (pending.first_name || pending.full_name || "").split(" ")[0] || null;

    const newUser = {
      id: uuidv4(),
      full_name: resolvedFullName,        // <-- required by User schema
      first_name: resolvedFirstName,      // optional but useful
      phone: pending.phone || null,
      email: pending.email,
      password_hash: pending.password_hash
    };

    // Defensive check before creating: fail with 400 if required fields missing
    if (!newUser.full_name || !newUser.email || !newUser.password_hash) {
      console.error("verifyOtp: missing required fields for user creation", {
        pendingId: pending.id,
        preview: { full_name: pending.full_name, first_name: pending.first_name, email: pending.email }
      });
      return res.status(400).json({ error: "invalid_pending_registration_data" });
    }

    try {
      await createUser(newUser);
    } catch (err) {
      console.error("Failed to create user from pending:", {
        pendingId: pending.id,
        pendingPreview: { full_name: pending.full_name, email: pending.email },
        error: err?.message || err
      });
      // rethrow so outer catch handles response formatting
      throw err;
    }

    // Optionally mark email verified flag (if your user model supports it)
    try {
      await updateUser(newUser.id, { is_email_verified: true });
    } catch (e) {
      // non-fatal if field not present
    }

    // Mark OTP used and remove pending registration
    await markOtpUsed(otp._id);
    await deletePendingById(pending.id);

    // Return success (keep it minimal)
    return res.json({ ok: true, message: "registration_verified", userId: newUser.id });
  } catch (error) {
    console.error("verifyOtp error:", error);
    return res.status(400).json({ error: error.message || "server_error" });
  }
};

// PROFILE
export const getProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const obj = user.toObject();
    delete obj.password_hash;
    res.json(obj);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const file = req.file;

    // ✅ Read all possible name/phone fields the frontend might send
    const full_name = req.body.full_name || req.body.fullName || req.body.name || req.body.display_name;
    const phone     = req.body.phone || req.body.phoneNumber;
    const email     = req.body.email;

    const updates = {};
    if (full_name?.trim()) updates.full_name = full_name.trim();
    if (phone?.trim())     updates.phone     = phone.trim();
    if (email?.trim())     updates.email     = email.trim();

    if (file) {
      // ... your existing avatar code unchanged ...
      try {
        const tmpPath = path.join(UPLOAD_DIR, `${file.filename}.tmp`);
        await sharp(file.path).resize(512, 512, { fit: "inside" }).toFile(tmpPath);
        await fs.move(tmpPath, file.path, { overwrite: true });
      } catch (err) {
        console.warn("sharp resize failed or not installed:", err?.message || err);
      }

      const user = await getUserById(userId);
      if (user && user.avatar) {
        let oldPath;
        if (user.avatar.startsWith("/uploads")) oldPath = path.join(process.cwd(), user.avatar.replace(/^\/+/, ""));
        else oldPath = path.join(UPLOAD_DIR, path.basename(user.avatar));
        try {
          if (await fs.pathExists(oldPath)) await fs.remove(oldPath);
        } catch (e) {
          console.warn("Failed to remove old avatar:", e?.message || e);
        }
      }

      updates.avatar = `/uploads/avatars/${file.filename}`;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    await updateUser(userId, updates);
    const updatedUser = await getUserById(userId);
    const obj = updatedUser.toObject();
    delete obj.password_hash;
    res.json({ ok: true, user: obj });
  } catch (error) {
    console.error("updateProfile error:", error);
    res.status(400).json({ error: error.message || "Failed to update profile" });
  }
};


// ADD THIS — handles base64 avatar upload sent as JSON
export const uploadAvatar = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { avatar: base64, mimeType } = req.body;
    if (!base64 || !mimeType) {
      return res.status(400).json({ error: "avatar and mimeType are required" });
    }

    const ext = mimeType === "image/png" ? "png"
      : mimeType === "image/webp" ? "webp" : "jpg";
    const filename = `avatar_${userId}_${Date.now()}.${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    const buffer = Buffer.from(base64, "base64");

    try {
      await sharp(buffer).resize(512, 512, { fit: "inside" }).toFile(filePath);
    } catch (err) {
      console.warn("sharp failed, saving raw:", err?.message);
      await fs.writeFile(filePath, buffer);
    }

    // Delete old avatar file
    const user = await getUserById(userId);
    if (user?.avatar) {
      const oldPath = user.avatar.startsWith("/uploads")
        ? path.join(process.cwd(), user.avatar.replace(/^\/+/, ""))
        : path.join(UPLOAD_DIR, path.basename(user.avatar));
      try {
        if (await fs.pathExists(oldPath)) await fs.remove(oldPath);
      } catch (e) {
        console.warn("Could not remove old avatar:", e?.message);
      }
    }

    const avatarPath = `/uploads/avatars/${filename}`;
    await updateUser(userId, { avatar: avatarPath });

    const updatedUser = await getUserById(userId);
    const obj = updatedUser.toObject();
    delete obj.password_hash;

    res.json({ ok: true, avatar: avatarPath, user: obj });
  } catch (error) {
    console.error("uploadAvatar error:", error);
    res.status(500).json({ error: error.message || "Failed to upload avatar" });
  }
};

// PREFERENCES
export const listPrefs = async (req, res) => {
  try {
    const userId = req.user?.id;
    const prefs = await getPrefsByUser(userId);
    res.json(prefs);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const upsertPreference = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: "Key required" });
    const pref = await upsertPref({ userId, key, value });
    res.json(pref);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const removePreference = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { key } = req.params;
    await deletePref({ userId, key });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    await deleteUser(userId);
    return res.json({ ok: true, message: "Account deleted" });
  } catch (error) {
    console.error("deleteAccount error:", error);
    return res.status(400).json({ error: error.message || "Failed to delete account" });
  }
};
