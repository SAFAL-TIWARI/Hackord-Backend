# 🧠 Hackord Backend — Project Brain & Architecture Knowledge Base

> **Location:** `Hackord-Backend/brain.md`  
> **Last Updated:** August 2026  
> **Role & Purpose:** Master single-source-of-truth document for the Hackord Backend API. Antigravity and any AI assistant or developer should reference this file to understand the complete backend architecture, database schemas, API routes, third-party integrations, services, and lifecycle workflows without rescanning the entire repository.

---

## 📌 1. Project Overview & Architecture

**Hackord Backend** is a high-performance REST API built with Node.js, Express, and MongoDB Atlas. It powers real-time hackathon management, virtual team collaboration workspaces, AI-assisted development tools (Gemini multimodal integration), real-time direct & group communication, automated hackathon scraping across top global platforms, Agora WebRTC video meeting token generation, and multi-channel notifications (EmailJS / SMTP).

### Key Architectural Pillars:
- **Serverless & Container Ready:** Dual support for Node.js long-running processes (Render / Local) and Vercel Serverless Functions (`vercel.json` + `module.exports = app`).
- **Dynamic CORS Engine:** Strict yet permissive CORS policy supporting dynamic frontend URLs, localhost ports, Vercel/Render preview deployments, and mobile/curl clients.
- **Connection Resilience:** Automatic MongoDB Atlas connection middleware ensuring active database sessions per request with IPv4 DNS overrides for SRV records.
- **Automated Seeding:** Auto-provisions and synchronizes configured Admin accounts on server startup.
- **Background Cron Engine:** Automated 24-hour daily hackathon scraper aggregating events from 6 top developer platforms into a curated staging system.

---

## 🛠️ 2. Tech Stack & Dependencies

| Category | Technology / Library | Version / Details | Purpose |
| :--- | :--- | :--- | :--- |
| **Runtime & Framework** | Node.js / Express | `^4.21.0` | HTTP routing, middleware, REST endpoints |
| **Database & ODM** | MongoDB Atlas / Mongoose | `^8.5.1` | Document database, schemas, indexes, TTL |
| **Authentication & Security**| JSON Web Tokens (`jsonwebtoken`) | `^9.0.2` | Stateless 7-day auth tokens |
| | `bcryptjs` | `^2.4.3` | Password hashing with salt rounds (12) |
| | `google-auth-library` | `^11.0.0` | Google OAuth token verification |
| | `agora-token` | `^2.0.5` | Dynamic RTC token generation for WebRTC |
| **AI & LLM Integration** | Google Gemini API (REST) | `gemini-3.7-flash`, etc. | Multimodal text, image, audio, video & PDF processing |
| | `cheerio` & `axios` | `^1.2.0` / `^1.19.0` | Live web link scraping for AI context & hackathon aggregation |
| | `pdf-parse` | `^2.4.5` | PDF text extraction for workspace documents |
| **Notifications & Mail** | EmailJS REST API / `nodemailer` | `^9.0.3` | HTML transactional emails (OTPs, invites, welcome, deletions) |

---

## ⚙️ 3. Environment Variables Reference

