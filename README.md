# Thoth - The Autonomous LMS Agent

An autonomous AI agent that interacts with Brightspace (D2L) Learning Management Systems. Built as part of the **AI in Research VIP Project** to demonstrate and study how AI agents can autonomously navigate, complete, and submit academic work — informing academic integrity policies and system defenses.

## What It Does

Thoth connects to your university's Brightspace LMS and can:

- **Discover** all enrolled courses and their assignments, quizzes, and discussions
- **Classify** each deliverable by type (file upload, quiz, discussion post, inline text, external tool)
- **Generate** assignment content using AI (outline -> draft -> self-critique pipeline)
- **Answer** quiz questions through browser automation (quizzes have no API)
- **Write** discussion posts and peer replies
- **Build** DOCX documents with proper formatting, headings, and page numbers
- **Fill out** Google Forms using your profile data + AI for unknown fields
- **Submit** work via Brightspace REST API or browser upload (with fallback)
- **Monitor** deadlines and send reminders at 7 days, 48 hours, and 6 hours
- **Recover** from errors: session expiry, upload failures, stale tasks

**Every submission requires your explicit confirmation.** The agent will never submit anything without you typing `submit`, `yes`, or `confirm`.

## Architecture

```
src/
  index.ts                     Entry point + CLI modes
  config.ts                    Environment config + student profile

  agent/                       AI agent layer
    providers.ts               Portkey gateway + multi-provider routing
    router.ts                  Assignment type classification
    writing-agent.ts           Outline -> draft -> self-critique pipeline
    quiz-agent.ts              Browser-based quiz answering
    discussion-agent.ts        Discussion post generation
    research-agent.ts          Search API abstraction (Tavily/Perplexity)

  browser/                     Playwright browser automation
    browser.ts                 Browser lifecycle, cookies, screenshots
    auth.ts                    Brightspace login + 2FA (TOTP)
    vision.ts                  Page content extraction + AI vision fallback
    pages/
      home.ts                  Course discovery
      assignments.ts           Assignment scanning + browser submission
      quizzes.ts               Quiz navigation + answering
      discussions.ts           Discussion reading + posting
      grades.ts                Grade checking
      google-forms.ts          Google Forms auto-fill + submission

  api/
    client.ts                  Brightspace REST API client (session cookies)

  db/
    schema.ts                  SQLite schema (Drizzle ORM)
    index.ts                   Database initialization
    queries.ts                 CRUD operations

  documents/
    docx-builder.ts            DOCX generation with formatting

  scheduler/
    deadline-monitor.ts        7d/48h/6h deadline reminders
    task-queue.ts              Priority queue sorted by deadline
    cron.ts                    Scheduled task runner

  workflows/
    startup.ts                 Full startup sequence
    scan.ts                    Course scanning + state population
    submit.ts                  Submission orchestration per type
    error-recovery.ts          Session re-auth, retry, stale detection

  email/
    poller.ts                  Gmail polling scaffold

  ui/
    logger.ts                  Structured colored logging
    confirmation.ts            Submission confirmation gate
    dashboard.ts               Assignment status dashboard
    control-panel.ts           Interactive CLI

tests/                         Test suite (Vitest)
data/                          Runtime data (gitignored)
  assignments.db               SQLite database
  session.json                 Browser session cookies
outputs/                       Generated documents
screenshots/                   Verification screenshots
```

### Dual-Path Strategy

| Task | Primary | Fallback |
|------|---------|----------|
| Login | Browser (Playwright) | - |
| Course discovery | REST API | Browser scraping |
| Assignment listing | REST API | Browser scraping |
| Assignment submission | REST API (multipart upload) | Browser file picker |
| Quiz taking | **Browser only** (no API) | - |
| Discussion posts | REST API | Browser |
| Grade checking | REST API | Browser |
| Google Forms | Browser (Playwright) | - |

Quizzes **cannot** be taken via the Brightspace API — this is by design (anti-cheating). The agent uses Playwright to navigate the quiz UI, extract questions, generate answers via AI, and interact with the form elements.

### AI Provider Routing

| Task | Provider | Model |
|------|----------|-------|
| Document generation, rubric analysis | Claude (Sonnet) | via Portkey |
| Quiz answering, classification | GPT | via Portkey |
| Discussion posts, short-form | GPT | via Portkey |
| Research, citations | Search API | Tavily / Perplexity |

All AI calls route through the Portkey gateway. Direct API keys are supported as fallback.

## Prerequisites

- **Node.js** >= 22.0.0
- **npm** >= 9.0.0
- A Brightspace (D2L) account with active course enrollments
- A Portkey API key (or direct Anthropic/OpenAI keys)

## Setup

### 1. Install

```bash
git clone <repo-url> thoth
cd thoth
npm install
npx playwright install chromium
```

`npm install` automatically creates a `.env` file from the template and sets up the data directories for you.

