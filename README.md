# Thoth - The Autonomous LMS Agent

An autonomous AI agent that interacts with Brightspace (D2L) Learning Management Systems and google forms. Built as part of the **AI in Research VIP Project** to demonstrate and study how AI agents can autonomously navigate, complete, and submit academic work, informing academic integrity policies and system defenses.

## What It Does

Thoth connects to your university's Brightspace LMS and can:

- **Discover** all enrolled courses and their assignments, quizzes, and discussions
- **Classify** each deliverable by type (file upload, quiz, discussion post, inline text, external tool)
- **Generate** assignment content using AI (outline -> draft -> self-critique pipeline)
- **Answer** quiz questions through browser automation (quizzes have no API)
- **Write** discussion posts and peer replies
- **Build** documents in multiple formats (DOCX, PDF, TXT, Markdown) with proper formatting
- **Fill out** Google Forms using your profile data + AI for unknown fields
- **Submit** work via Brightspace REST API or browser upload (with fallback)
- **Monitor** deadlines and send reminders at 7 days, 48 hours, and 6 hours
- **Recover** from errors: session expiry, upload failures, stale tasks
- **Preview** all generated content before submission with full-text review
- **Track** browser automation in real time (clicks, navigation, form fills)
- **Filter** by academic term so you only work on current semester courses
- **Notify** you when forms are detected, data is extracted, or quizzes are ready

**Every submission requires your explicit confirmation.** The agent will never submit anything without your approval. Quizzes are answered but never auto-submitted.

## Quick Start

### Demo Mode (no credentials needed)

```bash
npm install
npx playwright install chromium
npm run build
npm start -- --demo
```

Open `http://localhost:3000` in your browser. You will see a dashboard with 10 mock assignments, live logs, and all features working with sample data.

### Full Mode (with your Brightspace account)

```bash
npm install
npx playwright install chromium
```

Fill in your `.env` file (auto-created by install):

```env
# Your profile
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

# Browser settings
BROWSER_HEADLESS=true             # Set to false to watch the browser
SCREENSHOT_INTERVAL=2000          # Dashboard screenshot refresh (ms)

# Session reuse (skip password login, use your existing browser session)
# BROWSER_PROFILE_PATH=C:\Users\YourName\AppData\Local\Google\Chrome\User Data

# Term filtering
# ACTIVE_TERM=Spring 2026
```

Then build and run:

```bash
npm run build
npm start
```

Open `http://localhost:3000` in your browser.

## All Run Modes

```bash
# Web dashboard (default) on http://localhost:3000
npm start

# Demo mode (no credentials needed, uses mock data)
npm start -- --demo

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

## Prerequisites

- **Node.js** >= 22.0.0
- **npm** >= 9.0.0
- A Brightspace (D2L) account with active course enrollments
- A Portkey API key (or direct Anthropic/OpenAI keys)

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
    screenshot-stream.ts       Live screenshot streaming to dashboard
    automation-tracker.ts      Real-time browser action tracking
    pages/
      home.ts                  Course discovery
      assignments.ts           Assignment scanning + browser submission
      quizzes.ts               Quiz navigation + answering
      discussions.ts           Discussion reading + posting
      grades.ts                Grade checking
      google-forms.ts          Google Forms auto-fill + submission

  api/
    client.ts                  Brightspace REST API client (session cookies)

  computer/                    Desktop/computer-use capabilities
    file-manager.ts            Local filesystem operations (copy, move, delete, list, read)
    app-launcher.ts            Application launching + command execution

  db/
    schema.ts                  SQLite schema (Drizzle ORM)
    index.ts                   Database initialization
    queries.ts                 CRUD operations

  documents/                   Multi-format document creation
    docx-builder.ts            DOCX generation with formatting
    pdf-builder.ts             PDF generation via pdfkit
    txt-builder.ts             Plain text generation
    md-builder.ts              Markdown generation with front-matter
    document-service.ts        Unified document creation facade

  scheduler/
    deadline-monitor.ts        7d/48h/6h deadline reminders
    task-queue.ts              Priority queue sorted by deadline
    cron.ts                    Scheduled task runner
    term-manager.ts            Academic term detection + course filtering

  workflows/
    startup.ts                 Full startup sequence
    scan.ts                    Course scanning + state population
    submit.ts                  Submission orchestration per type
    error-recovery.ts          Session re-auth, retry, stale detection

  email/
    poller.ts                  Gmail polling scaffold

  ui/
    logger.ts                  Structured colored logging
    confirmation.ts            Submission confirmation + preview gate
    dashboard.ts               Assignment status dashboard
    control-panel.ts           Interactive CLI

  web/
    server.ts                  Express API server + all routes
    events.ts                  SSE hub for real-time updates
    activity.ts                Activity event system (tracking + broadcast)
    notifications.ts           Notification system (alerts + desktop notifications)

tests/                         Test suite (Vitest, 404 tests across 15 files)
data/                          Runtime data (gitignored)
  assignments.db               SQLite database
  session.json                 Browser session cookies
outputs/                       Generated documents
screenshots/                   Verification screenshots
```

