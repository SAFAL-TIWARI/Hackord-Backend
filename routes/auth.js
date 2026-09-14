const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const Otp = require("../models/Otp");
const { protect } = require("../middleware/auth");
const { sendNotification } = require("../services/notificationService");
const {
  checkAuthLockoutMiddleware,
  recordFailedAttempt,
  clearFailedAttempts,
  normalizeClientInfo,
  otpRequestRateLimiter,
  signupRateLimiter,
  oauthRateLimiter,
} = require("../middleware/rateLimiter");

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT
function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}


/**
 * Intelligently syncs and merges profile details from an incoming OAuth provider
 * into an existing Hackord user account while strictly PRESERVING prior details,
 * custom edits, and identities synced from other platforms.
 */
function syncUserProfileFromOAuth(user, {
  provider,
  providerId,
  name,
  avatar,
  bio,
  github,
  discord,
  portfolio,
  location,
  customLinks = [],
}) {
  let changed = false;

  // 1. Link provider identity if not already linked
  if (provider === "google" && !user.googleId) {
    user.googleId = providerId;
    changed = true;
  }
  if (provider === "github" && !user.githubId) {
    user.githubId = providerId;
    changed = true;
  }
  if (provider === "discord" && !user.discordId) {
    user.discordId = providerId;
    changed = true;
  }
  if (provider === "microsoft" && !user.microsoftId) {
    user.microsoftId = providerId;
    changed = true;
  }
  if (provider === "reddit" && !user.redditId) {
    user.redditId = providerId;
    changed = true;
  }

  // 2. Avatar Update:
  // User's profile avatar is updated on every login from that platform.
  // If the incoming platform provides a real profile photo, it becomes the active avatar.
  // If the incoming platform only has a dicebear placeholder, it only updates if user has no avatar.
  if (avatar && avatar.trim() !== "") {
    const isNewAvatarDicebear = avatar.includes("dicebear.com");
    const currentAvatarIsReal = user.avatar && !user.avatar.includes("dicebear.com");
    if (!isNewAvatarDicebear || !currentAvatarIsReal) {
      if (user.avatar !== avatar.trim()) {
        user.avatar = avatar.trim();
        changed = true;
      }
    }
  }

  // 3. Name Upgrade:
  // If user currently has a generic fallback placeholder name, upgrade to provider's name
  const placeholderNames = [
    "Developer",
    "GitHub Developer",
    "Discord Builder",
    "Microsoft Developer",
    "user",
  ];
  if (name && (!user.name || placeholderNames.includes(user.name.trim()))) {
    user.name = name.trim();
    changed = true;
  }

  // 4. Bio: Fill if empty (preserve existing bio)
  if (bio && bio.trim() && (!user.bio || user.bio.trim() === "")) {
    user.bio = bio.trim();
    changed = true;
  }

  // 5. GitHub: Always ensure user's GitHub URL is synced from GitHub login
  if (github && github.trim() && (!user.github || user.github === "" || user.github !== github.trim())) {
    user.github = github.trim();
    changed = true;
  }

  // 6. Discord: Always ensure user's Discord profile/handle is synced from Discord login
  if (discord && discord.trim() && (!user.discord || user.discord === "" || user.discord !== discord.trim())) {
    user.discord = discord.trim();
    changed = true;
  }

  // 7. Portfolio / Blog Website: Fill if empty (preserve existing portfolio)
  if (portfolio && portfolio.trim() && (!user.portfolio || user.portfolio.trim() === "")) {
    let cleanUrl = portfolio.trim();
    if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
      cleanUrl = `https://${cleanUrl}`;
    }
    user.portfolio = cleanUrl;
    changed = true;
  }

  // 8. Location / City: Fill if empty (preserve existing city/country)
  if (location && location.trim() && (!user.city && !user.country)) {
    user.city = location.trim();
    changed = true;
  }

  // 9. Custom Links (e.g. Reddit, Twitter/X): Merge without duplicates or wiping other links
  if (Array.isArray(customLinks) && customLinks.length > 0) {
    if (!Array.isArray(user.customLinks)) {
      user.customLinks = [];
    }
    for (const link of customLinks) {
      if (!link || !link.url) continue;
      const cleanUrl = link.url.trim().toLowerCase();
      const cleanPlatform = (link.platform || "").trim().toLowerCase();

      const exists = user.customLinks.some((existing) => {
        const existingUrl = (existing.url || "").trim().toLowerCase();
        const existingPlatform = (existing.platform || "").trim().toLowerCase();
        return (
          existingUrl === cleanUrl ||
          (cleanPlatform && existingPlatform === cleanPlatform)
        );
      });

      if (!exists) {
        user.customLinks.push({
          platform: link.platform || "website",
          title: link.title || "Social Link",
          url: link.url.trim(),
        });
        changed = true;
      }
    }
  }

  return changed;
}

