const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const mongoose = require("mongoose");
const LoginAttempt = require("../models/LoginAttempt");

// Memory fallback store if DB is momentarily unreachable
const memoryFallbackStore = new Map();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Normalizes client IP address and email for identification.
 */
function normalizeClientInfo(req, explicitEmail = "") {
  const rawIp = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1";
  const ip = ipKeyGenerator(rawIp);
  const email = (explicitEmail || req.body?.email || "").toLowerCase().trim();
  return { ip, email };
}

function isDbConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

/**
 * Checks whether an account or IP is currently in a 24-hour security lockout.
 */
async function checkLockout(email = "", ip = "") {
  const now = new Date();
  const keysToCheck = [];

  if (email) {
    keysToCheck.push(`email:${email.toLowerCase().trim()}`);
  }
  if (ip) {
    keysToCheck.push(`ip:${ip}`);
  }

  for (const key of keysToCheck) {
    try {
      if (isDbConnected()) {
        const record = await LoginAttempt.findOne({ key });
        if (record && record.lockUntil) {
          if (record.lockUntil > now) {
            const remainingMs = record.lockUntil.getTime() - now.getTime();
            const remainingHours = Math.max(1, Math.ceil(remainingMs / (1000 * 60 * 60)));
            return {
              isLocked: true,
              lockUntil: record.lockUntil,
              remainingHours,
              failedCount: record.failedCount,
            };
          } else {
            // Lockout duration expired — clear the lock
            await LoginAttempt.deleteOne({ _id: record._id }).catch(() => {});
          }
        }
      } else {
        const mem = memoryFallbackStore.get(key);
        if (mem && mem.lockUntil && mem.lockUntil > now) {
          const remainingMs = mem.lockUntil.getTime() - now.getTime();
          const remainingHours = Math.max(1, Math.ceil(remainingMs / (1000 * 60 * 60)));
          return {
            isLocked: true,
            lockUntil: mem.lockUntil,
            remainingHours,
            failedCount: mem.failedCount,
          };
        }
      }
    } catch (err) {
      const mem = memoryFallbackStore.get(key);
      if (mem && mem.lockUntil && mem.lockUntil > now) {
        const remainingMs = mem.lockUntil.getTime() - now.getTime();
        const remainingHours = Math.max(1, Math.ceil(remainingMs / (1000 * 60 * 60)));
        return {
          isLocked: true,
          lockUntil: mem.lockUntil,
          remainingHours,
          failedCount: mem.failedCount,
        };
      }
    }
  }

  return { isLocked: false, failedCount: 0 };
}

/**
 * Records a failed authentication attempt (wrong password or invalid OTP).
 * Increments the failure count and triggers a 24-hour lockout on the 5th failed attempt.
 */
async function recordFailedAttempt(email = "", ip = "") {
  const now = new Date();
  const emailKey = email ? `email:${email.toLowerCase().trim()}` : null;
  const ipKey = ip ? `ip:${ip}` : null;
  const keys = [emailKey, ipKey].filter(Boolean);

  let highestFailedCount = 0;
  let isNowLocked = false;
  let lockUntilDate = null;

  for (const key of keys) {
    let failedCount = 1;
    let lockUntil = null;

    try {
      if (isDbConnected()) {
        let record = await LoginAttempt.findOne({ key });
        if (record) {
          if (record.lockUntil && record.lockUntil <= now) {
            failedCount = 1;
          } else {
            failedCount = (record.failedCount || 0) + 1;
          }

          if (failedCount >= MAX_FAILED_ATTEMPTS) {
            lockUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
          }

          record.failedCount = failedCount;
          record.lockUntil = lockUntil;
          record.lastAttemptAt = now;
          if (email) record.email = email.toLowerCase().trim();
          if (ip) record.ip = ip;
          await record.save();
        } else {
          if (failedCount >= MAX_FAILED_ATTEMPTS) {
            lockUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
          }
          await LoginAttempt.create({
            key,
            email: email ? email.toLowerCase().trim() : "",
            ip: ip || "",
            failedCount,
            lockUntil,
            lastAttemptAt: now,
          });
        }
      } else {
        let mem = memoryFallbackStore.get(key) || { failedCount: 0, lockUntil: null };
        if (mem.lockUntil && mem.lockUntil <= now) {
          failedCount = 1;
        } else {
          failedCount = (mem.failedCount || 0) + 1;
        }

        if (failedCount >= MAX_FAILED_ATTEMPTS) {
          lockUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
        }

        memoryFallbackStore.set(key, { failedCount, lockUntil, lastAttemptAt: now });
      }
    } catch (err) {
      let mem = memoryFallbackStore.get(key) || { failedCount: 0, lockUntil: null };
      if (mem.lockUntil && mem.lockUntil <= now) {
        failedCount = 1;
      } else {
        failedCount = (mem.failedCount || 0) + 1;
      }

      if (failedCount >= MAX_FAILED_ATTEMPTS) {
        lockUntil = new Date(now.getTime() + LOCKOUT_DURATION_MS);
      }

      memoryFallbackStore.set(key, { failedCount, lockUntil, lastAttemptAt: now });
    }

    if (failedCount > highestFailedCount) {
      highestFailedCount = failedCount;
    }
    if (lockUntil) {
      isNowLocked = true;
      lockUntilDate = lockUntil;
    }
  }

  const remainingAttempts = Math.max(0, MAX_FAILED_ATTEMPTS - highestFailedCount);

  return {
    isLocked: isNowLocked,
    failedCount: highestFailedCount,
    remainingAttempts,
    lockUntil: lockUntilDate,
    remainingHours: 24,
  };
}