| Variable Name | Required | Example / Default | Description |
| :--- | :---: | :--- | :--- |
| `PORT` | Optional | `3000` | Server listening port |
| `MONGODB_URI` | **Yes** | `mongodb+srv://...` | MongoDB Atlas connection string |
| `JWT_SECRET` | **Yes** | `your_jwt_secret_key` | Secret used for signing & verifying JWT tokens |
| `FRONTEND_URL` | Optional | `http://localhost:5173` | Comma-separated list of allowed CORS origins |
| `ADMIN1_EMAIL` | Optional | `admin@hackord.com` | Primary platform administrator email (auto-seeded) |
| `ADMIN1_PASSWORD` | Optional | `admin_password` | Primary administrator password |
| `ADMIN2_EMAIL` | Optional | `hackord.support@gmail.com` | Secondary support administrator email |
| `ADMIN2_PASSWORD` | Optional | `support_password` | Secondary support administrator password |
| `GOOGLE_CLIENT_ID` | Optional | `*.apps.googleusercontent.com` | Google OAuth client ID for ID token validation |
| `GITHUB_CLIENT_ID` | Optional | `Ov23li...` | GitHub OAuth application Client ID |
| `GITHUB_CLIENT_SECRET`| Optional | `gh_secret...` | GitHub OAuth application Client Secret |
| `VITE_AGORA_APP_ID` | Optional | `agora_app_id` | Agora RTC Project App ID |
| `AGORA_APP_CERTIFICATE`| Optional | `agora_app_cert` | Agora RTC Project App Certificate (token generation) |
| `GEMINI_API_KEY` | **Yes** | `AIzaSy...` | Google Gemini API Key for AI Workspace |
| `EMAILJS_SERVICE_ID` | Optional | `service_hackord` | EmailJS service ID for transactional emails |
| `EMAILJS_PUBLIC_KEY` | Optional | `user_public_key` | EmailJS public key |
| `EMAILJS_PRIVATE_KEY`| Optional | `accessToken` | EmailJS private access token |
| `EMAILJS_TEMPLATE_ID`| Optional | `template_otp` | EmailJS email template ID |
| `SMTP_HOST` | Optional | `smtp.gmail.com` | SMTP fallback mail server host |
| `SMTP_PORT` | Optional | `587` | SMTP mail server port |
| `SMTP_USER` / `GMAIL_USER`| Optional | `noreply@hackord.dev` | SMTP mail username |
| `SMTP_PASS` / `GMAIL_APP_PASSWORD`| Optional | `app_password` | SMTP mail password |
| `SMTP_FROM` | Optional | `"Hackord" <noreply@hackord.dev>`| Default outgoing sender identity |

---

## 🗄️ 4. Data Models & Database Schemas (`models/`)

### 1. `User.js` (`User` Collection)
- **Fields:**
  - `name`: String (Required, trimmed)
  - `email`: String (Required, unique, lowercase, trimmed)
  - `password`: String (Required if no OAuth ID)
  - `googleId`: String (OAuth identifier)
  - `githubId`: String (OAuth identifier)
  - `role`: Enum `["user", "admin"]` (Default: `"user"`)
  - `username`: String (Default derived from email/name)
  - `avatar`: String (DiceBear SVG URL or OAuth avatar)
  - `college`, `city`, `country`, `bio`: String
  - `experience`: Enum `["Beginner", "Intermediate", "Advanced"]`
  - `skills`: Array of Strings (`["React", "TypeScript", "Node.js", ...]`)
  - `github`, `linkedin`, `portfolio`: String URLs
  - `completedHackathons`: `[{ name: String, result: String }]`
  - `lastActive`: Date (Updated via `/api/users/heartbeat`)
  - `notificationPreferences`:
    - `emailEnabled`: Boolean (Default: `true`)
    - `roomInvites`: Boolean (Default: `true`)
    - `deadlines`: Boolean (Default: `true`)
    - `chatMessages`: Boolean (Default: `true`)
    - `desktopNotifications`: Boolean (Default: `true`)
    - `reminders`: Boolean (Default: `false`)
  - `privacySettings`:
    - `discoverable`: Boolean (Default: `true`)
    - `allowInvites`: Boolean (Default: `true`)
    - `allowDirectMessages`: Boolean (Default: `true`)
    - `showEmail`: Boolean (Default: `true`)
    - `showOnlineStatus`: Boolean (Default: `true`)
    - `activityStatus`: Boolean (Default: `true`)
- **Hooks & Methods:**
  - `pre("save")`: Hashes password with bcrypt (12 salt rounds) if modified.
  - `comparePassword(candidatePassword)`: Validates bcrypt password match.
  - `toJSON()`: Strips `password` hash before returning to API clients.

### 2. `Room.js` (`Room` Collection)
- **Core Fields:**
  - `id`: String (Unique room identifier, slug + timestamp)
  - `creator_id`, `creator_email`, `creator_name`: Room lead details
  - `hackathon`: String (Target hackathon name)
  - `name`: String (Unique room name, case-insensitive check)
  - `problem`, `description`: String
  - `github_url`: String (Repository link for workspace integration)
  - `meeting_code`: String (Agora WebRTC room channel)
  - `max_size`: Number (Default: 6)
  - `status`: Enum `["Active", "Planning", "Submission"]` (Default: `"Planning"`)
  - `progress`: Number (0 to 100%, computed from completed tasks)
  - `deadline_registration`, `deadline_ppt`, `deadline_prototype`, `deadline_final`, `deadline_result`: String dates