// ─── POST /api/auth/signup ───────────────────────────────────────────
router.post("/signup", signupRateLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }

    // Create user
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      username: email.split("@")[0],
      avatar: `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(name)}`,
    });

    const token = generateToken(user._id);

    // Trigger Welcome Email Notification
    sendNotification({
      recipientUser: user,
      type: "welcome",
      title: "Welcome to Hackord! 🎉",
      body: `Hi ${name.split(" ")[0]}, welcome to Hackord! Your account has been created successfully. Explore hackathons, form teams, and build incredible projects.`,
      link: "/dashboard",
    }).catch((e) => console.error("[signupWelcomeNotifErr]", e.message));

    res.status(201).json({
      token,
      user: user.toJSON(),
    });
  } catch (err) {
    console.error("[signup]", err);
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }
    res.status(500).json({ message: "Server error during signup" });
  }
});

// ─── POST /api/auth/login ────────────────────────────────────────────
// Enforces 5 failed attempts limit before 24-hour lockout. Correct password resets failures.
router.post("/login", checkAuthLockoutMiddleware, async (req, res) => {
  try {
    const { email, password } = req.body;
    const { ip, email: emailClean } = normalizeClientInfo(req, email);

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Find user (include password for comparison)
    const user = await User.findOne({ email: emailClean });
    if (!user) {
      const failInfo = await recordFailedAttempt(emailClean, ip);
      if (failInfo.isLocked) {
        return res.status(429).json({
          error: "Too Many Requests",
          message: "Security Lockout: 5 failed login attempts reached. Please try again after 24 hours.",
          statusCode: 429,
          retryAfterHours: 24,
          lockUntil: failInfo.lockUntil,
        });
      }
      return res.status(401).json({
        message: `Invalid email or password. ${failInfo.remainingAttempts} attempt${failInfo.remainingAttempts === 1 ? "" : "s"} remaining before 24-hour lockout.`,
        attemptsRemaining: failInfo.remainingAttempts,
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      const failInfo = await recordFailedAttempt(emailClean, ip);
      if (failInfo.isLocked) {
        return res.status(429).json({
          error: "Too Many Requests",
          message: "Security Lockout: 5 failed login attempts reached. Please try again after 24 hours or reset your password.",
          statusCode: 429,
          retryAfterHours: 24,
          lockUntil: failInfo.lockUntil,
        });
      }
      return res.status(401).json({
        message: `Invalid email or password. ${failInfo.remainingAttempts} attempt${failInfo.remainingAttempts === 1 ? "" : "s"} remaining before 24-hour lockout.`,
        attemptsRemaining: failInfo.remainingAttempts,
      });
    }

    // Success! Clear any past failed attempts
    await clearFailedAttempts(emailClean, ip);

    const token = generateToken(user._id);

    res.json({
      token,
      user: user.toJSON(),
    });
  } catch (err) {
    console.error("[login]", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// ─── POST /api/auth/google ───────────────────────────────────────────
router.post("/google", oauthRateLimiter, async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ message: "Google credential is required" });
    }

    let payload;
    try {
      if (process.env.GOOGLE_CLIENT_ID) {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
      } else {
        const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
        if (!resp.ok) throw new Error("Token verification failed");
        payload = await resp.json();
      }
    } catch (verifyErr) {
      console.warn("[googleAuthVerifyWarn] Primary verification failed, trying tokeninfo fallback:", verifyErr.message);
      try {
        const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
        if (resp.ok) {
          payload = await resp.json();
        } else {
          return res.status(401).json({ message: "Invalid or expired Google token" });
        }
      } catch {
        return res.status(401).json({ message: "Failed to verify Google token" });
      }
    }

    if (!payload || !payload.email) {
      return res.status(400).json({ message: "Email not provided by Google account" });
    }

    const { sub: googleId, email, name, picture } = payload;
    const { ip, email: emailClean } = normalizeClientInfo(req, email);

    let user = await User.findOne({
      $or: [{ googleId }, { email: emailClean }],
    });

    let isNewUser = false;

    if (user) {
      syncUserProfileFromOAuth(user, {
        provider: "google",
        providerId: googleId,
        name: name,
        avatar: picture,
      });
      await user.save();
    } else {
      isNewUser = true;
      const baseUsername = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
      user = await User.create({
        name: name || "Developer",
        email: emailClean,
        googleId,
        username: baseUsername,
        avatar: picture || `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(name || email)}`,
      });

      sendNotification({
        recipientUser: user,
        type: "welcome",
        title: "Welcome to Hackord! 🎉",
        body: `Hi ${(name || "there").split(" ")[0]}, welcome to Hackord! Your account has been created via Google. Explore hackathons, form teams, and build incredible projects.`,
        link: "/dashboard",
      }).catch((e) => console.error("[googleSignupWelcomeNotifErr]", e.message));
    }

    await clearFailedAttempts(emailClean, ip);
    const token = generateToken(user._id);

    res.json({
      token,
      user: user.toJSON(),
      isNewUser,
    });
  } catch (err) {
    console.error("[googleAuthErr]", err);
    res.status(500).json({ message: "Server error during Google authentication" });
  }
});

// ─── POST /api/auth/github ───────────────────────────────────────────
router.post("/github", oauthRateLimiter, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ message: "GitHub authorization code is required" });
    }

    const clientId = process.env.GITHUB_CLIENT_ID || process.env.VITE_GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ message: "GitHub Client ID and Secret are not configured on server" });
    }

    // Exchange authorization code for access token
    const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = await tokenResp.json();

    if (tokenData.error || !tokenData.access_token) {
      console.error("[githubTokenExchangeError]", tokenData);
      return res.status(401).json({
        message: tokenData.error_description || "Failed to exchange GitHub authorization code",
      });
    }

    const accessToken = tokenData.access_token;

    // Fetch user profile from GitHub
    const userResp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Hackord-App",
      },
    });

    if (!userResp.ok) {
      return res.status(401).json({ message: "Failed to fetch user profile from GitHub" });
    }

    const ghProfile = await userResp.json();
    const githubId = String(ghProfile.id);
    let email = ghProfile.email;

    // If primary email is private in user profile, fetch from /user/emails
    if (!email) {
      try {
        const emailsResp = await fetch("https://api.github.com/user/emails", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "Hackord-App",
          },
        });
        if (emailsResp.ok) {
          const emails = await emailsResp.json();
          const primaryEmailObj = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified) || emails[0];
          if (primaryEmailObj) {
            email = primaryEmailObj.email;
          }
        }
      } catch (emailErr) {
        console.warn("[githubEmailFetchWarn]", emailErr.message);
      }
    }

    if (!email) {
      email = `${ghProfile.login}@users.noreply.github.com`;
    }

    const githubUrl = ghProfile.html_url || `https://github.com/${ghProfile.login}`;
    const { ip, email: emailClean } = normalizeClientInfo(req, email);

    let user = await User.findOne({
      $or: [{ githubId }, { email: emailClean }],
    });

    let isNewUser = false;

    const githubCustomLinks = [];
    if (ghProfile.twitter_username) {
      githubCustomLinks.push({
        platform: "twitter",
        title: "Twitter / X",
        url: `https://x.com/${ghProfile.twitter_username}`,
      });
    }

    let githubBlogUrl = (ghProfile.blog || "").trim();
    if (githubBlogUrl && !githubBlogUrl.startsWith("http://") && !githubBlogUrl.startsWith("https://")) {
      githubBlogUrl = `https://${githubBlogUrl}`;
    }

    if (user) {
      syncUserProfileFromOAuth(user, {
        provider: "github",
        providerId: githubId,
        name: ghProfile.name || ghProfile.login,
        avatar: ghProfile.avatar_url,
        bio: ghProfile.bio || "",
        github: githubUrl,
        portfolio: githubBlogUrl,
        location: ghProfile.location || "",
        customLinks: githubCustomLinks,
      });
      await user.save();
    } else {
      isNewUser = true;
      const baseUsername = ghProfile.login || email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
      user = await User.create({
        name: ghProfile.name || ghProfile.login || "GitHub Developer",
        email: emailClean,
        githubId,
        username: baseUsername,
        avatar: ghProfile.avatar_url || `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(ghProfile.login || email)}`,
        github: githubUrl,
        bio: ghProfile.bio || "",
        portfolio: githubBlogUrl,
        city: ghProfile.location || "",
        customLinks: githubCustomLinks,
      });

      sendNotification({
        recipientUser: user,
        type: "welcome",
        title: "Welcome to Hackord! 🎉",
        body: `Hi ${(user.name || "there").split(" ")[0]}, welcome to Hackord! Your account has been created via GitHub. Explore hackathons, form teams, and build incredible projects.`,
        link: "/dashboard",
      }).catch((e) => console.error("[githubSignupWelcomeNotifErr]", e.message));
    }

    await clearFailedAttempts(emailClean, ip);
    const token = generateToken(user._id);

    res.json({
      token,
      user: user.toJSON(),
      isNewUser,
    });
  } catch (err) {
    console.error("[githubAuthErr]", err);
    res.status(500).json({ message: "Server error during GitHub authentication" });
  }
});

