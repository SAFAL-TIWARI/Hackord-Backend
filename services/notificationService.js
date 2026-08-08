const nodemailer = require("nodemailer");

// Create email transporter fallback
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
      console.log("✉️ [DEV CONSOLE EMAIL DISPATCH]");
      console.log(`TO: ${mailOptions.to}`);
      console.log(`SUBJECT: ${mailOptions.subject}`);
      console.log("-------------------------------------------------------");
      console.log(`BODY PREVIEW:\n${mailOptions.text || mailOptions.html.replace(/<[^>]+>/g, " ").slice(0, 300)}...`);
      console.log("=======================================================\n");
      return { messageId: `mock_${Date.now()}` };
    },
  };
}

const transporter = createEmailTransporter();

/**
 * Dispatch notification using EmailJS REST API or SMTP fallback
 */
async function sendEmailJSEmail({ recipientUser, title, body, actionUrl, metadata = {} }) {
  const serviceId = process.env.EMAILJS_SERVICE_ID ;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY ;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY ;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;

  if (!serviceId || !publicKey) {
    return false;
  }

  const payload = {
    service_id: serviceId,
    template_id: templateId,
    user_id: publicKey,
    accessToken: privateKey,
    template_params: {
      to_name: recipientUser.name || "Hacker",
      to_email: recipientUser.email,
      user_email: recipientUser.email,
      email: recipientUser.email,
      subject: `[Hackord] ${title}`,
      title: title,
      body: body,
      message: body,
      action_url: actionUrl,
      room_name: metadata.roomName || "",
      hackathon: metadata.hackathon || "",
    },
  };

  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (response.ok) {
    console.log(`[notificationService] ✅ EmailJS notification successfully delivered to ${recipientUser.email}`);
    return true;
  } else {
    const errorText = await response.text();
    console.warn(`[notificationService] ⚠️ EmailJS API returned ${response.status}: ${errorText}. Falling back to default mailer.`);
    return false;
  }
}

/**
 * Dispatch notification to Email (Gmail) based strictly on user preferences.
 */
async function sendNotification({ recipientUser, type, title, body, link, metadata = {} }) {
  if (!recipientUser || !recipientUser.email) return { emailSent: false };

  const prefs = recipientUser.notificationPreferences || {
    emailEnabled: true,
    roomInvites: true,
    deadlines: true,
    chatMessages: true,
    reminders: true,
  };

  // Check Master Email Toggle
  if (prefs.emailEnabled === false) {
    console.log(`[notificationService] 🛑 Email Alerts (Gmail) disabled for ${recipientUser.email}, skipping email dispatch.`);
    return { emailSent: false, reason: "disabled_master_switch" };
  }

  // Check Specific Event Alert Preferences
  if (type === "invite" && prefs.roomInvites === false) {
    console.log(`[notificationService] 🛑 Room invites notifications disabled for ${recipientUser.email}, skipping.`);
    return { emailSent: false, reason: "disabled_event_invite" };
  }
  if (type === "deadline" && prefs.deadlines === false) {
    console.log(`[notificationService] 🛑 Deadlines notifications disabled for ${recipientUser.email}, skipping.`);
    return { emailSent: false, reason: "disabled_event_deadline" };
  }
  if (type === "chatMessage" && prefs.chatMessages === false) {
    console.log(`[notificationService] 🛑 Chat messages notifications disabled for ${recipientUser.email}, skipping.`);
    return { emailSent: false, reason: "disabled_event_chat" };
  }
  if (type === "reminder" && prefs.reminders === false) {
    console.log(`[notificationService] 🛑 Meeting reminders disabled for ${recipientUser.email}, skipping.`);
    return { emailSent: false, reason: "disabled_event_reminder" };
  }

  const results = { emailSent: false };
  const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5173';
  const actionUrl = link ? (link.startsWith('http') ? link : `${frontendBase}${link}`) : `${frontendBase}/dashboard`;

  // 1. Try sending via EmailJS REST API
  try {
    const emailJsSuccess = await sendEmailJSEmail({ recipientUser, title, body, actionUrl, metadata });
    if (emailJsSuccess) {
      results.emailSent = true;
      return results;
    }
  } catch (err) {
    console.error("[notificationService] Error calling EmailJS API:", err.message);
  }

  // 2. Fallback to Transporter / HTML Mailer
  try {
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
    console.log(`[notificationService] ✅ Email delivered to ${recipientUser.email} via SMTP/Console fallback.`);
  } catch (err) {
    console.error(`[notificationService] ❌ Failed to send email to ${recipientUser.email}:`, err.message);
  }

  return results;
}

module.exports = {
  sendNotification,
};