- **Sub-schemas:**
  - `members`: `[{ user_id, user_name, user_avatar, role }]`
  - `project_links`: `[{ label, url }]`
  - `files`: `[{ id, name, url, type, uploadedBy, size, createdAt }]`
  - `tasks`: `[{ id, title, assignee, status ("Todo"|"In Progress"|"Completed"), priority ("Low"|"Medium"|"High"), deadline, createdAt }]`
  - `messages`: `[{ id, author_name, author_avatar, text, pinned, created_at, recipient_name, reply_to, edited }]`
  - `activities`: `[{ id, who, what, when }]`
- **Business Logic Enforced:** Single Hackathon Rule (a user cannot create or join multiple rooms for the same hackathon).

### 3. `AiConversation.js` (`AiConversation` Collection)
- **Fields:**
  - `id`: String (Unique conversation ID, e.g. `chat-...`)
  - `roomId`: String (Indexed; conversations are shared among room members)
  - `userId`, `author_name`, `author_avatar`: Creator information
  - `title`: String (Auto-summarized from prompt or custom)
  - `pinned`: Boolean (Pinned conversations stay at top)
  - `activePlugin`: String (e.g., `"Flowchart Suite"`, `"Generate PPT"`, `"Generate README"`)
  - `messages`: Array of `AiMessageSchema`:
    - `id`, `sender` (`"user"` | `"ai"`), `author_name`, `author_avatar`, `text`, `timestamp`, `date`, `plugin`
    - `fileAttachment`: `{ id, name, size, type, dataUrl, extractedText, uploadedAt, author_name, author_id }`
    - `structuredData`: Mixed (stores model information, diagram parameters, etc.)
- **Optimization:** Heavy Base64 `dataUrl` is stripped in listings (`GET /conversations`) and loaded on-demand via `GET /files/:id`.

### 4. `AiFile.js` (`AiFile` Collection)
- **Fields:** `id`, `roomId`, `userId`, `filename`, `mimeType`, `fileSize`, `extractedText`, `base64Data`.
- **Purpose:** Dedicated binary storage collection for attachments (images, PDFs, audio, video) up to 5MB, keeping conversation docs lightweight.

### 5. `ChatMessage.js` (`ChatMessage` Collection)
- **Fields:**
  - `id`: String (Unique message identifier)
  - `chatType`: Enum `["general", "direct"]`
  - `author_id`, `author_name`, `author_username`, `author_avatar`, `author_role`
  - `recipient_id`, `recipient_name`, `recipient_username`, `recipient_avatar` (For direct chats)
  - `text`: String
  - `audio_url`: String (For voice messages recorded in browser)
  - `audio_duration`: Number (Voice message duration in seconds)
  - `pinned`, `edited`, `is_important`: Boolean (Admin broadcast flag)
  - `reply_to`: `{ id, text, author_name, chatType }`
  - `read_by`: Array of user IDs (Read receipts)
  - `deleted_by`: Array of user IDs (WhatsApp-style soft delete per user)

### 6. `Hackathon.js` (`Hackathon` Collection)
- **Fields:** `name`, `organizer`, `banner`, `prizePool`, `prizePoolUSD`, `mode` (`"Online"`|`"Offline"`|`"Hybrid"`), `level` (`"State"`|`"National"`|`"Global"`), `registrationDeadline`, `submissionDeadline`, `resultDate`, `teamSize` (`{ min, max }`), `tags`, `platform`, `platformUrl`, `description`, `createdBy`.

### 7. `HackathonSubmission.js` (`HackathonSubmission` Collection)
- **Fields:** `name`, `organizer`, `contactEmail`, `banner`, `prizePool`, `prizePoolUSD`, `mode`, `level`, `registrationDeadline`, `submissionDeadline`, `resultDate`, `teamSize`, `tags`, `platform`, `platformUrl`, `description`, `status` (`"pending"`|`"approved"`|`"rejected"`), `submittedBy`.

### 8. `Invitation.js` (`Invitation` Collection)
- **Fields:** `sender` (`{ user_id, name, avatar, email }`), `recipient` (`{ user_id, name, avatar, email }`), `roomId`, `roomName`, `hackathon`, `message`, `status` (`"pending"`|`"accepted"`|`"rejected"`).