// ─── GET /api/auth/me ────────────────────────────────────────────────

// ─── POST /api/auth/discord ───
router.post("/discord", oauthRateLimiter, async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) {
      return res.status(400).json({ message: "Discord authorization code is required" });
    }

    const clientId = process.env.DISCORD_CLIENT_ID || process.env.VITE_DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ message: "Discord Client ID and Secret are not configured on server" });
    }

    let redirect_uri = (redirectUri || "").trim();
    if (!redirect_uri) {
      redirect_uri = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/login` : "http://localhost:5173/login";
    }
    redirect_uri = redirect_uri.replace(/\/+$/, "");

    // Exchange code for token
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: code.trim(),
      redirect_uri,
    });

    const tokenResp = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Hackord-App/1.0.0 (https://hackord.com)",
      },
      body: tokenParams.toString(),
    });

    const tokenData = await tokenResp.json();
    if (tokenData.error || !tokenData.access_token) {
      console.error("[discordTokenExchangeError]", tokenData, {
        sentRedirectUri: redirect_uri,
        codePreview: code ? `${code.substring(0, 6)}...` : null,
      });
      return res.status(401).json({
        message: tokenData.error_description || tokenData.error || "Failed to exchange Discord authorization code",
      });
    }

    const accessToken = tokenData.access_token;

    // Fetch user profile from Discord
    const userResp = await fetch("https://discord.com/api/v10/users/@me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userResp.ok) {
      return res.status(401).json({ message: "Failed to fetch user profile from Discord" });
    }

    const discordUser = await userResp.json();
    const discordId = String(discordUser.id);
    let email = discordUser.email;
    if (!email) {
      email = `${discordUser.username || discordId}@users.noreply.discord.com`;
    }

    const { ip, email: emailClean } = normalizeClientInfo(req, email);
    const displayName = discordUser.global_name || discordUser.username || "Discord Builder";
    const discordAvatar = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
      : `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(discordUser.username || emailClean)}`;

    let user = await User.findOne({
      $or: [{ discordId }, { email: emailClean }],
    });

    let isNewUser = false;

    const discordProfileUrl = `https://discord.com/users/${discordUser.id}`;

    if (user) {
      syncUserProfileFromOAuth(user, {
        provider: "discord",
        providerId: discordId,
        name: displayName,
        avatar: discordUser.avatar ? discordAvatar : null,
        discord: discordProfileUrl,
      });
      await user.save();
    } else {
      isNewUser = true;
      const baseUsername = (discordUser.username || emailClean.split("@")[0]).replace(/[^a-zA-Z0-9_]/g, "");
      user = await User.create({
        name: displayName,
        email: emailClean,
        discordId,
        username: baseUsername,
        avatar: discordAvatar,
        discord: discordProfileUrl,
        bio: "",
      });

      sendNotification({
        recipientUser: user,
        type: "welcome",
        title: "Welcome to Hackord! 🚀",
        body: `Hi ${(user.name || "there").split(" ")[0]}, welcome to Hackord! Your account has been created via Discord. Explore hackathons, form teams, and build incredible projects.`,
        link: "/dashboard",
      }).catch((e) => console.error("[discordSignupWelcomeNotifErr]", e.message));
    }

    await clearFailedAttempts(emailClean, ip);
    const token = generateToken(user._id);

    res.json({
      token,
      user: user.toJSON(),
      isNewUser,
    });
  } catch (err) {
    console.error("[discordAuthErr]", err);
    res.status(500).json({ message: "Server error during Discord authentication" });
  }
});

