const nodemailer = require("nodemailer");

// Create email transporter
function createEmailTransporter() {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;

  if (user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  // Fallback dev transporter (logs to console cleanly)
  return {
    sendMail: async (mailOptions) => {
      console.log("\n=======================================================");
      console.log("✉️ [EMAIL NOTIFICATION DISPATCHED]");
      console.log(`TO: ${mailOptions.to}`);
      console.log(`SUBJECT: ${mailOptions.subject}`);
      console.log("-------------------------------------------------------");
      console.log(`HTML BODY PREVIEW:\n${mailOptions.text || mailOptions.html.replace(/<[^>]+>/g, " ").slice(0, 300)}...`);
      console.log("=======================================================\n");
      return { messageId: `mock_${Date.now()}` };
    },
  };
}

const transporter = createEmailTransporter();

/**
 * Dispatch notification to Email (Gmail) based on user preferences.
 */
async function sendNotification({ recipientUser, type, title, body, link, metadata = {} }) {
  if (!recipientUser) return;

  const prefs = recipientUser.notificationPreferences || {
    emailEnabled: true,
    roomInvites: true,
    deadlines: true,
    chatMessages: true,
    reminders: true,
  };

  // Check event preference match
  if (type === "invite" && prefs.roomInvites === false) {
    console.log(`[notificationService] Room invites disabled for ${recipientUser.email}, skipping.`);
    return;
  }
  if (type === "deadline" && prefs.deadlines === false) {
    console.log(`[notificationService] Deadlines disabled for ${recipientUser.email}, skipping.`);
    return;
  }
  if (type === "chatMessage" && prefs.chatMessages === false) {
    console.log(`[notificationService] Chat messages disabled for ${recipientUser.email}, skipping.`);
    return;
  }

  const results = { emailSent: false };

  // 1. Send Email Notification if enabled
  if (prefs.emailEnabled !== false && recipientUser.email) {
    try {
      const actionUrl = link ? (link.startsWith("http") ? link : `http://localhost:5173${link}`) : "http://localhost:5173/dashboard";
      
      const htmlContent = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #0f172a; color: #f8fafc; border-radius: 16px; border: 1px solid #1e293b;">
          <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #334155;">
            <h1 style="background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 28px; margin: 0; font-weight: 800;">
              Hackord
            </h1>
            <p style="color: #94a3b8; font-size: 14px; margin-top: 4px;">Collaborative Hackathon Platform</p>
          </div>
          <div style="padding: 24px 0;">
            <h2 style="font-size: 20px; color: #ffffff; margin-top: 0;">${title}</h2>
            <p style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">${body}</p>
            ${
              metadata.roomName
                ? `<div style="background-color: #1e293b; padding: 16px; border-radius: 12px; margin: 16px 0; border-left: 4px solid #8b5cf6;">
                    <p style="margin: 0; font-weight: 600; color: #e2e8f0;">Workspace: ${metadata.roomName}</p>
                    ${metadata.hackathon ? `<p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8;">Hackathon: ${metadata.hackathon}</p>` : ""}
                  </div>`
                : ""
            }
            <div style="margin-top: 30px; text-align: center;">
              <a href="${actionUrl}" style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600; font-size: 14px; display: inline-block; box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
                Open in Hackord
              </a>
            </div>
          </div>
          <div style="text-align: center; padding-top: 20px; border-top: 1px solid #334155; font-size: 12px; color: #64748b;">
            <p style="margin: 0;">You received this notification based on your Hackord Notification Preferences.</p>
            <p style="margin: 4px 0 0 0;">Manage your alert settings anytime in Settings → Notification Preferences.</p>
          </div>
        </div>
      `;

      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"Hackord Platform" <notifications@hackord.dev>',
        to: recipientUser.email,
        subject: `[Hackord] ${title}`,
        html: htmlContent,
      });

      results.emailSent = true;
      console.log(`[notificationService] ✅ Email sent to ${recipientUser.email}`);
    } catch (err) {
      console.error(`[notificationService] ❌ Failed to send email to ${recipientUser.email}:`, err.message);
    }
  } else {
    console.log(`[notificationService] Email notification skipped for ${recipientUser.email} (disabled in preferences)`);
  }

  return results;
}

module.exports = {
  sendNotification,
};