### 9. `Note.js` (`Note` Collection)
- **Fields:** `user_id`, `user_email`, `title`, `content`.

### 10. `Otp.js` (`Otp` Collection)
- **Fields:** `email`, `otp`, `expiresAt`.
- **TTL Index:** Automatically deleted from database 10 minutes after creation (`expireAfterSeconds: 600`).

### 11. `ContactMessage.js` (`ContactMessage` Collection)
- **Fields:** `name`, `email`, `category`, `subject`, `message`, `status` (`"unread"`|`"read"`|`"resolved"`), `submittedBy`.

---

## 📡 5. Complete REST API Specifications

### 🔐 Authentication (`/api/auth`)
| Method | Endpoint | Protection | Description |
| :--- | :--- | :---: | :--- |
| `POST` | `/api/auth/signup` | Public | Register with Name, Email, Password; sends welcome email |
| `POST` | `/api/auth/login` | Public | Authenticate with Email & Password |
| `POST` | `/api/auth/google` | Public | Google One-Tap & OAuth token exchange |
| `POST` | `/api/auth/github` | Public | GitHub OAuth code exchange |
| `GET` | `/api/auth/me` | `Bearer JWT` | Get current authenticated user profile |
| `PUT` | `/api/auth/profile` | `Bearer JWT` | Update profile fields (bio, skills, links, experience, college) |
| `POST` | `/api/auth/signup-request-otp` | Public | Send 6-digit verification OTP for signup |
| `POST` | `/api/auth/signup-verify-otp` | Public | Verify OTP & create verified user account |
| `POST` | `/api/auth/request-otp` | Public | Passwordless login OTP request |
| `POST` | `/api/auth/verify-otp` | Public | Verify login OTP and issue JWT |
| `POST` | `/api/auth/forgot-password-request` | Public | Request password reset code via email |
| `POST` | `/api/auth/reset-password-verify` | Public | Verify reset OTP and set new password |

### 🏢 Team Rooms (`/api/rooms`)
| Method | Endpoint | Protection | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/rooms` | Public / Filtered | List rooms by user ID/email/name or `all=true` |
| `GET` | `/api/rooms/:id` | Public | Get single room details with all sub-entities |
| `GET` | `/api/rooms/:id/token` | Public | Generate dynamic Agora RTC Token for video meetings |
| `POST` | `/api/rooms` | Public / Auth | Create new room (enforces unique name & single hackathon rule) |
| `PUT` | `/api/rooms/:id` | Public / Auth | Update room details, milestones, meeting codes |
| `DELETE`| `/api/rooms/:id` | Public / Auth | Delete room permanently |
| `POST` | `/api/rooms/:id/members` | Public / Auth | Add member to room (enforces room capacity) |
| `POST` | `/api/rooms/:id/leave` | Public / Auth | Member self-leave from room |
| `DELETE`| `/api/rooms/:id/members/:userId` | Public / Auth | Remove member from room |
| `GET` | `/api/rooms/:id/messages` | Public | Get room messages (supports `?since=` timestamp polling) |
| `POST` | `/api/rooms/:id/messages` | Public | Post room chat message |
| `PUT` | `/api/rooms/:id/messages/:msgId` | Public | Edit message text or toggle pinned status |
| `DELETE`| `/api/rooms/:id/messages/:msgId` | Public | Delete room message |
| `POST` | `/api/rooms/:id/files` | Public | Add file resource or external URL |
| `POST` | `/api/rooms/:id/tasks` | Public | Create new task (recalculates room progress) |
| `PATCH`| `/api/rooms/:id/tasks/:taskId` | Public | Update task status (`Todo` $\to$ `In Progress` $\to$ `Completed`) |
| `DELETE`| `/api/rooms/:id/tasks/:taskId` | Public | Delete task (recalculates room progress) |
| `POST` | `/api/rooms/:id/links` | Public | Add project link |

### 🤖 AI Workspace (`/api/ai`)
| Method | Endpoint | Protection | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/ai/conversations` | Public / Query | List AI conversations for room (`roomId` required) |
| `GET` | `/api/ai/files/:id` | Public | Fetch full Base64 dataUrl on-demand for preview |
| `POST` | `/api/ai/conversations` | Public | Create new AI conversation session |
| `PUT` | `/api/ai/conversations/:id` | Public | Rename, pin/unpin, or switch active plugin |
| `DELETE`| `/api/ai/conversations/:id` | Public | Delete AI conversation |
| `POST` | `/api/ai/upload` | Public | Upload & analyze file (PDF text extraction, 5MB limit) |
| `POST` | `/api/ai/scrape-link` | Public | Scrape external URL with Cheerio for context |
| `POST` | `/api/ai/chat` | Public | Process prompt with Gemini multi-model fallback & conversation history |
| `POST` | `/api/ai/chat/stream` | Public | Real-time SSE word-by-word/line-by-line streaming output with prompt editing (`editMessageId`), cancellation/abort preservation, and MongoDB persistence |
| `PUT` | `/api/ai/conversations/:id/messages/:msgId` | Public | Edit specific message text in AI conversation |

