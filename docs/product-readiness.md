# v0.2.0 product quality verification status

2026-10-04, Windows x64. The verification target is GitLab.com. Support for Self-Managed URLs and subpaths is kept, but an internal real device was not part of this verification.

## Protections implemented

When posting a comment, posting a reply or saving a server draft succeeds, the matching unsent comment and the post record are deleted in the same transaction. The app confirms the device save before posting, so an abnormal exit right after success does not bring the posted text back as unsent. If the saved content changed while posting, the new content is kept.

- Unsent comments are saved in SQLite on the Rust side. They are separated by server/account and comment target, and are restored in the target's input field after a restart. Clearing the fetch cache does not delete unsent input. The limits are 100 items per account, 64 KiB per body and 4096 bytes per key, and nothing is sent or deleted automatically.
- The operation record is saved durably right before posting, and a communication failure, interruption, server error or invalid success response keeps an "unknown result". After a restart, writes to the same MR stay blocked, and the record is cleared only for the displayed record ID after the server is refetched and the user confirms.
- Logout and connection changes during a post are refused. An explicit logout deletes credentials, the cache, unsent comments and post records with unconfirmed results, so the app asks to confirm what will be deleted.
- Pending saves are completed on a normal exit and before an update. Input that could not be saved is kept, and the app never quits or updates without confirmation. A quit with unsent content shows the affected screens (the MR name and the content, such as editing a new comment, reply, line comment or description) and asks you to choose from "Save and quit", "Quit without saving" and "Back". Quitting without saving does not delete records of operations with unconfirmed results. A screen exception switches to a recovery screen that can be shown again, and it does not show the exception text or secrets.
- The number of diff hunks and line positions are validated, and line comments on an invalid diff are disabled. `+++` and `---` inside a hunk are treated as real added and removed lines. The render limits are 600 diff lines, 1000 lines for a whole file, 20 discussions and 50 notes per discussion, and all fetched data stays reachable by moving back and forth.
- DB migration runs in a transaction, and a newer schema or a corrupt DB is reported on an error screen and never replaced automatically. Credentials are in the Windows credential store, and comments and fetched data are in SQLite in the app's storage area. SQLite contents are not encrypted.

## What was checked

| Check | Result |
| --- | --- |
| React / IPC behavior tests | 28 files, 162 passed |
| Release config tests | 3 passed, version and fixed distribution source checked |
| Rust | 54 passed, 6 that depend on a real device or distribution artifact excluded from normal runs |
| lint / design guard / TypeScript / build / Rust fmt and clippy | Passed. 6 existing Fast Refresh warnings and a JS size warning |
| GitLab.com public project | The explicit real-network test passed |
| Inspection of glab saved credentials | The real-environment test that rejects an expired OAuth without printing secrets passed |
| Windows credential store | The real-device test that temporarily saves, reads and deletes a dedicated fictional value passed |
| Public CI and distribution | [Windows CI](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37203184795) and [signed distribution](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37203184764) succeeded. For an anonymously downloaded NSIS, signature match and tamper rejection were confirmed, and so were the version / URL / signature match of the latest manifest |

Local HTTP fixtures and component tests verify account separation, restore after restart, the order of slow saves and deletes, expired authentication, delayed responses after logout, persistence of unknown results, clearing by UUID match, double clearing, retention on save failure, flush before quit, failure to register the quit listener, and the render limits for diffs and discussions. This is distinct from a posting test against a real server.

The GitLab.com public project search succeeded as a real-network test using Rust's production API adapter. The anonymous test of the public MR flow stopped with 401 `AUTH_REQUIRED` and is not counted as a success. The local glab OAuth credentials have expired. Without putting the token in chat or the frontend, real-network verification of identity and MR fetching is needed once valid credentials can be imported.

## Remaining real-device checks

- With valid GitLab.com authentication: identity check, project / past MR search, and fetching MR details, discussions and diffs.
- Posting, replying, editing, deleting, resolving, publishing drafts and approving on a test MR the user specifies. No real posting test has been done yet.
- Windows installation, the native quit event, and updating and restarting from an installed older version. These are separate from the signature verification of the distribution file and the update manifest verification.
- Light and dark themes, real screens at 960×640 / 1280×840, and keyboard operation. Under the condition of not using Computer Use, verification by screen operation was not done.
- Performance measurement on real data that separates network wait, cache fetch and render time. Having confirmed the DOM count limits alone does not support a claim about perceived speed or reaching the p95 target.
- On real GitLab, matching relative-path images (including SVG) and relative links in Markdown inside the repository, and matching outdated comments on renamed files.
- After installation, registration of `gitlab-desktop://open?url=…` and handing off to a running window.

Implementation, automated tests and the public distribution check are in progress. The "final product quality pass", meaning completion of the real-device checks above, has not been recorded yet.

## Local verification of added features (2026-10-09)

Added: search of body text and file names within a diff page, a viewed-file record for files stored on the device, image and file attachments, and search conditions for labels, branches and groups. Usage and storage limits are in the [README](../README.md#usage-and-scope).

Rust passed 74, with 7 that depend on a real device or distribution artifact excluded. A local HTTP fixture confirmed multipart sending of attachments. The confirmation record before sending, stopping resends on an unknown result, and keeping unsent text were also verified.

The full React / IPC run passed 308 of 309. One existing test of changing accounts after authentication expired failed, and a rerun of that file alone passed all 21. The integration test of the added features also confirmed that an attachment is not sent when saving the input fails.

lint, design guard, TypeScript, production build, Rust fmt and clippy, and the release config tests passed. The 6 Fast Refresh warnings and the bundle size warning remain. Search and the viewed-file action were checked in the UI catalog's light and dark themes, and the display was inspected at 960×640 and 1280×840.

Sending attachments to an authenticated real GitLab and searching on a real Self-Managed device are unverified. This record is a local verification and not a record of completed public distribution.

After the 2026-10-13 pre-release review, these were fixed. Attachment sending no longer uses the 20-second overall timeout and waits up to about 3 minutes depending on size. A paste that contains both text and an image is not uploaded. If the input field is closed during an upload, the link is still added to the original unsent comment. Gravatar fetching uses a separate concurrency slot from the GitLab API. A successful attachment does not clear the cache. The diff view starts from the top when you switch files, and search within a diff parses the whole page only while searching. After the fixes, React / IPC 312, Rust 75 (7 excluded), and lint, design guard, TypeScript, production build, fmt, clippy and release config tests passed. When the whole suite ran while other processes kept the CPU busy, slow UI tests sometimes timed out. They all passed when rerun alone.