/**
 * Clears failed attempts upon successful login / verification.
 * The user is restored to zero failed attempts immediately.
 */
async function clearFailedAttempts(email = "", ip = "") {
  const emailKey = email ? `email:${email.toLowerCase().trim()}` : null;
  const ipKey = ip ? `ip:${ip}` : null;
  const keys = [emailKey, ipKey].filter(Boolean);

  for (const key of keys) {
    try {
      if (isDbConnected()) {
        await LoginAttempt.deleteOne({ key });
      }
    } catch (err) {
      // Ignore
    }
    memoryFallbackStore.delete(key);
  }
}

/**
 * Express Middleware to check 24-hour lockout BEFORE processing login / auth.
 */
async function checkAuthLockoutMiddleware(req, res, next) {
  const { ip, email } = normalizeClientInfo(req);
  const status = await checkLockout(email, ip);

  if (status.isLocked) {
    return res.status(429).json({
      error: "Too Many Requests",
      message: `Security Lockout: 5 failed attempts exceeded. Access is temporarily restricted for 24 hours (approx ${status.remainingHours}h remaining). Please try again after 24 hours or reset your password.`,
      statusCode: 429,
      retryAfterHours: status.remainingHours,
      lockUntil: status.lockUntil,
    });
  }

  next();
}

// 🛡️ OTP & Password Reset Request Rate Limiter (24-Hour Window)
const otpRequestRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: 10, // Max 10 OTP / reset code requests per 24 hours
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const { ip, email } = normalizeClientInfo(req);
    return email ? `${ip}::${email}` : ip;
  },
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json({
      error: "Too Many Requests",
      message:
        "Security lockout: Too many verification code requests for this email/IP within a 24-hour period. Please check your inbox or try again after 24 hours.",
      statusCode: 429,
      retryAfterHours: 24,
      timestamp: new Date().toISOString(),
    });
  },
});

// 🛡️ Signup & Registration Rate Limiter (24-Hour Window)
const signupRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: 10, // Max 10 new accounts per IP in 24 hours
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || req.socket?.remoteAddress || "127.0.0.1"),
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json({
      error: "Too Many Requests",
      message:
        "Security lockout: Maximum account creation limit reached for this IP address in a 24-hour window. Please try again tomorrow.",
      statusCode: 429,
      retryAfterHours: 24,
      timestamp: new Date().toISOString(),
    });
  },
});

// 🛡️ OAuth Rate Limiter (24-Hour Window)
const oauthRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: 40, // Max 40 OAuth exchanges per IP per 24 hours
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || req.socket?.remoteAddress || "127.0.0.1"),
  handler: (req, res, _next, options) => {
    res.status(options.statusCode).json({
      error: "Too Many Requests",
      message: "Security lockout: Too many OAuth sign-in requests from this IP address in 24 hours. Please try again later.",
      statusCode: 429,
      retryAfterHours: 24,
      timestamp: new Date().toISOString(),
    });
  },
});

module.exports = {
  checkLockout,
  recordFailedAttempt,
  clearFailedAttempts,
  checkAuthLockoutMiddleware,
  normalizeClientInfo,
  otpRequestRateLimiter,
  signupRateLimiter,
  oauthRateLimiter,
};
