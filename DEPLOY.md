# Deploying MTGDoku

This guide covers deploying the **backend** on Render and the **frontend** on GitHub Pages, then connecting them.

---

## 1. Deploy the backend on Render

The backend is the Node/Express server (`server.js`) that serves `/api/board` and uses SQLite. Render will run it as a Web Service.

### Option A: Use the Blueprint (recommended)

1. Go to [dashboard.render.com](https://dashboard.render.com) and sign in (GitHub is fine).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub account if needed, then select the **MTGDoku** repository.
4. Render will detect `render.yaml` in the repo. Click **Apply**.
5. It will create a **Web Service** named `mtgdoku-api`. Wait for the first deploy to finish (Build + Deploy).
6. Open the service → **Settings** → note the **URL**, e.g. `https://mtgdoku-api-xxxx.onrender.com`. This is your **backend URL**.

### Option B: Create the service manually

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New +** → **Web Service**.
2. Connect the **MTGDoku** repo and select it.
3. Use:
   - **Name:** `mtgdoku-api` (or any name).
   - **Region:** Oregon (or closest to you).
   - **Branch:** `main`.
   - **Runtime:** Node.
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** Free (or paid if you prefer).
4. Click **Create Web Service**. After the first deploy, copy the service URL (e.g. `https://mtgdoku-api-xxxx.onrender.com`).

### Notes for Render

- **PORT:** Render sets `PORT`; your app already uses `process.env.PORT || 3000`.
- **SQLite:** The database file lives on the instance’s disk. On Render’s free tier the filesystem is **ephemeral**—puzzles reset on redeploy. For persistent data you’d need a Render Disk (paid) or switch to a hosted DB later.
- **CORS:** The server is already configured to allow requests from `*.github.io` and localhost.

---

## 2. Point the frontend at the backend

When the frontend is served from GitHub Pages, it must call your Render URL, not the same origin.

1. Open **`js/game.js`** in the repo.
2. Find the line that sets the backend URL when on GitHub Pages (search for `YOUR-BACKEND-HOST-HERE` or `isGitHubPages`).
3. Replace the placeholder with your Render service URL **without** a trailing slash, e.g.:

   ```js
   const BACKEND_BASE = isGitHubPages
       ? 'https://mtgdoku-api-xxxx.onrender.com'   // your actual Render URL
       : window.location.origin;
   ```

4. Save and push to GitHub so the GitHub Pages site uses the updated `game.js`.

---

## 3. Turn on GitHub Pages (frontend)

1. In GitHub, open the **MTGDoku** repo → **Settings** → **Pages**.
2. Under **Build and deployment**:
   - **Source:** Deploy from a branch.
   - **Branch:** `main` (or your default branch).
   - **Folder:** `/ (root)`.
3. Save. After a minute or two the site will be at:
   - **User/org site:** `https://<username>.github.io/MTGDoku/`
   - **Project site:** same, or whatever path GitHub shows.

Open that URL; the game should load and fetch boards from your Render backend.

---

## 4. Quick checklist

- [ ] Backend deployed on Render and service URL copied.
- [ ] `js/game.js` updated with that URL for the `isGitHubPages` case.
- [ ] Changes pushed to the repo so GitHub Pages serves the new JS.
- [ ] GitHub Pages enabled for the repo (branch + root).
- [ ] Visit the Pages URL and confirm the game loads and puzzles load (no CORS or “Failed to load board” errors).

If the board doesn’t load, open the browser’s Network tab and check the request to `/api/board`: ensure it goes to your Render URL and returns 200 with `rowCriteria` and `colCriteria`.
