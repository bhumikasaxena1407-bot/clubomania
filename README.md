# ClubHub — Student Club Management System

A college-project MVP built with React, Express and SQLite. It includes role-based demo accounts, club directory, event management and registration, rotating QR attendance, mentor review queue, announcements, PDF certificates, CSV student import and basic analytics.

## Run locally

Requirements: Node.js 20+ and npm. From this `clubhub` folder run:

```bash
npm install
npm --prefix server install
npm --prefix client install
npm run dev
```

Open `http://localhost:5173`. The API runs on `http://localhost:4000`.

## Demo accounts

All use password `clubhub123`.

| Role | Email |
|---|---|
| Admin | admin@clubhub.edu |
| Coordinator | coordinator@clubhub.edu |
| Mentor | mentor@clubhub.edu |
| Student | student@clubhub.edu |

## Deploy as one public HTTPS website (Render)

The production build serves the React app and API from the same Express service, so the browser does not call `localhost`.

1. Push this `clubhub` folder to a GitHub repository.
2. In Render, create **New → Web Service** and connect the repository.
3. Set **Root Directory** to `.` if the repository root contains `package.json`. Choose **Web Service**, not Static Site, because ClubHub includes an Express API.
4. Build command: `npm install && npm --prefix server install && npm run build`
5. Start command: `npm start`
6. Set environment variable `JWT_SECRET` to a long random secret. Set Node version to 20 or newer if Render asks.
7. For persistent SQLite data, attach a persistent disk mounted at `/var/data` and set `CLUBHUB_DB_PATH=/var/data/clubhub.sqlite`. Render persistent disks are a paid feature. Without a persistent disk, SQLite data can be lost on restart/redeploy.
8. Deploy. Render will provide a public `https://<service-name>.onrender.com` URL. Share that URL.

Render free web services can sleep after inactivity, so the first visit may take a little time to wake. A persistent disk is required if you want SQLite data to survive service restarts and deployments. For a real college rollout, migrate SQLite to managed PostgreSQL and configure backups.

## CSV import

Required columns: `name,email,roll_number`. Optional: `department,semester,mentor_id`. Imported accounts currently receive the temporary password `Welcome@123`; implement secure password reset before using real student data.

## MVP limitations / security

- This is a development/demo starter, not production-ready college identity or attendance software.
- Replace the default JWT secret using the `JWT_SECRET` environment variable.
- Add rate limiting, CSRF protections as appropriate, secure cookie-based sessions, backups, and robust secrets management before real deployment.
- Rotating QR tokens reduce stale screenshot sharing but do not prove physical presence. Device identifiers can be reset or spoofed. GPS/geofencing is not implemented.
- Email delivery, college SSO, password reset, advanced scheduling rules and certificate template designer are not included.
- Replace demo users and sample club data with approved college data. Do not upload real student information until privacy, security and institutional approval requirements are met.
