# Validation results

## Validation of v0.15.5 to v0.15.7 and the next version (2026-10-27)

- Automated tests: 88 frontend files with 699 tests, 12 release configuration tests and 145 Rust tests passed (7 tests that depend on a real device or the distributed build were excluded). Lint (0 warnings), design guard, TypeScript, the production build (no chunk over 500 kB), and Rust fmt and clippy passed.
- Coverage (shipped code only, excluding `src/mock` and `src/pages`): 84.9% instructions, 80.3% branches, 84.1% functions, 88.8% lines. CI runs with thresholds slightly below these.
- Accessibility: axe (WCAG 2.1 A/AA) checked the merge request list, overview, discussion and changes with fixed data, plus projects, code and settings, in both light and dark themes, with 0 violations. Before the fixes there were violations in list structure, accessible names with no visible text, the contrast of diff line numbers, and the ARIA attributes of the search field.
- Screen comparison: screens were compared in CI against baseline images made in CI (windows-latest), and 20 screens of the UI catalog and the real app matched ([PR #14](https://github.com/ota-takeru/gitlab-desktop/pull/14); the baseline images were made in [run 40463456826](https://github.com/ota-takeru/gitlab-desktop/actions/runs/40463456826)). Local runs compare against per-machine baselines.
- Release: the signed releases of [v0.15.5](https://github.com/ota-takeru/gitlab-desktop/actions/runs/40441915628), [v0.15.6](https://github.com/ota-takeru/gitlab-desktop/actions/runs/40458949427) and [v0.15.7](https://github.com/ota-takeru/gitlab-desktop/actions/runs/40464380803) succeeded.
- Checked visually in the fixed-data preview: the display path of repository images, automatic matching of comments on an older version and the warning color, a merge request with the Overview tab first, the colors of the navigation location (light and dark), and the color and animation of the completion notice on approval.
- Not verified: repository images, relative links and matching of renamed files on a real GitLab; the `gitlab-desktop://` registration after installation and handing the URL to a running window; the automatic update to v0.15.7. These need credentials and a real device.

## Hardening of input protection and product quality (v0.2.0 / 2026-10-04)

- `npm run check` passed: 162 frontend tests, 3 release configuration tests and 54 Rust tests, 219 regular tests in total. Lint, design guard, TypeScript, production build, Rust fmt and clippy passed. The 6 existing Fast Refresh warnings and the JS size warning remain.
- `npm audit --omit=dev` reported 0 known vulnerabilities in the production JavaScript dependencies. It does not guarantee the safety of Rust or of all dependencies.
- Fixtures covered the migration from schema 1 to 2, leaving files unchanged under a future schema, per-account unsent comments and unknown-result records, restoring after a restart, saving before posting, atomic deletion of the body and record on success, races between cancellation and connection switching, and stale responses, UUIDs and double confirmation.
- Tests used a 2,001-line full text, 101 discussions and 200 notes per discussion. They checked two things: the number of DOM items rendered at once, and that the last page is reached. Later changes: the 101-discussion test was removed in v0.3.0, when discussions stopped being split into pages, and a test with a 1,500-line diff, added on 2026-11-05, checks that every line is rendered without paging. None of these tests cover network performance or a p95 on a real device.
- A real request to the GitLab.com public project search succeeded. Fetching a public MR anonymously failed with 401 `AUTH_REQUIRED`, so it is not counted as a successful fetch or as a completed authenticated review.
- An explicit test that temporarily stored, read and deleted a dedicated fictitious value in the Windows credential store passed. The glab authentication check rejected an expired OAuth token without printing the secret. A real request with valid GitLab.com authentication is not verified.
- A local signed NSIS build succeeded. The installer is 4,531,229 bytes, SHA256 `55ABE5128D76ECA9C9E52748AD79B42D6BF7C778E0828AE5E74D65DF217641CA`. Rust confirmed that the signature matches the public key and that changing one byte of the content is rejected. This records a local build, separate from the public CI artifact.
- [Windows CI](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37203184795) and the [signed release](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37203184764) succeeded. The tag `v0.2.0` points to source `398862fbd013e789da19766b42865ce6a170af5d`. The distribution step finished in 9 minutes 26 seconds.
- The public [installer](https://github.com/ota-takeru/gitlab-desktop/releases/download/v0.2.0/GitLab.Desktop_0.2.0_x64-setup.exe) was downloaded anonymously: 4,538,262 bytes, SHA256 `16A8E1C002DBED15505BED69A7CBD550EA382FE0483495F391237AD16FDE36BB`. Rust verified the matching 444-byte signature, and the rejection of a one-byte change also succeeded.
- `latest.json` (1,429 bytes) from the public latest endpoint returned version `0.2.0`, and for both `windows-x86_64` and `windows-x86_64-nsis` the installer URL and signature matched the above. The local bundle after publishing was verified again with the CI distribution file placed in it, so the hash of the file there is the same as the public one.
- Computer Use was not used. New real screens, native exit events, and installing and updating from an older version with a restart are not verified. The items checked and the remaining items are summarized in [Product quality validation status](product-readiness.md).

## Importing glab saved credentials (v0.1.2 / 2026-10-04)

Windows x64 / glab 1.107.0. A path was added that imports a PAT or an OAuth access token in Rust from an explicit action on the connection screen.

- `npm run check` passed. `npm run native:check` also passed after the final fix. These include 101 frontend tests, 3 release script tests and 34 Rust tests, lint, design guard, TypeScript/Vite, and fmt / Clippy.
- UI tests confirmed that IPC sends only the URL, import success and failure, returning to manual PAT entry, and that the button is disabled in the browser preview.
- Rust tests confirmed selecting only the target host, refusing fallback to the root or another host, matching HTTPS, port and subpaths including case, and rejecting expired or invalid OAuth settings. The refresh token is not used as an access token.
- The configuration file is limited to 1 MiB, depth 32 and 10,000 events, and YAML duplicate keys, aliases, anchors and tags are rejected. The temporary keyring configuration stores only metadata of the target host and is deleted on exit.
- Confirmed: the fixed command, isolation of environment variables, the limit and timeout on child process output, errors that contain no secrets, the sensitive attribute on the Bearer header, and compatibility with existing PAT connection metadata.
- The keyring path of the real glab 1.107.0 was checked with an isolated fixture. A fake token was registered in the Windows credential store for a unique `.invalid` host, and the matching value was obtained through a temporary configuration for the target host only and the fixed CLI. The fixture credential was deleted and its absence confirmed. The temporary helper and configuration were deleted, and the real authentication and real configuration were not changed.
- The old-format `api_host: host/subpath` can be matched only when the separate `subfolder` is empty. A relative `GLAB_CONFIG_DIR` is rejected, and relative XDG paths are dropped from the candidates.
- The saved OAuth token on this PC has expired. Before the fix, reading succeeded but the identity API returned 401. In the explicit test after the fix, the expired token was rejected before sending, and the app told the user to refresh authentication in glab. The real token was not displayed or saved.
- Local signed NSIS generation, signature verification and the tamper rejection test succeeded. [GitHub CI](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37199393484) and the [automatic release](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37199393466) also succeeded and automatically created the v0.1.2 tag and the [public release](https://github.com/ota-takeru/gitlab-desktop/releases/tag/v0.1.2).
- The public site was accessed without authentication, and the NSIS (4,449,910 bytes), the signature and the latest `latest.json` were obtained. The URL, signature and version matched for both Windows x64 platforms, and signature verification and tamper rejection of the public NSIS were confirmed. SHA-256: `3204491d67f1621fa4ea46eb27c9d215f03035b280452b1b5a6c9f18faae905c`.

The initial JS is 858.11 kB (gzip 264.45 kB). The existing Vite size warning and the 6 Fast Refresh lint warnings remain. Computer Use was not used, and the button added this time was not checked visually or in a real window. Identity checks on GitLab.com with a valid real token, a real Self-Managed instance, and automatic OAuth refresh are not treated as verified.

## Validation of real connection and distribution (2026-10-04)

Windows x64. Separate from the records of the initial foundation and mock below, the Rust GitLab API client, credentials, the persistent cache and signed updates were implemented.

- `npm run check` passed. It includes 98 frontend tests, 3 release script tests and 21 Rust tests, lint, design guard, TypeScript/Vite, and Rust fmt / Clippy.
- UI tests confirmed restoring a connection, clearing the PAT, separating authentication expiry from stale session responses, applying and restoring search conditions, editing and deleting your own replies, showing the cache first, preventing a 403 refetch loop, and rejecting late responses after a screen is closed.
- Confirmed: automatic updates keep running when the unsent body is hidden; pending writes and unknown-result states are kept after navigating away; double posting is suppressed; per-account bodies are separated and deleted; and signed updates can be confirmed, wait, be postponed and be rechecked manually. Protection of actions while an update is applied, continued protection when authentication expires, and returning to normal operation after a failure were also confirmed.
- The 21 regular Rust tests passed. fmt / Clippy (all targets, warnings as errors) also passed.
- 3 explicitly run external tests passed: the GitLab.com public project API, saving, reading and deleting in the Windows credential store, and signature verification of the generated NSIS with rejection of a 1-byte change.
- HTTP fixtures confirmed the queries for title and description search; MR number search within a project; for groups and global scope, finding the number through the search API and applying the list conditions; MRs within a project, subpaths and file paths, paging, 401/429, the retry limit for GET, single-send writes, and rejection of a head change beside and after fetching an MR diff (the check after the read decides whether the page is saved).
- Confirmed: account separation of the cache, eviction by retention period and capacity, preventing cache revival by late responses after logout, the limit on and cancellation of queued work, and rejection of a future DB schema.
- A signed Windows NSIS was generated locally. The update signing key is managed outside the source, and the GitHub repository secret is set. It is not an Authenticode signature.
- [GitHub CI](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37191999302) and the [automatic release](https://github.com/ota-takeru/gitlab-desktop/actions/runs/37191999309) succeeded. The version change on main automatically created the v0.1.1 tag and the [public release](https://github.com/ota-takeru/gitlab-desktop/releases/tag/v0.1.1).
- The NSIS (4,330,370 bytes), the signature and latest.json were obtained from the public site without authentication. The URL and signature for Windows x64 matched, the SHA-256 was checked, and the signature verification and tamper rejection test of the public installer also passed.

The initial JS is 857.45 kB (gzip 264.32 kB). The Vite chunk size warning and the lint warnings about Fast Refresh in development remain, but the build and type check have no errors. This figure is not a measurement of startup time or of rendering performance with real data.

This work followed the instruction not to use Computer Use, so the real connection screen was not checked visually or by keyboard operation. Authenticated fetching and real posting on GitLab.com, a real Self-Managed instance, an internal CA and proxy, performance when fetching large amounts of real data, and a real install and restart through automatic update are not verified. The success of the API fixtures and the public API does not imply success of these.

## Initial foundation

2026-09-30 / Windows x64. This record covers the 0.1.0 foundation, which is not connected to GitLab.

| Item | Result |
| --- | --- |
| Tauri environment diagnosis | WebView2, MSVC, Rust and Node were detected. The requirements are met |
| Development start | `npm run desktop:dev` started Vite and the Rust app. Rust build output was excluded from Vite's watch, which resolved EBUSY on Windows |
| Full check | `npm run check` passed. HTTP 200 was kept while it ran alongside the development server |
| ESLint | Passed |
| Frontend tests | 7 passed. Preview, navigation, IPC success/failure/waiting, and others |
| Design constraint check | Passed |
| TypeScript / Vite | Passed |
| Rust fmt / Clippy | Passed. Clippy was run with warnings as errors |
| Rust test | 1 IPC JSON contract test passed |
| npm dependency audit | 0 reported vulnerabilities (the npm audit result of that day; not a guarantee of the safety of all dependencies) |
| Tauri release build | `npm run desktop:build -- --no-bundle` passed |
| Windows executable | 8,678,400 bytes. It does not include the runtime such as WebView2 |
| IPC on the production screen | runtime_info returned appVersion=0.1.0, os=windows, arch=x86_64 |
| Permission restriction | `plugin:app\|name`, which is not allowed, is rejected by the ACL |
| Lazy loading in production | The split JS of the UI catalog is loaded and can be shown |
| Production console | 0 errors/warnings in the final start, screen navigation and IPC check |

Playwright drove the browser preview and the WebView2 of the generated executable. It confirmed navigation across Overview, merge requests, Issues, Pipelines and the UI catalog, light and dark themes, focus with Tab, and changing the theme with Enter. The browser display at 1280×840 and 960×640 was checked visually. In the native WebView at 1008×662 there was no horizontal overflow.

The initial JS is 456.73 kB (gzip 145.71 kB), and the lazily loaded catalog is 65.80 kB (gzip 20.23 kB). There is no Vite size warning. These are build artifact sizes, not proof of startup time, memory use, or being faster than the GitLab web UI.

The validation images are saved in `output/playwright/`, which is not under Git management. `final-native.png` is the final release-build screen that confirms the Rust connection. The WebView2 debug connection enabled temporarily for validation stops when the process exits and was not added to the app settings.

Not verified: a real GitLab connection, PAT/OAuth, an internal CA/proxy, performance with fetched data, signing and installers, and operating systems other than Windows. See the [feasibility study](feasibility.md) for the next decision material.

## Validation of the interactive UI mock

Added 2026-09-30. A browser preview using the fictitious data of `#mock` was validated. This is not validation of the real API, authentication or persistent cache.

- `npm run check` passed. 14 frontend tests, 1 Rust test, ESLint, design guard, TypeScript/Vite, and fmt/Clippy passed. Lint and build were checked again after the last adjustment of the input field layout.
- Light and dark themes were shown at 1280×840 and 960×640, and there was no horizontal page overflow. Long code lines scroll horizontally inside the diff area.
- With Playwright, title/description search, the Merged filter for past MRs, project search and favorites, and moving among the list, detail and catalog were exercised.
- Confirmed: keeping a draft per MR, replying to a new comment, resolve/reopen, approve/revoke, and returning to the list at a narrow width. The simulated post with Ctrl+Enter and the focus outline on Tab were also checked.
- The browser console of the final preview had 0 errors/warnings. Data, drafts and posts exist only in memory and reset on reload.
- Images for visual checking are saved in `output/playwright/mock-review-dark.png`, `mock-review-light.png`, `mock-small-light.png`, `mock-catalog-dark.png` and others (not under Git management).

The features of this mock are for confirming the UI direction. They do not guarantee rendering of large amounts of real data, virtualization performance, posting consistency with GitLab, or permission control.

## Extending the project screen, commit diffs and overview

Added 2026-09-30. Additional validation of the mock above.

- `npm run check` passed. 20 frontend tests, 1 Rust test, ESLint, design guard, TypeScript/Vite, and fmt/Clippy passed.
- Confirmed: title/description search within a project, switching Open/Merged, and opening a past MR from a Data Catalog with 0 Open. In the browser, the search term and the Merged filter were kept when returning from an MR.
- Switching between the entire MR and a single commit was confirmed, including different patches of the same file, the parent SHA, and resetting the file selection. Line comments of the entire MR are not overlaid on a commit diff, and another MR returns to the entire view.
- The overview shows existing comments and reply bodies. The reply button moves focus to the input field, and the view stays on the Overview tab after a simulated post. The extra information can be opened and closed with the Enter key.
- Light and dark themes and the displays at 1280×840 and 960×640 were checked visually. Even at 960×640 the body of the first comment in the overview is readable on the initial display, and there is no horizontal scroll on the whole page.
- The UI catalog uses the same MockProjectPage and MockReviewPane as the app. Project search and commit switching in the catalog were also exercised.
- Images are `output/playwright/v2-project-dark.png`, `v2-project-light-960.png`, `v2-overview-dark.png`, `v2-overview-light-960.png`, `v2-commit-dark.png`, `v2-commit-light-960.png` and `v2-catalog-dark.png` (not under Git management).

This is still a UI mock with fictitious data. A real GitLab connection, the persistent cache, and performance as the number of reviews grows are not verified. This addition was validated in the browser, and the Windows release executable was not regenerated.

## Tidying the screen frame for daily use

Added 2026-09-30. The logo, subtitle and duplicate header were removed, and the screen was changed to a one-line navigation with collapsing and a bottom status bar.

- `npm run lint`, `npm test -- --run src/pages/MockApp.test.tsx` (11 tests) and `npm run build` passed. Design guard and TypeScript also passed.
- In the browser, the following were confirmed: keeping the search conditions and the selected MR before and after collapsing, moving to Projects/Search/Review from the icons, changing the theme, and the always-visible mock label.
- The focus outline with Tab/Shift+Tab and expanding with Enter were confirmed. Both themes at 1280×840 and 960×640 were checked visually; the bottom controls are not cut off even at a narrow width, and the page has no horizontal overflow.
- The MR detail area at 1280×840 was 790×798px (top at 42px) before the change and 814×816px (top at 0px) after it. With the navigation collapsed it is 918×816px. The three navigation rows are 36px high each. These are measured layout values, not measurements of processing performance.
- The console after the final reload had 0 errors/warnings. The validation images are `output/playwright/shell-overview-dark.png`, `shell-overview-collapsed-dark.png`, `shell-expanded-light.png`, `shell-small-light.png`, `shell-small-dark.png` and `shell-keyboard-focus.png`.

## Commit timeline

Added 2026-09-30. The selection UI at the top of the Changes tab was changed to a horizontal timeline that places the entire MR first.

- The 3 related MockReviewPane tests, lint, TypeScript, design guard and Vite build passed. Lint and build were checked again after the final adjustment of the connection line position and the sample date and time.
- In the browser, the sequence entire MR, first commit, last commit, entire MR was exercised, and the patch content of the same file, the line comment markers and the file selection were confirmed to switch according to the comparison target.
- Selection with the left/right keys, Home and End, and horizontal scrolling with the step buttons in a catalog example of 12 commits were confirmed. The horizontal scroll stays inside the strip, and the width of the whole page does not increase.
- Light and dark themes at 1280×840 and 960×640 were checked visually. The timeline itself is 66px high and keeps the horizontal width of the diff. Long subjects are truncated, and the full text is included in the tooltip and the accessible name.
- The console after the final reload had 0 errors/warnings. Images are `output/playwright/timeline-commit-dark.png`, `timeline-light.png`, `timeline-small-light.png`, `timeline-small-dark.png` and `timeline-many-dark.png`.

## Showing the whole file

Added 2026-09-30. "Diff / Whole file" was added to the heading of each changed file.

- `npm run lint`, `npm test` (27 tests) and `npm run build` passed. Design guard and TypeScript also passed.
- Fictitious sources for all 8 paths were prepared, and tests confirmed that the new line numbers and bodies of the diff match the full snapshots of the entire MR and of each commit. The full-text match between the entire MR and the latest commit, and the difference from an older commit, were also confirmed.
- In the browser, the following were confirmed: scrolling to the end of the full text, the full text including unchanged parts, keeping the display mode when switching commits and files, and resetting in another MR. The full text does not mix in deleted lines or line comment markers, and the markers appear when returning to the diff.
- A component test confirmed the distinction between content not yet fetched and an empty file. The UI catalog can exercise the same full-text view.
- The displays at 1280×840 and 960×640 in both themes were checked visually. There is no horizontal overflow on the whole page. Tab moves to the selection group, the left/right keys and Enter switch the view, and a 2px focus outline was confirmed.
- The browser console after the final reload had 0 errors/warnings. Images are `output/playwright/full-file-dark.png`, `full-file-light.png`, `full-file-small-light.png`, `full-file-small-dark.png` and `full-file-end-dark.png`.

This was checked with a UI mock using fictitious data. Fetching files from a real GitLab and rendering performance for large files are not implemented or not verified. The Rust code was not changed, and the Windows release executable was not regenerated.

## MR detail that starts from the discussion

Added 2026-09-30. The tabs were changed to "Discussion → Changes → Overview", and the initial view was unified to Discussion.

- `npm test` (29 tests), `npm run lint` and `npm run build` passed. Design guard and TypeScript also passed.
- In the browser, the initial view, navigation from project and past MR search, and tab switching in the catalog were confirmed.
- The overview shows the full description and short extra information, and does not duplicate the discussion list or the input fields. Going back and forth with the overview keeps the new comment and reply drafts, and the reply focus and the simulated post were confirmed to work.
- Commit switching and the full-file view on the Changes tab were also exercised. Both themes at 1280×840 and 960×640 were checked visually. At a narrow width the first comment body and the reply are shown, and the page has no horizontal overflow.
- Moving among Discussion, Changes and Overview with the arrow keys and Enter was confirmed. The final browser console had 0 errors/warnings.
- Images: `output/playwright/discussion-first-dark.png`, `discussion-first-light.png`, `discussion-first-small-dark.png`, `discussion-first-small-light.png` and `overview-reference-dark.png`.

This is still a UI mock with sample data. The real API, Rust and the Windows release executable are unchanged.

## GitLab-style comment and review actions

Added 2026-09-30. Regular comments/threads, replies, comments on old/new lines and files, Markdown rendering, editing and deleting your own posts, and checking, publishing and discarding a pending review were added to the mock.

- Integrated validation: `npm test` (10 files, 57 tests), `npm run lint` and `npm run build` passed. TypeScript and design guard are included.
- In the browser, adding and editing a regular comment, making a thread with a reply, and keeping replies after the parent body is deleted were confirmed.
- In a pending review, counts and resolved states do not change, and on submit the replies, resolutions and overview are reflected. Lines on the old side, lines in a full commit text, and whole-file comment targets are also kept.
- Editing a pending body, blocking submit while an edit is unsaved, optional approval, canceling and confirming a discard, and the reset of the overview and approval check after a discard were exercised. Pending reviews across MRs and the separation of inputs by line position were confirmed by integration tests.
- Adding to the review with Ctrl+Enter and an immediate comment with Ctrl+Shift+Enter were confirmed. Showing the line comment button and a 2px focus outline with Tab/Shift+Tab were confirmed.
- Light and dark themes at 1280×840 / 960×640 were checked visually. The input field, the Markdown preview, and the submit confirmation dialog at a narrow width were checked, and the whole page has no horizontal overflow. Input in the catalog can also lead to the pending review confirmation.
- The console after the final reload had no warnings or errors. It was checked separately from old logs caused by intermediate HMR and pre-fix styles.
- Images: `output/playwright/comments-dark-1280.png`, `comments-light-1280.png`, `comments-dark-960.png`, `comments-light-960.png` and `comments-light-dialog-960.png`.

The scope is sample operations in memory. Posting to a real GitLab, server drafts, attachments, suggestions and permission checks are not implemented. See the [parity plan](comment-review-parity.md) for details. Rust and the Windows release executable were not changed this time.

## Screen transitions as data grows

The cause of transitions getting slower as stored data grows was measured with data filled to the limit, and fixed. It is not measured on a real GitLab connection or on WebView2, and the numbers are from the development environment.

| Target | Condition | Before | After | Environment |
| --- | --- | --- | --- | --- |
| Reading the read records | The limit of 16,000 entries (535 KB), unread counts for 50 MR list rows | 282 ms | 1 ms | Browser preview (development build) |
| One read of the local cache | 600 entries × 200 KB (about 120 MB) | 9 to 14 ms | 0.4 to 0.8 ms | `cargo test --release` |
| One write of the local cache | Same | 19 ms | 4 ms | Same |
| Re-rendering 600 comment bodies | No change in content | 653 ms | 9 ms | Vitest (jsdom) |
| Re-showing 600 comment bodies | Reopening the same MR | 1,112 ms | 225 ms | Same |

The read records were parsed in full on every render, so they are now parsed only when the stored content changes. Updating the read records on the MR screen also runs only when the discussions change, not on every render. The cache counted the total size of all entries on every read, so expired entries are now excluded by a read condition, and capacity cleanup is done on write using only the index. Rendered Markdown is reused for up to 2,000 comment bodies. Re-rendering the whole list of 60 discussions and 180 comments still takes about 360 to 420 ms in jsdom, and this remains.

## Reading a saved answer from the cache

Added 2026-11-05. A saved answer is a GitLab response stored as JSON text in the SQLite cache.

**Result:** Rust no longer rebuilds the JSON on a cache read, and the store's lock is held for less time. A whole read of a string-heavy 3.83 MB answer showed no clear gain. The step timings suggest a larger gain for answers made of many small fields, but no whole read of such an answer was measured. Neither was the wait for the lock.

### What changed

All cache work goes through one SQLite connection behind one lock.

| Operation | Before | After |
| --- | --- | --- |
| Cache-only read | Under the lock: read the row and parse it. Then write it out as JSON again | Under the lock: read the row. Outside it: check the text and send it unchanged |
| Saving an answer | Under the lock: write out the JSON and store the row | Outside the lock: write out the JSON. Under the lock: store the row |
| A network read that reuses an identical read's saved answer | Under the lock: read the row and parse it | Under the lock: read the row. Outside it: parse it. It is still written out as JSON afterwards |

The code is `saved_answer` and `query` in `native.rs`, and `check_snapshot` in `storage.rs`.

`check_snapshot` still reads the whole text, so it takes longer on larger answers. A row fails as a storage error if its JSON is malformed, a required field is missing, or a field has the wrong type. `nextPage` and `totalPages` may be absent. Inside `data` only the syntax is read, so out-of-range numbers, very deep nesting and lone surrogates now pass on a cache-only read. The app does not write such values, and `JSON.parse` accepts them. The reuse path in the table still parses the row, so it still fails on them.

The `source` field says where an answer came from, and the saved text keeps the value it was saved with. Rust used to set it to `cache` on a cache-only read. `query_gitlab` now returns `network` there, and `queryGitLab` in `src/lib/gitlab.ts` marks the answer as `cache`. Code that calls `query_gitlab` directly cannot rely on `source`.

### Timings

These are medians on a development PC running Windows 11, using synthetic data. Nothing here was measured on a real GitLab connection. The scripts were not kept in the repository. The sizes of real answers were not examined; 8 MB is the largest answer the cache saves.

The steps were timed in standalone programs, on items of about 900 bytes each, so these answers have many small fields. Ranges are the medians of two runs. The `IgnoredAny`, SQLite and `JSON.parse` rows are from one run.

| Step | 200 KB | 8 MB | Measured with |
| --- | --- | --- | --- |
| Read the row from SQLite | 0.2 ms | Not measured | Python `sqlite3`, 600 rows of 200 KB, OS file cache warm |
| Parse into a JSON value | 0.8 to 1.1 ms | 27 to 38 ms | Release build of `serde_json` |
| Write the value as JSON | 0.4 to 0.5 ms | 15 to 20 ms | Same |
| Read the whole text without building values | 0.2 ms | 7.5 ms | Same, with `IgnoredAny`, standing in for `check_snapshot` |
| `JSON.parse` | 0.6 ms | 24 ms | Node.js 24, not WebView2 |

The whole read was timed from `invoke` to the parsed answer in WebView2, in release builds, one read at a time. The answer was 3.83 MB: 100 items with a 40,000-character description each, so most of it is long strings and there is less to parse than in the table above. Each run made 40 reads.

| Read path | Median of each run |
| --- | --- |
| Before, reproduced | 41, 46, 58 ms |
| After | 37, 39, 89 ms |
| After, three runs on earlier test builds | 43, 48, 50 ms |

These runs cannot show whether reads got faster:

- The ranges overlap.
- The order was fixed: the runs on earlier test builds came first, then the three "after" runs, then the three "before" runs. The earlier test builds had the same read path. The 89 ms run was the first after a build, and its cause is unknown.
- The "before" build is not the old code. It added the old conversion after the new check, outside the lock, so it includes extra work and has different locking.

All of these runs predate the final `check_snapshot`, which also checks the types of `source`, `completeness`, `nextPage` and `totalPages`. They were not repeated with it.

The app runs `quick_check` over the whole database file at every start, before any saved answer can be read. Opening the 117 MB file of 600 rows and running it took 113 and 180 ms: one run on each of two files, with a warm OS file cache, in Python `sqlite3`.

### What was tried and left alone

Moving `fetched` ahead of the `snapshot` column was timed once on 200 KB rows, and so was setting `mmap_size` to 256 MB and `cache_size` to 32 MB. Reads took 0.16 to 0.38 ms with no consistent direction, in the same Python `sqlite3` setup. The differences are a fraction of a millisecond per row, so these settings were not changed. Larger rows were not tried.

### Behaviour checked in the app

A test build with its own data folder ran against a local fake GitLab server. It allowed plain HTTP, which released builds do not. A script drove it over the WebView2 debug port and passed in three runs of the "after" build:

- An answer, a cache miss and an error each reached WebView2 in the expected form.
- With the server stopped and the app restarted, the screen drew the saved answer and labelled it as saved.

That build predates the final `check_snapshot`, whose added type checks are covered by unit tests only.

### Not measured

- The wait for the lock when several screens read or save at once.
- A whole read of an answer made of many small fields, such as a list or a discussion.
- A real GitLab connection, and the sizes of real answers.
- The transfer from Rust to WebView2 on its own.
- Reading an 8 MB row from SQLite.
- Rendering after the read.
- Reads and `quick_check` with a cold OS file cache.



## Start-up code and tab switching

The code loaded before the first screen was halved, and a click on an MR tab no longer waits for the tab to render. The figures are build artifact sizes, not start-up or transition times on WebView2 or with real GitLab data: the machine was shared with other heavy jobs during this work, and timings in the browser preview varied by up to five times between identical runs, so none are recorded.

| Target | Condition | Before | After | Environment |
| --- | --- | --- | --- | --- |
| JS loaded before the first screen | Entry script and its preloaded chunks | 2,211.9 kB (gzip 674.9 kB), 8 files | 1,116.2 kB (gzip 336.2 kB), 5 files | Production build |

The editor's chunk group took React's JSX runtime as a dependency, so every chunk imported the editor and it loaded at start with ProseMirror. The vendor groups now claim what the first screen needs first. The MR detail and code screens, the local clone settings and a README's plain file view load on demand, and the first two are loaded while the app is idle after start. The language files start loading before the other modules evaluate.

The tab strip follows a click at once; the tab renders in the background and another click can interrupt it; N / P do nothing until it has rendered. The click itself still renders the tab being left once more, and a switch renders the MR detail several times as the new tab's reads settle, with the active tab each time; this remains. Keeping the tab being left as it was rendered was tried and dropped: its menus and pickers live outside it and would have stayed usable with outdated handlers.

The watched MRs' activity no longer reruns, with every other watched MR, each time the workspace changes, and the MR screen records read state without rerunning on its own writes. Files without a review mark are no longer hashed. In Rust, a read releases its HTTP slot once GitLab has answered (a failure keeps it until its cooldown is recorded), the response is no longer copied before it is saved, and the duplicate-request check skips an older saved answer in SQL instead of parsing it.

## Clicks during tab switching and rapid clicks

A click on an MR tab, a sidebar tab or an MR row no longer renders the whole workspace before the frame. Measured with the fixture client in a production build in headless Microsoft Edge (Playwright) at 1280×840 with the CPU throttled 4×, two runs each, alternating with the build before the change (d97d003); medians of the steps of each scenario. Not measured on WebView2 or with real GitLab data, and the machine was shared with other work.

| Target | Before: click to next paint | After | Before: longest frame | After |
| --- | --- | --- | --- | --- |
| MR tab (7 switches) | 312 ms | 64 ms | 360 ms | 130 ms |
| Sidebar tab between 4 open MRs (6 switches) | 448 ms | 64 ms | 390 ms | 150 ms |
| 16 MR tab clicks 60 ms apart | 704 ms | 128 ms | 701 ms | 861 ms |
| 12 sidebar tab clicks 80 ms apart | 2,504 ms | 256 ms | 2,471 ms | 863 ms |
| Opening an MR from the list | 560 ms | 40 ms | 781 ms | 341 ms |

Long tasks in the two rapid-click scenarios fell from 5.8 s and 8.0 s to 2.7 s and 2.0 s.

The location was read with useSyncExternalStore, which React always renders at once, so every click rendered the whole workspace (about 1,100 to 1,250 components) inside the click. The screens now follow the location in a transition, which a later click interrupts; the MR tab strip moves to the clicked tab at once by itself. GitLab answers (useGitLabQuery), loaded discussion and diff pages, activity, notifications and the personal workspace also render in transitions. Showing an MR recorded it as recently viewed, and the record rendered every screen that reads the workspace; the visit records (`recent`, `shown`), which no screen shows, no longer do. A composer starting to hold back updates rendered the whole workspace for the update button; only the update controls render now. Moving the pointer onto the expanded sidebar rendered the navigation.

What remains: the commit of a transition (DOM changes, and the effects of the screen being hidden and the one being shown) runs in one task, so a long frame still appears once when a switch finishes and when a new MR mounts; the MUI tab strip renders twice more after a click to place its indicator.

## Opening a long discussion

Added 2026-11-05. Before this change, opening the Discussion tab mounted every thread together: `content-visibility: auto` skips layout and paint, but not React's render and mount of threads out of view. How threads mount now is described under "Long discussions" in the [UI design](ui-design.md). Section 14 of [Architecture](architecture.md) sets no number for opening a discussion.

Measured on 2026-11-06 with the fixture client (the client's screens on fixed data with no GitLab connection, `?fixture=ready`). The answer was synthetic: 60 threads with 3 comments each (140 KB), arriving at once and opening at the newest thread, on a first open of the discussion with every comment unread. The build used production React without minifying and ran in headless Microsoft Edge (Playwright) at 1280×840. "Off" is the same code with deferred mounting switched off; "on" has it on. They were alternated, and the table gives medians of 5 pairs at normal CPU speed and 2 pairs with the CPU slowed 4×. Each run lasted from the click on the tab until every thread had mounted and no long task had started for 1.5 s. Long tasks were read with a `PerformanceObserver`. The scripts are not in the repository.

| Target | Normal CPU: off | On | Slowed 4×: off | On |
| --- | --- | --- | --- | --- |
| Click to the first comment | 1,602 ms | 680 ms | 9,628 ms | 4,040 ms |
| Longest task | 514 ms | 243 ms | 3,102 ms | 1,080 ms |
| All long tasks added up | 749 ms | 321 ms | 8,025 ms | 12,714 ms |
| Click to every thread mounted | 1,736 ms | 2,283 ms | 9,800 ms | 25,574 ms |

Other jobs were running on the PC and their load was not recorded. With deferred mounting off at normal speed, the first comment took 1,420 to 2,356 ms, so use the table for direction and rough size only.

What can be said:

- The first comment appeared sooner and the longest task was shorter in all 7 pairs. At normal speed the medians are about 2.4 times sooner and 2.1 times shorter.
- Every thread took longer to mount in 3 of the 5 pairs at normal speed and in both pairs with the CPU slowed 4×, where the median is about 2.6 times as long.
- Whether the total work fell cannot be told. The added-up long tasks fell at normal speed and rose with the CPU slowed 4×, and they also depend on how the work was split into tasks.

Checked in the same browser and build at normal CPU speed:

| Check | Result |
| --- | --- |
| The discussion ends up at the newest thread once all threads have mounted | In 5 of 5 runs, the last thread was where it is with deferred mounting off (top 188 px, `scrollTop` 45,532) |
| N (next unresolved thread), pressed with 55 of 60 threads waiting | In 3 of 3 runs, the first comment of the first thread had the focus; that thread was waiting, far from where the discussion opens |
| Scrolling up 20 wheel steps of 900 px during mounting | An empty box was on screen in 29 of 180 frames, at most 3 at once |
| Returning to a Discussion tab built again under memory pressure | The same thread at the same offset (`scrollTop` 9,000) |

Not checked:

- WebView2, which is what the product runs on, and a real GitLab connection.
- A PC with less other work.
- That the opening position does not move on screen during mounting. Only its place after mounting was compared.
- A discussion opening at an unread comment in the middle. A unit test covers only that its thread mounts at once.
- A comment being edited or a reply being written while threads wait, which has no test either.
- Moving with N, P or the thread outline to a folded thread that is waiting. N was checked only on a thread that is open.
- Where the reader's place goes when threads above mount after the reader has scrolled.
- How long a tab built again under memory pressure takes, as it mounts all its threads together.
- How screens behave under the current rule for which tabs are kept under memory pressure. The checks above were made under the earlier rule. Under that rule, only the tab on view was kept, and a tab built again showed at once. Under the current rule, the tab shown before is kept too. A tab built again still mounts its threads the same way. However, it first waits out of sight until its saved data is read.
- Other numbers of threads. The values in the UI design (12 threads, 4 on each side, 110 px per row, 1,000 px from the view) were not derived from measurements.
- What the remaining longest task consists of.
