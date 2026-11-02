# Voice typing (speech-to-text)

A microphone button next to the places where a lawyer would rather speak than type. Click it, speak, click again: the words are typed in at the cursor. Esc throws the recording away.

## Where it is
- Today (ask box), Research (question), Matter detail (private note, hearing note, remarks, "Ask about this matter")
- War Room (issue, position, bench chat), Legal Forms (AI autofill facts), Workspaces (case facts, client facts, internal notes)
- Calendar: "Say it instead" - say "Hearing in Bail Application next Tuesday at Delhi High Court" and the title, date, type and place are filled in. Check the date before saving.
- Draft editor assistant: "Dictate into document" types into the document at the cursor (Undo is in the log).
- Start page request now also reaches the draft screen and picks the matching document type.

Not added on purpose: names, numbers, dates, passwords, search boxes, the Conflict Engine.

## How it works
Browser records (MediaRecorder) -> `POST /api/stt/transcribe` (sign-in needed, 40 per minute per user) -> Groq Whisper -> text back. The recording is not saved and not logged by LexAmplify. It does go to Groq. The first time someone records, a one-line notice says so.

Languages: Auto (English + Hindi mix), English, Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Urdu. The choice is remembered in the browser.

Spoken punctuation (English): "full stop", "comma", "question mark", "semicolon", "new line", "new paragraph", "open/close bracket".

## Settings (all optional, see .env.example)
`GROQ_API_KEY` must be set or the mic says voice typing is not set up. `STT_MODEL`, `STT_FALLBACK_MODEL`, `STT_RATE_LIMIT`, `STT_MAX_BYTES`, `STT_PARSE_MODEL`.

## Tests
`python -m pytest tests/test_stt_routes.py tests/test_route_snapshot.py -q` and `cd frontend && npm test`.
