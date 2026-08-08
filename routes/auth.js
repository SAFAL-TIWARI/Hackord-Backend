const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const { protect } = require("../middleware/auth");
const { sendNotification } = require("../services/notificationService");

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT
function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

// ─── POST /api/auth/signup ─────────────────────────────────────────────────
router.post("/signup", async (req, res) => {
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

// ─── POST /api/auth/login ──────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Find user (include password for comparison)
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

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

// ─── POST /api/auth/google ──────────────────────────────────────────────────
router.post("/google", async (req, res) => {
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

    let user = await User.findOne({
      $or: [{ googleId }, { email: email.toLowerCase() }],
    });

    let isNewUser = false;

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        if (!user.avatar && picture) {
          user.avatar = picture;
        }
        await user.save();
      }
    } else {
      isNewUser = true;
      const baseUsername = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
      user = await User.create({
        name: name || "Developer",
        email: email.toLowerCase(),
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

// ─── POST /api/auth/github ──────────────────────────────────────────────────
router.post("/github", async (req, res) => {
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

    let user = await User.findOne({
      $or: [{ githubId }, { email: email.toLowerCase() }],
    });

    let isNewUser = false;

    if (user) {
      if (!user.githubId) {
        user.githubId = githubId;
      }
      // Automatically store/update github profile URL if not set
      if (!user.github || user.github === "") {
        user.github = githubUrl;
      }
      if (!user.avatar && ghProfile.avatar_url) {
        user.avatar = ghProfile.avatar_url;
      }
      await user.save();
    } else {
      isNewUser = true;
      const baseUsername = ghProfile.login || email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
      user = await User.create({
        name: ghProfile.name || ghProfile.login || "GitHub Developer",
        email: email.toLowerCase(),
        githubId,
        username: baseUsername,
        avatar: ghProfile.avatar_url || `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(ghProfile.login || email)}`,
        github: githubUrl, // Automatically set profile GitHub URL!
        bio: ghProfile.bio || "",
      });

      sendNotification({
        recipientUser: user,
        type: "welcome",
        title: "Welcome to Hackord! 🎉",
        body: `Hi ${(user.name || "there").split(" ")[0]}, welcome to Hackord! Your account has been created via GitHub. Explore hackathons, form teams, and build incredible projects.`,
        link: "/dashboard",
      }).catch((e) => console.error("[githubSignupWelcomeNotifErr]", e.message));
    }

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

// ─── GET /api/auth/me ──────────────────────────────────────────────────────
router.get("/me", protect, async (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (err) {
    console.error("[me]", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ─── PUT /api/auth/profile ─────────────────────────────────────────────────
router.put("/profile", protect, async (req, res) => {
  try {
    const allowedFields = [
      "name", "username", "avatar", "college", "city", "country",
      "bio", "experience", "skills", "github", "linkedin", "portfolio",
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

module.exports = router;
