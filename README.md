<div align="center">
  <img src="https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/server.svg" alt="Hackord Backend Logo" width="72" height="72">
  <h1>Hackord — Backend API</h1>
  <p><strong>RESTful API Engine for Hackord Collaboration Platform</strong></p>

  [![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
  [![Express](https://img.shields.io/badge/Express.js-4.21-000000?logo=express&logoColor=white)](https://expressjs.com/)
  [![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose--8.5-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)
  [![JWT](https://img.shields.io/badge/JWT-Authentication-black?logo=jsonwebtokens&logoColor=white)](https://jwt.io/)
  [![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## ⚡ Overview

**Hackord Backend** is the RESTful API service powering the Hackord collaboration workspace. Built with **Node.js**, **Express.js**, and **MongoDB**, it handles user authentication, team room management, user profile discovery, room invitations, real-time activity streams, and multi-channel notifications (Email & WhatsApp preferences).

---

## ✨ Key Features

- 🔐 **Authentication & Authorization:** Secure JWT token authentication, bcrypt password hashing, and role-based access controls.
- 👥 **User Profiles & Search:** Public builder profile management, skill tagging, search & filter API endpoints.
- 🚪 **Team Collaboration Rooms:** Workspace creation, member role hierarchy (Owner, Admin, Member), and GitHub repo linking.
- 📩 **Invitation Dispatch System:** Complete invitation lifecycle (Send, Accept, Decline, Cancel) with state management.
- 🔔 **Multi-Channel Notifications:** Event-driven notifications with Nodemailer SMTP integration and console logger fallback for local development.
- 📝 **Scratchpad & Notes API:** Persistent note creation and retrieval per user and workspace room.
- 🛡️ **Production Readiness:** Configured CORS headers, environment variable isolation, and Vercel serverless integration.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Runtime** | Node.js (v18+) |
| **Framework** | Express.js v4 |
| **Database** | MongoDB with Mongoose ODM (v8) |
| **Security** | JSON Web Tokens (`jsonwebtoken`) + `bcryptjs` |
| **Mailing Service** | Nodemailer |
| **Deployment** | Vercel / Render |

---

## 📁 Project Structure

```text
Hackord-Backend/
├── middleware/          # JWT auth verification & administrative guards
├── models/              # Mongoose data models (User, Room, Invitation, Note, etc.)
├── routes/              # Express API router modules (auth, users, rooms, invitations, notes, admin)
├── services/            # Background notification services (notificationService.js)
├── server.js            # Express app setup, CORS, route mapping & MongoDB connect
├── vercel.json          # Deployment configuration for Vercel Serverless
└── .env.example         # Environment variable template file
```

---

## 🌐 API Endpoint Summary

| Category | Endpoint Path | Description |
| :--- | :--- | :--- |
| **Auth** | `/api/auth` | Register new users, user login, JWT session check |
| **Users** | `/api/users` | Profile retrieval, user search by name/skill, settings update |
| **Rooms** | `/api/rooms` | Create/manage rooms, member list, role changes, GitHub link updates |
| **Invitations** | `/api/invitations` | Room invitation management & response handlers |
| **Notes** | `/api/notes` | User scratchpad & room project notes CRUD |
| **Admin** | `/api/admin` | System health checks, analytics, & admin management |

---

## ⚙️ Environment Variables

Create a `.env` file in `Hackord-Backend/` using `.env.example` as a starting guide:

```env
# Database & Security
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/hackord
JWT_SECRET=your_super_secret_jwt_key
PORT=3000

# Admin Credentials
ADMIN_EMAIL=admin@hackord.com
ADMIN_PASSWORD=your_admin_password

# Email / SMTP Settings (Optional - Fallback console logger used if omitted)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

---

## 🚦 Getting Started

### Prerequisites

- **Node.js** >= 18.0.0
- **MongoDB** instance (Local MongoDB server or MongoDB Atlas URI)

### Installation & Running

1. **Navigate to the Backend directory:**
   ```bash
   cd Hackord-Backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run the API server:**
   - **Development (Watch mode):**
     ```bash
     npm run dev
     ```
   - **Production:**
     ```bash
     npm start
     ```

4. **Access the API:**
   The API server will listen on `http://localhost:3000`. Test endpoint health at `http://localhost:3000/api/health` or `/api/auth`.

---

<div align="center">
  <sub>Built with ❤️ to power hackathon teams worldwide.</sub>
</div>
