# Accounts setup — Railway volume and Google sign-in (milestone 3.7, D-037)

Two one-time jobs for the owner of the Railway and Google accounts. Accounts work without
Google (name + password); Google sign-in turns on once part B is done. **Never paste the Google
client secret into a chat** — it goes only into Railway's Variables.

The live site: https://openborders-production.up.railway.app

---

## A. A volume on Railway (needed before accounts go live)

Without a volume the accounts file is wiped on every update. A volume is a small disk that
stays; Railway bills it by size (cents a month for this game).

1. Open https://railway.com/dashboard and open the **OpenBorders** project.
2. On the project canvas, **right-click an empty spot** (or press **Ctrl + K**) and choose
   **Create Volume** (it may read "New Volume").
3. When it asks which service, pick the game's service (the one running the site).
4. **Mount path:** type `/data` and confirm.
5. Railway restarts the service by itself to attach the disk (any online game running then
   ends). Nothing else to set: Railway tells the server where the disk is
   (`RAILWAY_VOLUME_MOUNT_PATH`), and the server keeps `accounts.sqlite` there.
6. Check: open https://openborders-production.up.railway.app/health — it should say
   `… accounts, Google off` (if it says `accounts (not on a volume)`, the volume isn't attached
   to the right service).

## B. Google sign-in (optional, about 10 minutes)

1. Go to https://console.cloud.google.com and sign in with the Google account that should own
   the app.
2. Top bar → project picker → **New project** → name it `OpenBorders` → **Create**, then make
   sure it is selected.
3. Menu ☰ → **APIs & Services → OAuth consent screen** (Google may call this **Google Auth
   Platform**). Click **Get started**:
   - App name: `OpenBorders`; User support email: your email.
   - Audience: **External**.
   - Contact email: your email. Agree to the policy → **Create**.
4. **Branding** (left menu):
   - App home page: `https://openborders-production.up.railway.app`
   - Privacy policy link: `https://openborders-production.up.railway.app/privacy`
   - Authorized domains: `openborders-production.up.railway.app` (if Google refuses it, leave it
     empty and tell me what it said).
   - Don't add a logo (a logo makes Google review the app first). **Save**.
5. **Data access**: nothing to add — the game asks only for `openid` (just "who is this").
6. **Clients** (left menu) → **Create client**:
   - Application type: **Web application**; Name: `OpenBorders web`.
   - **Authorized redirect URIs** → Add URI:
     `https://openborders-production.up.railway.app/auth/google/callback`
   - **Create**. Google shows the **Client ID** and **Client secret** — copy both now (newer
     Google consoles show the secret only once; if you lose it, add a new secret on the client).
7. **Audience** (left menu) → **Publish app** → confirm, so anyone can sign in. (While it says
   "Testing", only people you add under "Test users" can — fine for a first try with friends.)
8. In Railway: the game's service → **Variables** → **New Variable**, twice:
   - `GOOGLE_CLIENT_ID` = the Client ID
   - `GOOGLE_CLIENT_SECRET` = the Client secret

   Railway restarts the service (online games end).
9. Check: `/health` says `… accounts, Google on`, and the start screen's **Sign in** shows
   **Continue with Google**.

If Google shows an error after you pick your account (e.g. `redirect_uri_mismatch`), tell me the
exact message — usually the redirect URI in step 6 has a typo.

### Testing Google locally (only if wanted)

Add a second redirect URI `http://localhost:8787/auth/google/callback` to the same client, then
start the local server with the two variables set. Not needed for the live site.
