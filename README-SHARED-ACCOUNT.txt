HL2SBPP WORKSHOP — SHARED ACCOUNT SOURCE

Workshop is the single registration/login source for both Workshop and Addons.
The Addons site uses the same Supabase/Postgres users table and receives a one-time
SSO transfer after Workshop authentication.

Profile data available to Addons from the shared account:
- username
- email
- avatar/photo
- bio
- role/admin status
- theme settings
- registration date
- shared activity counters

The password is not transferred. The SSO token is one-time and expires quickly.

Required env:
ADDONS_SITE_URL=https://hl2sbpp-addonss.onrender.com
DATABASE_URL=<same Supabase DATABASE_URL as Addons>
SESSION_SECRET=<Workshop session secret>