// ─── POST /api/auth/microsoft ───
router.post("/microsoft", oauthRateLimiter, async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) {
      return res.status(400).json({ message: "Microsoft authorization code is required" });
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.VITE_MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ message: "Microsoft Client ID and Secret are not configured on server" });
    }

    let redirect_uri = (redirectUri || "").trim();
    if (!redirect_uri) {
      redirect_uri = process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/login` : "http://localhost:5173/login";
    }
    redirect_uri = redirect_uri.replace(/\/+$/, "");

    // Exchange authorization code for token via Microsoft Entra ID endpoint
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: code.trim(),
      redirect_uri,
      scope: "openid profile email User.Read",
    });

    const tokenResp = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Hackord-App/1.0.0 (https://hackord.com)",
      },
      body: tokenParams.toString(),
    });

    const tokenData = await tokenResp.json();
    if (tokenData.error || !tokenData.access_token) {
      console.error("[microsoftTokenExchangeError]", tokenData, {
        sentRedirectUri: redirect_uri,
        codePreview: code ? `${code.substring(0, 6)}...` : null,
      });
      return res.status(401).json({
        message: tokenData.error_description || tokenData.error || "Failed to exchange Microsoft authorization code",
      });
    }

    const accessToken = tokenData.access_token;

    // Fetch user profile from Microsoft Graph API
    const userResp = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userResp.ok) {
      return res.status(401).json({ message: "Failed to fetch user profile from Microsoft Graph" });
    }

    const msUser = await userResp.json();
    const microsoftId = String(msUser.id);
    let email = msUser.mail || msUser.userPrincipalName;
    if (!email) {
      email = `${microsoftId}@users.noreply.microsoft.com`;
    }

    const displayName = msUser.displayName || "Microsoft Developer";
    const { ip, email: emailClean } = normalizeClientInfo(req, email);
    const avatar = `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(displayName || emailClean)}`;

    let user = await User.findOne({
      $or: [{ microsoftId }, { email: emailClean }],
    });

    let isNewUser = false;

    if (user) {
      syncUserProfileFromOAuth(user, {
        provider: "microsoft",
        providerId: microsoftId,
        name: displayName,
        bio: msUser.jobTitle || "",
        location: msUser.officeLocation || "",
      });
      await user.save();
    } else {
      isNewUser = true;
      const baseUsername = (emailClean.split("@")[0]).replace(/[^a-zA-Z0-9_]/g, "");
      user = await User.create({
        name: displayName,
        email: emailClean,
        microsoftId,
        username: baseUsername,
        avatar,
        bio: msUser.jobTitle ? `${msUser.jobTitle}` : "",
      });

      sendNotification({
        recipientUser: user,
        type: "welcome",
        title: "Welcome to Hackord! 🚀",
        body: `Hi ${(user.name || "there").split(" ")[0]}, welcome to Hackord! Your account has been created via Microsoft. Explore hackathons, form teams, and build incredible projects.`,
        link: "/dashboard",
      }).catch((e) => console.error("[microsoftSignupWelcomeNotifErr]", e.message));
    }

    await clearFailedAttempts(emailClean, ip);
    const token = generateToken(user._id);

    res.json({
      token,
      user: user.toJSON(),
      isNewUser,
    });
  } catch (err) {
    console.error("[microsoftAuthErr]", err);
    res.status(500).json({ message: "Server error during Microsoft authentication" });
  }
});

// ─── POST /api/auth/reddit ───
router.post("/reddit", oauthRateLimiter, async (req, res) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) {
      return res.status(400).json({ message: "Reddit authorization code is required" });
    }

    const clientId = process.env.REDDIT_CLIENT_ID || process.env.VITE_REDDIT_CLIENT_ID;
    const clientSecret = process.env.REDDIT_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({ message: "Reddit Client ID and Secret are not configured on server" });
    }

    const redirect_uri = redirectUri || (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/login` : "http://localhost:5173/login");

    // Reddit requires HTTP Basic Auth with Client ID & Secret
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const tokenResp = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        "User-Agent": "Hackord:v1.0.0 (by /u/hackord)",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri,
      }).toString(),
    });

    const tokenData = await tokenResp.json();
    if (tokenData.error || !tokenData.access_token) {
      console.error("[redditTokenExchangeError]", tokenData);
      return res.status(401).json({
        message: tokenData.error_description || tokenData.error || "Failed to exchange Reddit authorization code",
      });
    }

    const accessToken = tokenData.access_token;

    // Fetch user profile from Reddit OAuth endpoint
    const userResp = await fetch("https://oauth.reddit.com/api/v1/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Hackord:v1.0.0 (by /u/hackord)",
      },
    });

    if (!userResp.ok) {
      return res.status(401).json({ message: "Failed to fetch user profile from Reddit" });
    }

    const redditUser = await userResp.json();
    const redditId = String(redditUser.id);
    const username = redditUser.name || `reddit_user_${redditId}`;
    const email = `${username}@users.noreply.reddit.com`;
    const displayName = (redditUser.subreddit && redditUser.subreddit.title) || username;

    let avatar = "";
    if (redditUser.icon_img) {
      avatar = redditUser.icon_img.replace(/&amp;/g, "&");
    }
    if (!avatar) {
      avatar = `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(username)}`;
    }

    const { ip, email: emailClean } = normalizeClientInfo(req, email);

    let user = await User.findOne({
      $or: [{ redditId }, { email: emailClean }],
    });

    let isNewUser = false;

    const redditUrl = `https://www.reddit.com/user/${username}`;
    const redditCustomLinks = [
      {
        platform: "reddit",
        title: "Reddit",
        url: redditUrl,
      },
    ];

    if (user) {
      syncUserProfileFromOAuth(user, {
        provider: "reddit",
        providerId: redditId,
        name: displayName,
        avatar: redditUser.icon_img ? avatar : null,
        bio: (redditUser.subreddit && redditUser.subreddit.public_description) || "",
        customLinks: redditCustomLinks,
      });
      await user.save();
    } else {
      isNewUser = true;
      const baseUsername = username.replace(/[^a-zA-Z0-9_]/g, "");
      user = await User.create({
        name: displayName,
        email: emailClean,
        redditId,
        username: baseUsername,
        avatar,
        bio: (redditUser.subreddit && redditUser.subreddit.public_description) || "",
        customLinks: redditCustomLinks,
      });

      sendNotification({
        recipientUser: user,
        type: "welcome",
        title: "Welcome to Hackord! 🚀",
        body: `Hi ${(user.name || "there").split(" ")[0]}, welcome to Hackord! Your account has been created via Reddit. Explore hackathons, form teams, and build incredible projects.`,
        link: "/dashboard",
      }).catch((e) => console.error("[redditSignupWelcomeNotifErr]", e.message));
    }

    await clearFailedAttempts(emailClean, ip);
    const token = generateToken(user._id);

    res.json({
      token,
      user: user.toJSON(),
      isNewUser,
    });
  } catch (err) {
    console.error("[redditAuthErr]", err);
    res.status(500).json({ message: "Server error during Reddit authentication" });
  }
});

