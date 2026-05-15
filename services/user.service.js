// backend/services/user.service.js
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import {
  createUser,
  findByEmail,
  findByPhone,
  getUserById,
  updateUser as updateUserModel
} from "../models/User.js";

import {
  createRefreshToken,
  findRefreshToken,
  revokeRefreshToken
} from "../models/refreshToken.model.js";

import { createOtp } from "../models/otp.model.js";
import { sendMail } from "../utils/mailer.js";
import { generateOtp } from "../utils/otp.js";

const ACCESS_TOKEN_EXPIRES = process.env.ACCESS_TOKEN_EXPIRES || "2h";
const REFRESH_TTL_DAYS = parseInt(process.env.REFRESH_TTL_DAYS || "30", 10);

// Read secret at runtime
const getJwtSecret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Server misconfiguration: JWT_SECRET is not set");
  return s;
};

// Helper to sign access tokens
const signAccessToken = (payload) => {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: ACCESS_TOKEN_EXPIRES,
  });
};

export const registerUser = async ({ full_name, phone, email, password }) => {
  const existing = await findByEmail(email);
  if (existing) throw new Error("Email already registered");

  const password_hash = await bcrypt.hash(password, 10);

  const newUser = {
    id: uuidv4(),
    full_name,
    phone: phone || null,
    email: email.toLowerCase(),
    password_hash,
  };

  await createUser(newUser);

  try {
    const otpCode = generateOtp(6);
    const ttlSeconds = parseInt(process.env.OTP_TTL_SECONDS || "300", 10);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await createOtp({
      target: email.toLowerCase(),
      code: otpCode,
      type: "email_verif",
      expiresAt,
    });

    await sendMail({
      to: email,
      subject: "Verify your email",
      html: `<p>Your verification code is <strong>${otpCode}</strong>. It expires in ${ttlSeconds} seconds.</p>`,
    });
  } catch (e) {
    console.warn("Mailer error:", e);
  }

  return { message: "User registered. OTP sent to email." };
};

export const loginUser = async ({ email, password, ip }) => {
  const user = await findByEmail(email.toLowerCase());
  if (!user) throw new Error("Invalid email or password");

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error("Invalid email or password");

  // Issue access token
  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
  });

  // Create refresh token
  const refreshToken = uuidv4();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);

  await createRefreshToken({
    userId: user.id,
    token: refreshToken,
    expiresAt,
    createdByIp: ip,
  });

  const safeUser = {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    phone: user.phone,
    created_at: user.created_at,
  };

  // RETURN TOKEN (this is what frontend needs!)
  return {
    message: "login_success",
    accessToken,
    refreshToken,
    user: safeUser,
  };
};

export const refreshAuth = async ({ refreshToken, ip }) => {
  if (!refreshToken) throw new Error("refreshToken required");

  const rec = await findRefreshToken(refreshToken);
  if (!rec) throw new Error("Invalid refresh token");
  if (rec.revoked) throw new Error("Refresh token revoked");
  if (new Date(rec.expires_at) < new Date())
    throw new Error("Refresh token expired");

  await revokeRefreshToken(refreshToken);

  const user = await getUserById(rec.user_id);
  if (!user) throw new Error("User not found");

  const newAccessToken = signAccessToken({
    id: user.id,
    email: user.email,
  });

  const newRefreshToken = uuidv4();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400000);

  await createRefreshToken({
    userId: user.id,
    token: newRefreshToken,
    expiresAt,
    createdByIp: ip,
  });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      phone: user.phone,
      created_at: user.created_at,
    },
  };
};

export const logoutUser = async ({ refreshToken }) => {
  if (!refreshToken) throw new Error("refreshToken required");

  await revokeRefreshToken(refreshToken);
  return { message: "Logged out" };
};
