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
  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY;
  const privateKey = process.env.EMAILJS_PRIVATE_KEY;
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
      otp_code: metadata.otpCode || "",
      otp: metadata.otpCode || "",
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

  // Check Master Email Toggle (account deletion bypasses preference check as it is a critical security email)
  if (type !== "accountDeletion" && prefs.emailEnabled === false) {
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
    const formattedBodyHtml = body
      .split("\n\n")
      .map(
        (p) =>
          `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.65; color: #CBD5E1;">${p.replace(/\n/g, "<br/>")}</p>`
      )
      .join("");

    const buttonLabel = metadata.buttonText || "Open in Hackord →";

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #060813; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #F8FAFC;">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #060813; background-image: radial-gradient(circle at 50% 0%, rgba(139, 92, 246, 0.25) 0%, transparent 65%), radial-gradient(circle at 100% 100%, rgba(56, 189, 248, 0.15) 0%, transparent 60%); padding: 40px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background: rgba(13, 17, 39, 0.85); border-radius: 24px; border: 1px solid rgba(139, 92, 246, 0.3); overflow: hidden; box-shadow: 0 30px 70px -10px rgba(0, 0, 0, 0.7);">
                <tr>
                  <td style="padding: 36px 32px 24px 32px; background: linear-gradient(180deg, rgba(30, 27, 75, 0.7) 0%, rgba(13, 17, 39, 0.9) 100%); text-align: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
                    <a href="https://hackord.vercel.app" target="_blank" style="text-decoration: none; display: inline-block;">
                      <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                        <tr>
                          <td style="vertical-align: middle; padding-right: 12px;">
                            <img src="https://hackord.vercel.app/logo.png" alt="Hackord Logo" width="42" height="42" style="display: block; border: 0; outline: none; border-radius: 10px;" />
                          </td>
                          <td style="vertical-align: middle;">
                            <span style="font-size: 28px; font-weight: 800; letter-spacing: -0.5px; background: linear-gradient(135deg, #8B5CF6 0%, #38BDF8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; color: #8B5CF6; display: inline-block;">
                              Hackord
                            </span>
                          </td>
                        </tr>
                      </table>
                    </a>
                    <p style="margin: 8px 0 0 0; font-size: 13px; color: #94A3B8; font-weight: 500;">
                      Real-Time Collaborative Hackathon Workspaces
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 36px 32px;">
                    <h2 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 700; color: #FFFFFF;">
                      ${title}
                    </h2>
                    <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #E2E8F0;">
                      Hi <strong style="color: #FFFFFF;">${recipientUser.name || "Hacker"}</strong>,
                    </p>
                    ${formattedBodyHtml}
                    ${type === "accountDeletion"
        ? `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 20px 0 24px 0; background: rgba(239, 68, 68, 0.1); border-left: 4px solid #EF4444; border-radius: 12px;">
                            <tr>
                              <td style="padding: 14px 18px;">
                                <p style="margin: 0; font-size: 13px; font-weight: 600; color: #FCA5A5;">
                                  🔒 Account Status: Permanently Deleted
                                </p>
                                <p style="margin: 4px 0 0 0; font-size: 12px; color: #94A3B8;">
                                  If you did not initiate this request, please contact security immediately at <a href="mailto:hackord.support@gmail.com" style="color: #38BDF8; text-decoration: underline;">hackord.support@gmail.com</a>.
                                </p>
                              </td>
                            </tr>
                          </table>`
        : ""
      }
                    ${metadata.roomName
        ? `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 24px 0; background: rgba(139, 92, 246, 0.08); border-left: 4px solid #8B5CF6; border-radius: 12px;">
                            <tr>
                              <td style="padding: 16px 20px;">
                                <p style="margin: 0; font-size: 14px; font-weight: 600; color: #F8FAFC;">Workspace: ${metadata.roomName}</p>
                                ${metadata.hackathon ? `<p style="margin: 6px 0 0 0; font-size: 13px; color: #94A3B8;">Hackathon: ${metadata.hackathon}</p>` : ""}
                              </td>
                            </tr>
                          </table>`
        : ""
      }
                    <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin-top: 36px; width: 100%;">
                      <tr>
                        <td align="center">
                          <a href="${actionUrl}" target="_blank" style="background: linear-gradient(135deg, #8B5CF6 0%, #38BDF8 100%); color: #FFFFFF; text-decoration: none; padding: 15px 36px; border-radius: 9999px; font-weight: 700; font-size: 15px; display: inline-block; box-shadow: 0 10px 25px -4px rgba(139, 92, 246, 0.45);">
                            ${buttonLabel}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 32px; background-color: rgba(6, 8, 19, 0.95); text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 12px; color: #64748B;">
                    <p style="margin: 0 0 6px 0;">This email confirms a key action on your <strong>Hackord Account</strong>.</p>
                    <p style="margin: 0;">Hackord Platform • Real-Time Collaboration for Hackers</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
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