### 💬 Global & Direct Chat (`/api/chat`)
| Method | Endpoint | Protection | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/chat/messages` | Public / Query | Fetch General or Direct chat messages (max 300) |
| `POST` | `/api/chat/messages` | Public | Send message (text, voice audio, replies, broadcast) |
| `PUT` | `/api/chat/messages/:messageId`| Public | Edit message or toggle pin |
| `DELETE`| `/api/chat/messages/:messageId`| Public | Delete message |
| `GET` | `/api/chat/conversations` | Public / Query | User's active conversation list with unread counts & online status |
| `POST` | `/api/chat/read` | Public | Mark general or direct messages as read |
| `DELETE`| `/api/chat/conversations/:otherUserId` | Public | WhatsApp-style conversation hide/clear |

### 👥 Users & Profiles (`/api/users`)
| Method | Endpoint | Protection | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/users/search` | Public / Query | Search users by name, skills, college, experience with privacy filters |
| `POST` | `/api/users/heartbeat` | Public / Auth | Update user `lastActive` timestamp (online presence) |
| `GET` | `/api/users/settings` | Public / Auth | Fetch user privacy & notification preferences |
| `PUT` | `/api/users/settings` | Public / Auth | Update privacy toggles & notification preferences |
| `DELETE`| `/api/users/me` | Public / Auth | Permanently purge account, delete invites, send confirmation email |
| `GET` | `/api/users/:id` | Public | Fetch user profile by ID, username, or email |

### ✉️ Team Invitations (`/api/invitations`)
| Method | Endpoint | Protection | Description |
| :--- | :--- | :---: | :--- |
| `POST` | `/api/invitations` | Auth / Verified | Send room invitation (validates ownership, capacity, privacy) |
| `GET` | `/api/invitations/me` | Public / Query | Fetch user's pending invitations |
| `POST` | `/api/invitations/:id/accept`| Public | Accept invitation and automatically join room |
| `POST` | `/api/invitations/:id/reject`| Public | Decline invitation |

### 🏆 Hackathons & Scraper (`/api/hackathons`)
| Method | Endpoint | Protection | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/hackathons` | Public | Get hackathons (filters: `level`, `mode`, `platform`) |
| `POST` | `/api/hackathons/scrape` | `Admin Only` | Trigger live multi-platform scraper into JSON file |
| `POST` | `/api/hackathons/submit-host-request`| Public | Submit public "Host Your Hackathon" application |
| `POST` | `/api/hackathons` | `Admin Only` | Create verified hackathon directly |
| `DELETE`| `/api/hackathons/:id` | `Admin Only` | Delete hackathon |

### 📝 Notes Scratchpad (`/api/notes`)
| Method | Endpoint | Protection | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/notes` | Public / Query | Get user's personal scratchpad notes |
| `POST` | `/api/notes` | Public | Save new scratchpad note |
| `DELETE`| `/api/notes/:id` | Public | Delete scratchpad note |

### 📬 Contact & Support (`/api/contact`)
| Method | Endpoint | Protection | Description |
| :--- | :--- | :---: | :--- |
| `POST` | `/api/contact` | Public | Submit "Send us message" query |

