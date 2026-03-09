# vibeats

GPL-3.0 open-source ATS for any purposes. Crafted from scratch and vibe-coded

## Features

- Easily edit branding in provided YAML config
- Upload and extract CV/resume data

### Soon

- More customization options
- Extracted data can be easily readable instead of a JSON format

## Stack

- Bun runtime
- Bun native HTTP server (`Bun.serve`) + EJS views
- PostgreSQL via Bun native SQL client (`import { SQL } from "bun"`)
- Tailwind CSS v4.1 (CLI)
- Vanilla JavaScript + Alpine.js for interactivity

## Setup

1. Install dependencies:

```bash
bun install
```

2. Configure environment:

```bash
cp .env.example .env
```

Update `DATABASE_URL` in `.env` to match your local PostgreSQL instance.

3. Seed the database:

```bash
bun run seed
```

4. Build Tailwind CSS:

```bash
bun run build:css
```

For live CSS changes during development:

```bash
bun run watch:css
```

5. Start the server:

```bash
bun run dev
```

Open http://localhost:3000

## Applicant CV PDF API

- Candidate records now include `cv_filename` and `cv_url` when a matching file exists in `assets/uploads`.
- The frontend uses `cv_url` to open each applicant CV directly in the browser.
- Extracted CV data is available via `profile`, `skills`, `experience`, and `education` in candidate payloads.

- List available applicants:

```bash
GET /api/candidates/available
```

- Download CV PDF packet for available applicants:

```bash
GET /api/candidates/available/cv.pdf
```

Example download with curl:

```bash
curl -L "http://localhost:3000/api/candidates/available/cv.pdf" -o available-applicants-cv.pdf
```

## CV Extraction API

- Add applicant page (upload and scan UI):

```bash
GET /applicants/new
```

- CV extraction now runs automatically in the background when a candidate-matching PDF is detected in `assets/uploads`.
- The auto pass also re-extracts when the PDF file is updated.
- Optional interval override: `CV_AUTO_EXTRACT_INTERVAL_MS` (default `30000`).

- Candidate detail page:

```bash
GET /candidates/:id
```

- Candidate details JSON:

```bash
GET /api/candidates/:id
```

- Trigger local CV extraction for a candidate PDF:

```bash
POST /api/candidates/:id/extract
```

- Save edited extracted fields:

```bash
PUT /api/candidates/:id/extracted-data
```

- Upload a new applicant CV PDF, scan it with heuristics, and create a candidate:

```bash
POST /api/candidates/upload-scan
```

Multipart form fields:

- `cv` (required, PDF file)
- `role` (optional)
- `status` (optional; defaults to `Applied`)
- `notes` (optional)

## UI Configuration

Edit [config/app.yaml](config/app.yaml) to change the frontend company name and subtitle:

```yaml
company:
	name: Your Studio ATS
	subtitle: Your custom hiring tagline
```

Restart the server after changing this file.

