// libs/redis.js
// Development mode — in-memory store, no Redis server required.

import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// ── In-memory key-value store ─────────────────────────────────────────────────
const store = new Map();

const redisClient = {
  get: async (key) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  },

  set: async (key, value, options) => {
    const expiresAt = options?.EX ? Date.now() + options.EX * 1000 : null;
    store.set(key, { value, expiresAt });
    return "OK";
  },

  del: async (key) => {
    store.delete(key);
    return 1;
  },

  isReady: true,
  connect: async () => {},
};

export const connectRedis = async () => {
  console.info("[redis] Using in-memory store (development mode)");
};

export const buildSocketAdapter = () => null;

export default redisClient;

// ── Rate limiters — IPv6 safe ─────────────────────────────────────────────────
// Uses ipKeyGenerator helper for IP fallback (fixes ERR_ERL_KEY_GEN_IPV6)

export const chatLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.user?.id ?? ipKeyGenerator(req),
});

export const apiLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             300,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.user?.id ?? ipKeyGenerator(req),
});

export const authLimiter = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    10,
  standardHeaders:        true,
  legacyHeaders:          false,
  skipSuccessfulRequests: true,
  keyGenerator:           (req) => ipKeyGenerator(req),
  message:                { error: "Too many login attempts — try again later." },
});