## Web Dashboard Features

When you run `npm start`, a web dashboard launches at **http://localhost:3000**:

- **Stats bar**: Total, pending, submitted, failed counts
- **Assignments table**: All tracked assignments with type, deadline, status, and action buttons
- **Term selector**: Filter courses by academic term (Spring, Summer, Fall)
- **Live Log tab**: Real-time streaming log of everything the agent does
- **Activity Feed tab**: Visual timeline of all agent actions with icons
- **Live View panel**: Live browser screenshots updated every 2 seconds
- **Notification panel**: Alerts for form detections, data extractions, quiz readiness
- **Browser mode indicator**: Shows headed/headless status
- **Quick actions**: Rescan courses, process all, fill Google Forms
- **Student profile**: Shows your configured profile data
- **Preview/confirmation modals**: Full content review before any submission
- **Screenshot modal**: Click any screenshot thumbnail to view full-size
- **Desktop notifications**: Browser notifications when the tab is not focused
- **Audio alerts**: Sound notification for urgent items (quiz ready, deadlines)

Everything updates in real time via Server-Sent Events.

## Key Features

### Browser Session Reuse (No Password Login)

Instead of providing your password, you can point Thoth at your existing Chrome/Edge profile where you are already logged into Brightspace:

```env
BROWSER_PROFILE_PATH=C:\Users\YourName\AppData\Local\Google\Chrome\User Data
```

The agent will use your existing cookies and session. If the session expires, it notifies you to log in manually in your regular browser rather than attempting a password login.

### Quiz Safety Mode

The agent answers quiz questions but **never auto-submits**. When all questions are answered:

1. You get a dashboard notification with the full answer summary
2. An audio alert plays to get your attention
3. You review all answers and confidence scores
4. You click "Submit Quiz" to submit, or leave it open

Even if the quiz timer runs out, the agent will not submit. It logs the timeout and preserves your answers.

### Term Filtering

Select an academic term (e.g., "Spring 2026") in the dashboard header. The agent will only show and process courses for that term. It auto-detects the current term on first launch and infers terms from course names (SP26, FA25, etc.).

### Document Preview Before Submission

Before any submission, you see the full generated content in the dashboard:

- Complete document text with word count
- Rubric check results (pass/fail per criterion)
- Discussion posts with all replies
- Google Form field values
- Download link for generated files
- Diff view when you request revisions

### Real-Time Browser Automation Tracking

The Activity Feed shows every browser interaction as it happens:

- Navigation events (page loads, redirects)
- Click actions (buttons, links, form elements)
- Form fills (field names, value lengths)
- Screenshot captures (with reason)
- Each action gets a distinct icon and a 2-second highlight animation

### Multi-Format Document Creation

Create documents in four formats via the API or agent workflows:

- **DOCX**: Full formatting with headers, page numbers, styles
- **PDF**: Generated via pdfkit with headings and paragraphs
- **TXT**: Plain text with markdown stripped
- **Markdown**: Preserved formatting with YAML front-matter

### Notification System

The dashboard notifies you when:

- A Google Form is detected during scanning
- Assignment instructions and rubric are extracted
- An external tool (Gradescope, Turnitin) is encountered
- A quiz is ready for review
- An email contains assignment-related information
- A browser session expires

Notifications appear in the dashboard panel, as desktop browser notifications (when the tab is not focused), and with audio alerts for urgent items.

## CLI Mode

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

## API Endpoints