### 2. Configure

Open `.env` in any text editor and fill in your details:

```env
# Your profile (used to auto-fill forms and name files)
STUDENT_FIRST_NAME=John
STUDENT_LAST_NAME=Smith
STUDENT_EMAIL=js1234@nyu.edu
STUDENT_ID=N12345678
STUDENT_PHONE=212-555-0100
STUDENT_MAJOR=Computer Science
STUDENT_YEAR=Junior

# Brightspace credentials
BRIGHTSPACE_BASE_URL=https://brightspace.nyu.edu
BRIGHTSPACE_USERNAME=js1234
BRIGHTSPACE_PASSWORD=your-password-here
BRIGHTSPACE_TOTP_SECRET=          # Only if you have 2FA enabled

# AI provider (required)
PORTKEY_GATEWAY_URL=https://ai-gateway.apps.cloud.rt.nyu.edu/v1
PORTKEY_API_KEY=your-portkey-key

# Optional: direct provider keys as fallback
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Optional: search APIs for research
TAVILY_API_KEY=
PERPLEXITY_API_KEY=

# Browser mode
BROWSER_HEADLESS=true             # Set to false to watch the browser
```

### 3. Build

```bash
npm run build
```

### 4. Run

```bash
# DEFAULT: Web dashboard on http://localhost:3000
npm start

# Custom port
npm start -- --port 8080

# CLI-only mode (no web server)
npm start -- --cli

# CLI interactive control panel
npm start -- --interactive

# Scan courses only (no processing)
npm start -- --scan-only

# Show CLI dashboard and exit
npm start -- --dashboard

# Auto mode (process everything, then exit)
npm start -- --auto

# Debug logging
npm start -- --debug

# Development mode (no build step, auto-reload)
npm run dev

# Run tests
npm test
```

## Getting Started (Step by Step)

1. **Install**: `npm install` then `npx playwright install chromium`
2. **Configure**: Open the `.env` file (auto-created by install), fill in your student info + Brightspace credentials + Portkey API key
3. **Build**: `npm run build`
4. **Start**: `npm start`
5. **Open**: Go to `http://localhost:3000` in your browser
6. **Use**: Click "Rescan" to discover assignments, click "Process" on any assignment, approve submissions in the confirmation dialog

## Usage

### Web Dashboard (Default)

When you run `npm start`, a web dashboard launches at **http://localhost:3000**:

- **Stats bar**: Total, pending, submitted, failed counts
- **Assignments table**: All tracked assignments with type, deadline, status, and action buttons
- **Live log**: Real-time streaming log of everything the agent does
- **Quick actions**: Rescan courses, process all, fill Google Forms
- **Student profile**: Shows your configured profile data
- **Confirmation dialogs**: Pop up when the agent needs your approval to submit

Everything updates in real time via Server-Sent Events.

### CLI Mode

If you prefer the terminal, use `npm start -- --cli` or `npm start -- --interactive`:

```
thoth> help

Commands:

  dashboard          Show all tracked assignments
  queue              Show the task priority queue
  profile            Show your student profile
  scan               Rescan all courses for new assignments
  process <id>       Process a specific assignment by ID
  process all        Process all pending assignments
  status <id>        Show details for a specific assignment
  skip <id>          Mark an assignment as skipped (failed)
  reset <id>         Reset an assignment to pending
  form <url>         Fill out a Google Form
  help               Show this help message
  exit               Exit the agent
```

### Processing an Assignment

```
thoth> dashboard
# Shows table of all assignments with IDs, types, deadlines, statuses

thoth> process 3
# Processes assignment #3:
# 1. Extracts instructions and rubric from the LMS page
# 2. Conducts research if needed
# 3. Generates content (outline -> draft -> self-critique)
# 4. Builds DOCX file
# 5. Presents confirmation gate with rubric check
# 6. Uploads on your approval
```

### Filling a Google Form

```
thoth> form https://docs.google.com/forms/d/e/1FAIpQLSdPHe.../viewform

# 1. Navigates to the form
# 2. Extracts all fields and their types
# 3. Auto-fills profile fields (name, email, ID, phone, etc.)
# 4. Uses AI to answer remaining questions
# 5. Shows you a preview of ALL proposed answers
# 6. Waits for your confirmation before submitting
```

You can also paste a Google Form URL directly (without the `form` command).

### The Confirmation Gate

Before EVERY submission, you see:

```
 ┌─────────────────────────────────────────────────────┐
 │  SUBMISSION CONFIRMATION REQUIRED                    │
 ├─────────────────────────────────────────────────────┤
 │ Assignment : Homework 3                              │
 │ Course     : CS-101 Intro to CS                      │
 │ Type       : file-upload                             │
 │ Deadline   : 2026-05-01T23:59  48h left              │
 │ Target URL : https://brightspace.nyu.edu/...         │
 │ File/Text  : Smith_CS-101_Homework_3.docx (1247 w)  │
 └─────────────────────────────────────────────────────┘

 Rubric Check:
 ┌─────────────────────┬────────┬────────────────────┐
 │ Criterion           │ Status │ Notes              │
 ├─────────────────────┼────────┼────────────────────┤
 │ Thesis statement    │ PASS   │ Clear and specific  │
 │ Evidence/sources    │ PASS   │ 4 citations        │
 │ Analysis            │ PASS   │ Thorough           │
 │ Grammar/style       │ PASS   │ Minor edits made   │
 └─────────────────────┴────────┴────────────────────┘

 Awaiting confirmation to submit.
 Type: submit / yes / confirm   |   Or describe changes needed

 >
```

Type `submit`, `yes`, or `confirm` to proceed. Type anything else to request changes.

**Exception:** If a quiz timer drops below 30 seconds, the agent auto-submits to prevent losing your work, and immediately shows you the full answer log.

## How Your Data Is Used

Your profile data (`STUDENT_FIRST_NAME`, `STUDENT_EMAIL`, `STUDENT_ID`, etc.) is used to:

1. **Auto-fill forms** — When a Google Form asks for "Name", "Email", or "Student ID", the agent fills these from your profile instead of guessing
2. **Name files** — Assignment files are named `LastName_CourseCode_Title.docx`
3. **Identify submissions** — Your name appears in document headers

This data is stored only in your local `.env` file and never sent anywhere except to the forms/LMS you're submitting to.

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run a specific test file
npx vitest run tests/db.test.ts
```

The test suite covers:
- Database schema creation and constraints
- Assignment CRUD operations
- Deadline monitoring logic
- Document filename generation
- Google Forms URL detection
- Module exports and type definitions

## How It Works (Technical)

### Startup Sequence

1. Load config from `.env`
2. Initialize SQLite database
3. Launch Playwright browser
4. Authenticate with Brightspace (browser login -> extract cookies)
5. Scan all courses via REST API (fallback: browser scraping)
6. Populate database with discovered assignments
7. Check deadline reminders
8. Show dashboard

### Assignment Processing Pipeline

**File Upload:**
1. Extract instructions + rubric from LMS page
2. Conduct research (if sources required)
3. Generate outline covering all rubric criteria
4. Write complete draft
5. Self-critique against rubric + revise
6. Build DOCX with formatting
7. Confirmation gate
8. Upload via API (fallback: browser)
9. Screenshot receipt

**Quiz:**
1. Navigate to quiz page, extract metadata (time limit, question count)
2. Start quiz attempt
3. For each question: extract -> classify -> generate answer -> apply
4. Track confidence scores, skip low-confidence questions
5. Return to skipped questions if time allows
6. Confirmation gate (or auto-submit if timer critical)
7. Screenshot receipt

**Discussion Post:**
1. Extract prompt + existing peer posts via API
2. Generate original post (avoiding repeating peers)
3. Generate replies to peer posts (each adds new content)
4. Confirmation gate
5. Post via API (fallback: browser)

### Error Recovery

- **Session expiry**: Detected via login page redirect or 401 errors. Automatically re-authenticates without user intervention.
- **Upload failure**: Retries once after 30 seconds. If still failing, saves the file locally and alerts you.
- **Page load failure**: Retries 3 times with exponential backoff.
- **Stale tasks**: Any task in "in-progress" for over 2 hours triggers an alert.
- **Unknown page state**: Takes a screenshot, sends to AI for diagnosis, follows suggested action.

## Project Structure

| Component | Lines | Purpose |
|-----------|-------|---------|
| Agent layer | ~800 | AI routing, content generation, quiz answering |
| Browser layer | ~1200 | Playwright automation, page scrapers, auth |
| API client | ~250 | Brightspace REST API wrapper |
| Database | ~300 | SQLite schema, queries, state management |
| Workflows | ~600 | Startup, scanning, submission orchestration |
| UI | ~500 | Logger, dashboard, confirmation gate, control panel |
| Scheduler | ~200 | Deadlines, task queue, cron |
| Tests | ~350 | 31 tests across 6 test files |

## Security Notes

- Credentials are stored in `.env` (gitignored)
- Browser session cookies are saved to `data/session.json` (gitignored)
- No credentials are hardcoded in source code
- The agent never pushes data to external services (only to your LMS and configured AI providers)
- All submissions require explicit user confirmation

## Limitations

- Quiz answering accuracy depends on the AI model's knowledge
- Google Forms extraction depends on DOM structure (may break if Google changes their markup)
- External tools (Gradescope, Turnitin) are handled on a best-effort basis
- Email monitoring requires a separate Gmail API setup (currently scaffolded)
- The agent cannot bypass proctoring software (Respondus, etc.)

## License

MIT