### 🛡️ Admin Suite (`/api/admin`)
| Method | Endpoint | Protection | Description |
| :--- | :--- | :---: | :--- |
| `GET` | `/api/admin/users` | `Admin Only` | Paginated user management with multi-field search |
| `GET` | `/api/admin/stats` | `Admin Only` | Platform KPIs: signups, skills distribution, experience |
| `GET` | `/api/admin/scraped-file-status` | `Admin Only` | Check status of scraped staging JSON file |
| `POST` | `/api/admin/trigger-scrape` | `Admin Only` | Manually run web scrapers |
| `POST` | `/api/admin/feed-scraped-hackathons` | `Admin Only` | Admin approval: merge staged JSON to MongoDB |
| `DELETE`| `/api/admin/scraped-hackathons/:id`| `Admin Only` | Reject & remove item from staged JSON |
| `GET` | `/api/admin/host-requests` | `Admin Only` | List community host submissions |
| `POST` | `/api/admin/host-requests/:id/approve` | `Admin Only` | Approve host submission & publish to Explore |
| `DELETE`| `/api/admin/host-requests/:id` | `Admin Only` | Reject host submission |
| `GET` | `/api/admin/contact-messages` | `Admin Only` | List contact queries |
| `DELETE`| `/api/admin/contact-messages/:id`| `Admin Only` | Delete contact query |

---

## 🧠 6. Core Services Deep-Dive

### 1. `geminiService.js` (AI Workspace Engine)
- **Model Cascading Fallback:** Attempts generation and streaming through ordered models (`gemini-3.7-flash`, `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-flash-latest`, `gemini-3.1-flash-lite`, `gemini-2.5-flash`, `gemma-4-26b`, `gemini-3-flash-live`).
- **Real-Time Token Streaming (`processAiChatStream`):** Calls Gemini's `streamGenerateContent?alt=sse` endpoint with live SSE token parsing and `onChunk` callback; handles client abort cleanly with partial response saving.
- **Diagrams & Flowcharts:** Forces strict, syntactically clean GitHub Flavored Markdown `mermaid` blocks for 17+ diagram types (process flows, swimlanes, data flows, decision trees, architecture diagrams).
- **Interactive Charts:** Generates structured `chart` JSON blocks (area, bar, stacked-bar, radar, pareto, donut, pie, kpi, sparkline, geo-bubble, histogram).
- **12+ Plugin Prompts:** Specific instructions for `Generate PPT` (standardized `# Slide X:` format), `Generate README`, `Idea Validation` (6 dimensions), `Tech Stack`, `Task Breakdown`, `Pitch Generator`, `Demo Script`, `Elevator Pitch`, and `Business Model`.
- **Multimodal Ingestion:** Handles base64 audio transcription, video frame analysis, image analysis, and PDF text extraction.
- **Link Scraping:** Extracts URLs in prompt and fetches HTML content via Cheerio.

### 2. `scraperService.js` (Hackathon Aggregator)
- **Supported Platforms:** Devpost API, Unstop Opportunity API, Major League Hacking (MLH), Devfolio API, Luma events, and Google Developer Groups (GDG).
- **Staging Architecture:** Saves to `data/scraped_hackathons.json` first.
- **Quality Filters:** 
  1. Skips past deadlines (registration/submission < today).
  2. Skips closed registration events.
  3. Verifies URLs with HTTP `validateStatus < 400` to prevent 404 links.
- **Admin Ingestion:** Admin reviews in dashboard and merges new/updated hackathons to MongoDB.
- **Automated Scheduler:** Runs in background every 24 hours.

### 3. `notificationService.js` (Multi-Channel Dispatcher)
- **Delivery Strategy:** Priority 1: EmailJS REST API $\to$ Priority 2: Nodemailer SMTP $\to$ Priority 3: Console Logger.
- **Preference Aware:** Respects user's notification preferences before sending (except critical security notifications like account deletion).
- **Branded Templates:** High-conversion HTML emails featuring gradients, dark-mode styling, and call-to-action buttons.

---

## 🔄 7. Guidelines for Updating `brain.md`

Whenever changes are made to the backend codebase:
1. **New Route / Endpoint:** Add method, path, authentication level, and behavior in Section 5.
2. **Schema Modification:** Update fields, defaults, indexes, or hooks in Section 4.
3. **New Dependency / Tool:** Record in Section 2 with version and purpose.
4. **New Service Feature:** Document logic, fallback flow, or external APIs in Section 6.
5. **Config Changes:** Update environment variables in Section 3.