router.get("/me", protect, async (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (err) {
    console.error("[me]", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── PUT /api/auth/profile ───────────────────────────────────────────
router.put("/profile", protect, async (req, res) => {
  try {
    const allowedFields = [
      "name", "username", "avatar", "college", "city", "country",
      "bio", "experience", "skills", "github", "linkedin", "discord", "portfolio",
        "customLinks",
      "completedHackathons",
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user });
  } catch (err) {
    console.error("[profile update]", err);
    res.status(500).json({ message: "Server error updating profile" });
  }
});

// ─── GitHub-style OTP Email Formatter ─────────────────────────────────
function formatGitHubStyleOtpEmail(name, otpCode, purpose = "authentication") {
  const digits = otpCode.split("");
  const formattedDigits = digits.join(" ");

  const title = `Please verify your identity, ${name || "Developer"}`;
  const body = `Here is your Hackord ${purpose} code:

       ${formattedDigits}

This code is valid for 10 minutes and can only be used once.

Please don't share this code with anyone: we'll never ask for it on the phone or via email.

Thanks,
The Hackord Team`;

  return { title, body, formattedDigits };
}

// ─── POST /api/auth/signup-request-otp ────────────────────────────────
router.post("/signup-request-otp", otpRequestRateLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const emailClean = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await User.findOne({ email: emailClean });
    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert OTP record
    await Otp.findOneAndUpdate(
      { email: emailClean },
      { otp: otpCode, expiresAt },
      { upsert: true, new: true }
    );

    const { title, body, formattedDigits } = formatGitHubStyleOtpEmail(name, otpCode, "registration");

    // Send email using EmailJS notification service
    await sendNotification({
      recipientUser: { email: emailClean, name },
      type: "otp",
      title,
      body,
      link: "/signup",
      metadata: { otpCode: formattedDigits },
    });

    res.json({
      success: true,
      message: `Verification code sent to ${emailClean}. Please check your inbox or spam folder.`,
    });
  } catch (err) {
    console.error("[signup-request-otp]", err);
    res.status(500).json({ message: "Failed to send verification code. Please try again." });
  }
});

// ─── POST /api/auth/signup-verify-otp ─────────────────────────────────
router.post("/signup-verify-otp", checkAuthLockoutMiddleware, async (req, res) => {
  try {
    const { name, email, password, otp } = req.body;
    const { ip, email: emailClean } = normalizeClientInfo(req, email);

    if (!name || !email || !password || !otp) {
      return res.status(400).json({ message: "Name, email, password, and OTP code are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const otpClean = otp.trim();

    // Check if user already exists
    const existingUser = await User.findOne({ email: emailClean });
    if (existingUser) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }

    // Verify OTP
    const record = await Otp.findOne({ email: emailClean });
    if (!record) {
      return res.status(400).json({ message: "No verification code requested or code expired. Please request a new one." });
    }

    if (new Date() > record.expiresAt || record.otp !== otpClean) {
      const failInfo = await recordFailedAttempt(emailClean, ip);
      if (failInfo.isLocked) {
        return res.status(429).json({
          error: "Too Many Requests",
          message: "Security Lockout: 5 failed verification attempts reached. Access is restricted for 24 hours.",
          statusCode: 429,
          retryAfterHours: 24,
          lockUntil: failInfo.lockUntil,
        });
      }
      return res.status(400).json({
        message: `Invalid or expired verification code. ${failInfo.remainingAttempts} attempt${failInfo.remainingAttempts === 1 ? "" : "s"} remaining before 24-hour lockout.`,
        attemptsRemaining: failInfo.remainingAttempts,
      });
    }

    // Delete verified OTP record & clear failed attempts
    await Otp.deleteOne({ _id: record._id });
    await clearFailedAttempts(emailClean, ip);

    // Create verified user
    const user = await User.create({
      name,
      email: emailClean,
      password,
      username: emailClean.split("@")[0],
      avatar: `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(name)}`,
      isEmailVerified: true,
    });

    const token = generateToken(user._id);

    // Trigger Welcome Email Notification
    sendNotification({
      recipientUser: user,
      type: "welcome",
      title: "Welcome to Hackord! 🎉",
      body: `Hi ${name.split(" ")[0]}, welcome to Hackord! Your email has been verified and account created. Explore hackathons, form teams, and build incredible projects.`,
      link: "/dashboard",
    }).catch((e) => console.error("[signupWelcomeNotifErr]", e.message));

    res.status(201).json({
      token,
      user: user.toJSON(),
      isNewUser: true,
    });
  } catch (err) {
    console.error("[signup-verify-otp]", err);
    if (err.code === 11000) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }
    res.status(500).json({ message: "Server error creating verified account" });
  }
});

// ─── POST /api/auth/request-otp ───────────────────────────────────────
router.post("/request-otp", otpRequestRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ message: "Valid email address is required" });
    }

    const emailClean = email.toLowerCase().trim();

    // Verify that user account already exists before sending login OTP
    const existingUser = await User.findOne({ email: emailClean });
    if (!existingUser) {
      return res.status(404).json({
        message: "No account found registered with this email address. Please sign up first.",
        redirectToSignup: true,
      });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert OTP record
    await Otp.findOneAndUpdate(
      { email: emailClean },
      { otp: otpCode, expiresAt },
      { upsert: true, new: true }
    );

    const { title, body, formattedDigits } = formatGitHubStyleOtpEmail(existingUser.name || emailClean.split("@")[0], otpCode, "authentication");

    // Send email using EmailJS notification service
    await sendNotification({
      recipientUser: { email: emailClean, name: existingUser.name || emailClean.split("@")[0] },
      type: "otp",
      title,
      body,
      link: "/login",
      metadata: { otpCode: formattedDigits },
    });

    res.json({
      success: true,
      message: `Verification code sent to ${emailClean}. Please check your inbox or spam folder.`,
    });
  } catch (err) {
    console.error("[request-otp]", err);
    res.status(500).json({ message: "Failed to send verification code. Please try again." });
  }
});

