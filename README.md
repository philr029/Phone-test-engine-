# 📞 Phone Test Engine

A production-ready automated phone-call testing system built with **Node.js**, **Express**, and **Twilio**.  
Dial a list of numbers, detect outcomes (answered, voicemail, busy, failed), and view live results on a web dashboard.

---

## Features

| Feature | Detail |
|---|---|
| Outbound dialling | Twilio Programmable Voice API |
| Outcome detection | answered · voicemail · busy · failed · no-answer |
| Test message | Custom TwiML URL (defaults to Twilio demo) |
| Retry logic | Configurable max attempts per number |
| Rate limiting | Configurable delay between consecutive calls |
| Webhook handling | Real-time status updates via Twilio status callbacks |
| Dashboard | Live HTML UI — auto-refreshes during active runs |
| JSON log | `data/results.json` — append-only, upgrade-ready to MongoDB |
| CSV export | One-click download from the dashboard or `/results/export` |
| Test Mode | Simulate calls locally — no real Twilio API usage |
| Scheduling | POST a future ISO timestamp to delay a run |
| CLI mode | Run directly with `node call.js` (e.g. via GitHub Actions) |

---

## Folder Structure

```
Phone-test-engine-/
├── server.js           # Express server (web interface + API)
├── call.js             # Standalone CLI script (used by GitHub Actions)
├── api/
│   ├── call.js         # Core call-triggering module (shared by server + CLI)
│   ├── webhook.js      # Twilio status-callback router
│   └── results.js      # Read / write / export data/results.json
├── data/
│   └── results.json    # Call result log (auto-created)
├── frontend/
│   └── index.html      # Live dashboard (Tailwind CSS)
├── numbers.json        # Default phone number list (E.164 format)
├── logs.json           # CLI run logs (used by call.js / GitHub Actions)
├── .env.example        # Environment variable template
└── .github/workflows/
    └── call.yml        # Scheduled GitHub Actions workflow
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1XXXXXXXXXX

# Public URL of this server (required for live webhook callbacks)
BASE_URL=https://your-domain.com   # or ngrok URL for local dev

PORT=3000
TEST_MODE=false   # set to "true" to simulate without real calls
```

### 3. Add phone numbers

Edit `numbers.json`:

```json
["+15005550006", "+15005550001"]
```

### 4. Run the server

```bash
npm start
```

Open **http://localhost:3000** to access the dashboard.

---

## API Endpoints

### `POST /start-test`

Trigger a batch of outbound calls.

**Request body (JSON):**

```json
{
  "numbers":     ["+15005550006"],   // optional – falls back to numbers.json
  "testMode":    false,              // optional – override TEST_MODE env var
  "retries":     1,                  // optional – max retry attempts (default: 1)
  "scheduledAt": "2025-01-01T09:00:00Z"  // optional – ISO timestamp to delay run
}
```

**Response `202 Accepted`:**

```json
{ "message": "Test run started", "count": 2 }
```

---

### `GET /results`

Return all call results as JSON (most recent first).

**Query params:**

| Param | Description |
|---|---|
| `status` | Filter by call status (e.g. `completed`, `failed`) |
| `limit` | Max number of records to return |

---

### `GET /results/export`

Download all results as a CSV file.

---

### `POST /api/webhook`

Twilio status-callback endpoint.  
Set as the `statusCallback` URL when creating calls (handled automatically by the engine).

---

## Test Mode

Set `TEST_MODE=true` in `.env` (or pass `"testMode": true` in the POST body) to simulate calls without making real Twilio API requests. Each call randomly returns `completed`, `no-answer`, `busy`, or `failed`.

Useful for local development and CI testing.

---

## Webhook Setup (live mode)

Twilio must be able to reach your server to POST status callbacks.

**Local development** — use [ngrok](https://ngrok.com):

```bash
ngrok http 3000
# Set BASE_URL=https://xxxx.ngrok.io in .env
```

**Production** — set `BASE_URL` to your public deployment URL.

---

## GitHub Actions (scheduled runs)

The `.github/workflows/call.yml` workflow runs `node call.js` (the standalone CLI) every day at 09:00 UTC and uploads `logs.json` as an artifact.

Add these secrets to your repository (**Settings → Secrets → Actions**):

| Secret | Value |
|---|---|
| `TWILIO_SID` | Twilio Account SID |
| `TWILIO_AUTH` | Twilio Auth Token |
| `TWILIO_NUMBER` | Your Twilio phone number |

To trigger manually: **Actions → Phone Test Engine → Run workflow**.

---

## Deployment

### Vercel (serverless)

1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` and follow prompts
3. Add environment variables in the Vercel dashboard
4. Set `BASE_URL` to your Vercel deployment URL

### Railway / Render / Fly.io

Deploy as a standard Node.js web service.  
Set all environment variables from `.env.example` in the platform dashboard.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Live mode | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Live mode | Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Live mode | Twilio caller ID (E.164) |
| `BASE_URL` | Live mode | Public server URL for webhook callbacks |
| `PORT` | No | HTTP port (default: `3000`) |
| `TEST_MODE` | No | `true` to simulate calls (default: `false`) |
| `TWIML_URL` | No | Custom TwiML URL (default: Twilio demo XML) |

---

## Result Record Schema

```json
{
  "id":        "uuid-v4",
  "to":        "+15005550006",
  "callSid":   "CA...",
  "status":    "completed | no-answer | busy | failed | canceled | initiated",
  "startTime": "2025-01-01T09:00:00.000Z",
  "endTime":   "2025-01-01T09:00:30.000Z",
  "duration":  30,
  "attempts":  1,
  "testMode":  false
}
```