The Express server exposes these endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/assignments` | List all assignments |
| GET | `/api/assignments/:id` | Get assignment details |
| GET | `/api/pending` | List pending assignments |
| GET | `/api/profile` | Get student profile |
| POST | `/api/process/:id` | Process a specific assignment |
| POST | `/api/process-all` | Process all pending assignments |
| POST | `/api/scan` | Rescan all courses |
| POST | `/api/skip/:id` | Skip an assignment |
| POST | `/api/reset/:id` | Reset an assignment to pending |
| GET | `/api/events` | SSE stream (logs, activity, screenshots, notifications) |
| GET | `/api/confirmations` | Get pending confirmations |
| POST | `/api/confirm/:id` | Resolve a confirmation |
| POST | `/api/documents/create` | Create a document (DOCX, PDF, TXT, MD) |
| POST | `/api/files/mkdir` | Create a directory |
| POST | `/api/files/copy` | Copy a file |
| POST | `/api/files/move` | Move a file |
| POST | `/api/files/delete` | Delete a file |
| POST | `/api/files/list` | List directory contents |
| POST | `/api/files/read` | Read a file |
| POST | `/api/apps/launch` | Open a file or application |
| POST | `/api/apps/exec` | Execute a shell command |
| GET | `/api/browser/status` | Get browser status (active, headless, URL) |
| POST | `/api/browser/config` | Update browser settings |
| GET | `/api/screenshots/:name` | Serve a screenshot file |
| GET | `/api/terms` | List available academic terms |
| POST | `/api/terms/select` | Set the active term |
| GET | `/api/notifications` | Get undismissed notifications |
| POST | `/api/notifications/:id/dismiss` | Dismiss a notification |
| GET | `/api/preview/:id` | Get preview content for an assignment |
| POST | `/api/preview/:id/approve` | Approve a previewed submission |
| POST | `/api/preview/:id/feedback` | Send revision feedback |

## Testing

```bash
# Run all 404 tests
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
- Document creation (DOCX, PDF, TXT, MD) with round-trip verification
- Document Service format routing and error handling
- File Manager operations (copy, move, delete, list, read)
- File Manager path security (traversal rejection)
- Activity event system (IDs, schema, buffer bounds)
- Notification system (IDs, dismissal)
- Automation tracker (action types, schema compliance)
- Term manager (detection, inference, filtering)
- Google Forms URL detection
- Module exports and type definitions

All tests use property-based testing with 20 randomized iterations per property.

## How It Works (Technical)

### Startup Sequence

1. Load config from `.env`
2. Initialize SQLite database (auto-migrates schema)
3. Launch Playwright browser (or reuse existing session)
4. Authenticate with Brightspace (session reuse or browser login)
5. Scan all courses via REST API (fallback: browser scraping)
6. Tag courses with academic terms
7. Populate database with discovered assignments
8. Start screenshot stream for dashboard
9. Check deadline reminders
10. Show dashboard

### Assignment Processing Pipeline

**File Upload:**
1. Extract instructions + rubric from LMS page (notification sent)
2. Conduct research (if sources required)
3. Generate outline covering all rubric criteria
4. Write complete draft
5. Self-critique against rubric + revise
6. Build document (DOCX/PDF/TXT/MD)
7. Full content preview in dashboard
8. Confirmation gate (user must approve)
9. Upload via API (fallback: browser)
10. Screenshot receipt

**Quiz (Safety Mode):**
1. Navigate to quiz page, extract metadata (time limit, question count)
2. Start quiz attempt
3. For each question: extract -> classify -> generate answer -> apply
4. Track confidence scores, skip low-confidence questions
5. Return to skipped questions if time allows
6. Stop. Do NOT submit.
7. Send notification with full answer summary
8. Wait for explicit user approval via dashboard
9. Submit only when user clicks "Submit Quiz"

**Discussion Post:**
1. Extract prompt + existing peer posts via API
2. Generate original post (avoiding repeating peers)
3. Generate replies to peer posts (each adds new content)
4. Full content preview (original post + all replies)
5. Confirmation gate
6. Post via API (fallback: browser)

### Error Recovery

- **Session expiry**: Detected via login page redirect or 401 errors. Automatically re-authenticates (or notifies user if using session reuse).
- **Upload failure**: Retries once after 30 seconds. If still failing, saves the file locally and alerts you.
- **Page load failure**: Retries 3 times with exponential backoff.
- **Stale tasks**: Any task in "in-progress" for over 2 hours triggers an alert.
- **Unknown page state**: Takes a screenshot, sends to AI for diagnosis, follows suggested action.

## Security Notes

- Credentials are stored in `.env` (gitignored)
- Browser session cookies are saved to `data/session.json`
- File Manager enforces path security: all operations are sandboxed to the project root
- The agent never pushes data to external services (only to your LMS and configured AI providers)
- All submissions require explicit user confirmation
- Quiz answers are never auto-submitted

## Limitations

- Quiz answering accuracy depends on the AI model's knowledge
- Google Forms extraction depends on DOM structure (may break if Google changes their markup)
- External tools (Gradescope, Turnitin) are handled on a best-effort basis
- Email monitoring requires a separate Gmail API setup (currently scaffolded)
- The agent cannot bypass proctoring software (Respondus, etc.)
- Browser session reuse requires Chrome/Edge with an existing login

## License

MIT