// ─── POST /api/auth/verify-otp ────────────────────────────────────────
router.post("/verify-otp", checkAuthLockoutMiddleware, async (req, res) => {
  try {
    const { email, otp } = req.body;
    const { ip, email: emailClean } = normalizeClientInfo(req, email);

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP code are required" });
    }

    const otpClean = otp.trim();

    // Verify user existence
    const user = await User.findOne({ email: emailClean });
    if (!user) {
      return res.status(404).json({
        message: "No account found with this email address. Please sign up first.",
        redirectToSignup: true,
      });
    }

    const record = await Otp.findOne({ email: emailClean });
    if (!record) {
      return res.status(400).json({ message: "No verification code requested or code expired. Please request a new one." });
    }

    if (new Date() > record.expiresAt || record.otp !== otpClean) {
      const failInfo = await recordFailedAttempt(emailClean, ip);
      if (failInfo.isLocked) {
        return res.status(429).json({
          error: "Too Many Requests",
          message: "Security Lockout: 5 failed OTP verification attempts reached. Access is restricted for 24 hours or reset your password.",
          statusCode: 429,
          retryAfterHours: 24,
          lockUntil: failInfo.lockUntil,
        });
      }
      return res.status(400).json({
        message: `Invalid or expired verification code. ${failInfo.remainingAttempts} attempt${failInfo.remainingAttempts === 1 ? "" : "s"} remaining before 24-hour lockout.`,
        attemptsRemaining: failInfo.remainingAttempts,
      });
    }

    // Delete verified OTP record & clear failed attempts
    await Otp.deleteOne({ _id: record._id });
    await clearFailedAttempts(emailClean, ip);

    const token = generateToken(user._id);

    res.json({
      token,
      user: user.toJSON(),
      isNewUser: false,
    });
  } catch (err) {
    console.error("[verify-otp]", err);
    res.status(500).json({ message: "Server error during OTP verification." });
  }
});

