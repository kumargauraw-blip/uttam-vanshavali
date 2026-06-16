# Family Lineage App

Standalone web app for maintaining Indian family lineage records.

## Run

```bash
npm install
npm run dev
```

The app defaults to `http://localhost:5373`.

## Production build

```bash
npm run build
npm run start
```

## Configuration

Copy `.env.example` for deployment notes. The current server reads these environment variables:

- `PORT`: web server port, default `5373`
- `DATA_DIR`: persistent folder for the SQLite database, default `data`
- `APP_ORIGIN`: public site URL used for invite links
- `MAX_TREES_PER_ACCOUNT`: how many family trees one account can create, default `2`
- `ACCESS_CODE_MINUTES`: one-time access code expiry, default `10`
- `INVITE_DAYS`: family tree invite link expiry, default `14`
- `SESSION_DAYS`: login session lifetime, default `30`

For local development, access codes are returned on screen and printed in the server log. In production, codes are not returned to the browser; use password login until email/SMS delivery is wired in.

## Accounts

- Users can create an account with email and password.
- Users can sign in with password.
- Users can request a one-time access code by email.
- Logged-in users can set or change their password from Account.
- Each family tree is owned by an account, and the server enforces `MAX_TREES_PER_ACCOUNT`.
- Owners/admins can invite family members from Account with viewer, contributor, or admin access.
- Invite links require the invitee to sign in or create an account with the invited email before access is granted.

## Included

- Responsive, zoomable family tree
- Person records with parents, spouse links, photos, rashi, gotra, birth/death details
- Traditional family metadata such as Kuladevi, Kuladevata, Kulapurohit, Gramadevata, native village, pravara
- CSV preview and commit flow
- Telegram-style text or voice transcript extraction into reviewable proposals