// ─── POST /api/auth/forgot-password-request ───────────────────────────
router.post("/forgot-password-request", otpRequestRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes("@")) {
      return res.status(400).json({ message: "Valid email address is required" });
    }

    const emailClean = email.toLowerCase().trim();

    const user = await User.findOne({ email: emailClean });
    if (!user) {
      return res.status(404).json({ message: "No account found registered with this email address." });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert OTP record
    await Otp.findOneAndUpdate(
      { email: emailClean },
      { otp: otpCode, expiresAt },
      { upsert: true, new: true }
    );

    const { title, body, formattedDigits } = formatGitHubStyleOtpEmail(user.name, otpCode, "password reset");

    await sendNotification({
      recipientUser: user,
      type: "otp",
      title,
      body,
      link: "/login",
      metadata: { otpCode: formattedDigits },
    });

    res.json({
      success: true,
      message: `Password reset verification code sent to ${emailClean}. Please check your inbox.`,
    });
  } catch (err) {
    console.error("[forgot-password-request]", err);
    res.status(500).json({ message: "Failed to send password reset code. Please try again." });
  }
});

// ─── POST /api/auth/reset-password-verify ─────────────────────────────
router.post("/reset-password-verify", checkAuthLockoutMiddleware, async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const { ip, email: emailClean } = normalizeClientInfo(req, email);

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "Email, verification code, and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const otpClean = otp.trim();

    const record = await Otp.findOne({ email: emailClean });
    if (!record) {
      return res.status(400).json({ message: "No verification code requested or code expired. Please request a new one." });
    }

    if (new Date() > record.expiresAt || record.otp !== otpClean) {
      const failInfo = await recordFailedAttempt(emailClean, ip);
      if (failInfo.isLocked) {
        return res.status(429).json({
          error: "Too Many Requests",
          message: "Security Lockout: 5 failed reset attempts reached. Access is restricted for 24 hours.",
          statusCode: 429,
          retryAfterHours: 24,
          lockUntil: failInfo.lockUntil,
        });
      }
      return res.status(400).json({
        message: `Invalid or expired verification code. ${failInfo.remainingAttempts} attempt${failInfo.remainingAttempts === 1 ? "" : "s"} remaining before 24-hour lockout.`,
        attemptsRemaining: failInfo.remainingAttempts,
      });
    }

    const user = await User.findOne({ email: emailClean });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Delete OTP record, update password & clear failed attempts
    await Otp.deleteOne({ _id: record._id });
    await clearFailedAttempts(emailClean, ip);
    user.password = newPassword;
    await user.save();

    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: user.toJSON(),
      message: "Password reset successfully!",
    });
  } catch (err) {
    console.error("[reset-password-verify]", err);
    res.status(500).json({ message: "Server error resetting password." });
  }
});

module.exports = router;
