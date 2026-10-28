# GitLab Desktop

English | [日本語](README.ja.md)

A personal GitLab API client for Windows. It is built with Tauri 2, Rust, React, TypeScript and MUI, and connects from Rust directly to GitLab.com and Self-Managed GitLab. Normal connections and requests do not depend on glab or on embedding the GitLab website.

Source and downloads: [GitHub](https://github.com/ota-takeru/gitlab-desktop) / [Releases](https://github.com/ota-takeru/gitlab-desktop/releases).

## Usage and scope

The interface language can be English, Japanese, Simplified or Traditional Chinese, Korean, German, French, Spanish, Brazilian Portuguese or Russian, chosen under "Settings" → "Language" (the OS language by default). Languages other than English and Japanese are machine translated and have not been reviewed by native speakers yet ([Localization](docs/i18n.md)).

Validation currently targets GitLab.com. [Product readiness](docs/product-readiness.md) lists what has been verified and what is still unverified for authentication and hands-on use.

Install the app with the Windows NSIS installer from Releases. Under "Settings" at the bottom of the sidebar, enter `https://gitlab.com` or the HTTPS URL of your company's GitLab, and a Personal Access Token. URLs with a sub-path work. A classic PAT needs the `read_api` scope to read and the `api` scope to post reviews. The token is stored in the Windows credential store and is never returned to the screen.

If you are already signed in to the GitLab instance with glab, you can choose "Connect with glab credentials" on the connection screen to skip entering a PAT. Rust then reads, once, only the glab credential whose authority matches the connection URL, and copies the PAT or OAuth access token to the Windows credential store after checking the connection and `/user`. An OAuth expiry is accepted only as a future RFC 3339 value, and refresh tokens are not imported. The app does not sign in or refresh with glab or change its global settings, and all GitLab API requests after the import go directly from Rust. Connecting with a PAT by hand still works.

- Project search, membership/visibility and archive filters, favorites and recent items. A project's screen switches between MRs, branches and code with tabs. Branches are listed newest-updated first with their state (default, protected, merged) and latest commit, and choosing one lists that branch's MRs. Code lets you pick a branch, browse folders and view files with line numbers and syntax highlighting (text up to 1 MiB; files that are not UTF-8 are read in their likely legacy encoding, such as Shift_JIS, GBK, Big5 or EUC-KR).
- Go straight to MRs assigned to you, waiting for your review, or created by you. Title and description search (inside a project `!123` picks an MR number, and `123` shows the number match first, then title and description matches), filters for state, assignee, author and period, and paging. Labels are given comma separated, and source and target branches match exactly. A group ID or path searches the group including subgroups, as an alternative to the project filter.
- Suggestions for users, projects and groups, and sorting by updated or created date. Up to 20 saved searches, which can be renamed and deleted.
- The MR list shows the project path, assignees, reviewers, labels, draft state and the CI status when fetched. When CI details are omitted, "Check CI" on the row fetches them.
- Opened MRs line up as tabs in the sidebar, as in Arc, with pinned MRs grouped above them. A tab can be pinned, unpinned or closed, and closing the tab on screen opens the next one. A tab's title and state are those from when the MR was last shown, saved on this device, so tabs do not each query GitLab. The MR list switches between Search, Review requests, Assigned and Created with tabs (drag to reorder; the first tab is shown at start), and conditions such as people, labels and branches and saved searches live in the Search tab. Applied conditions, including the search text, are shown as tags: "Add a condition" adds one and a tag's ✕ removes it. Notifications open over the page from the sidebar's notification button. Space previews a list row's overview, and a row can be pinned from the list. You can paste the URL of an MR on the connected GitLab to open it directly. Each account keeps up to 100 pinned MRs, 20 open tabs and 30 history entries.
- MR overview, discussion, changes, per-commit changes and file contents at a given SHA. Choosing a push version in "Compare from version" on the changes tab shows the changes from that version to the latest (as in GitLab's version compare, the heads of both versions are compared directly, so changes from the target branch are included if a rebase happened in between; it is read-only and records no line comments or viewed files). "Local changes" shows, for a local clone linked to the project, the difference between the MR's latest commit and the working tree (unpushed commits and uncommitted changes), read with git on the PATH (a folder can be linked only when its git remote points at the project, by typing its path or choosing it; nothing is fetched or changed, and you are asked to fetch when the MR's latest commit is not available locally; up to 300 untracked files are included as new files; "Whole file" and expanding between hunks show the working tree's current content (text up to 1 MiB; files that are not UTF-8 are read in their likely legacy encoding, such as Shift_JIS, GBK, Big5 or EUC-KR); it is read-only and nothing is saved). Because GitLab's diff API has no option to ignore whitespace, "Hide whitespace" on the diff toolbar shows removed and added lines inside a change block that match without whitespace as unchanged lines, and marks files whose only changes are whitespace (the choice is saved on this device; new line comments cannot be written while it is on, since line positions may shift). You can search the text and file names of the shown diff page and move between matches. Diffs and whole files are highlighted in the language detected from the extension and file name (Jenkinsfile, Dockerfile and so on), per shown page; pages over 200,000 characters and unsupported languages are not colored.
- Mark files of the whole MR as "Viewed". The marks are saved on this device per instance, account and MR, and are restored after a restart. They return to unviewed when the MR's head SHA or the diff changes. Up to 100 MRs with 500 files each are kept, and they are deleted on sign-out.
- Comments, line and file comments on the whole MR's changes, replies, editing and deleting your own comments, resolving and reopening.
- Attach images and files to new comments and replies. Choosing a file or pasting an image uploads it to GitLab and inserts the link into the text when it succeeds. When text and an image are pasted together (for example from Excel), the text is pasted and nothing is uploaded. If the editor is closed during an upload, the link is still added to the original unsent comment. Files are limited to 10 MiB, and sending waits up to about 3 minutes depending on the size. Attachments are uploaded before the comment is posted, so they stay on GitLab even if the text is discarded. When the outcome is unknown, a receipt is kept and sending again is stopped.
- The discussion shows only regular comments. It can filter unresolved threads, folds resolved ones, moves to the latest or unread comment and jumps from a line comment to its place in the diff. On the changes tab, line comments on the latest version are shown under their line as in GitLab, where you can reply, resolve or reopen them (and move to the thread in the discussion tab); comments on older versions and older discussions not yet loaded are shown only as counts and notes. Pressing a line's "+" opens an editor under the line, and line comments added to the unpublished review are shown under their line too. Shift+click from "+", dragging over the line numbers, or Shift+↑/↓ with "+" focused (Enter to confirm, Esc to cancel) selects several lines within one change block for a range comment, usable both as an immediate comment and in the review (GitLab's `line_range` and line codes, the file path's SHA-1 with the old and new line positions, are built and checked in Rust). Range comments are shown under their last line with a label such as "Comment on lines 12–15", as in GitLab. The unpublished review can be published one comment at a time, the selected ones or all at once from the discussion tab.
- "Insert suggestion" in a line comment editor inserts a change suggestion (` ```suggestion:-N+0 `, or ` ```suggestion ` for one line) built from the selected lines' current content. Discussion and diff threads show a suggestion as a diff against the lines it replaces (as returned by GitLab), and an applicable suggestion by someone else can be applied with "Apply suggestion" (or "Apply N suggestions together" when a comment has several), after a confirmation dialog and with an optional commit message. It is not applied if the MR's head on GitLab changed since it was shown. For comments whose suggestion ID cannot be read, "Apply on GitLab" opens the MR.
- A rich comment editor that shows formatting in place (it can switch to editing Markdown directly, and text the rich view cannot keep, such as HTML, opens in the Markdown view), a formatting toolbar like GitLab's (bold, italic, strikethrough, heading, quote, code, link, lists, task list, table; `Ctrl+B`, `Ctrl+I`, `Ctrl+Shift+X`) and `@` mention suggestions. Reading is recorded with "Mark loaded as read" (a comment once read does not become unread when it is edited or resolved), and the list's unread counts cover the comments last loaded.
- Notifications. Of GitLab's pending MR To-Dos, events such as mentions, failed CI, unmergeable MRs and approval requests are shown as a stack of cards, with the count inside the bell in the sidebar (assignments and review requests are handled by the MR list tabs and are not included). Notifications for the same MR stack on one card marked "N more". Opening a card opens the MR and marks that MR's notifications as read (completes the GitLab To-Dos), and "Mark all as read" marks the notifications of all pages as read (up to 1,000, at most 4 at a time). MR details show "Mark notification as read" when the loaded notifications include one for that MR (nothing more is fetched). Marking as read is sent only after checking on GitLab that the To-Do is still pending for that MR.
- Emoji reactions on the MR and on each comment. Chips with counts (yours shown as selected, who reacted in the tooltip), adding from an emoji picker with search (GitLab names and Japanese keywords), categories and a grid (skin tones, custom emoji and flags are not offered), and toggling from the chips. Comment reactions are fetched together with GraphQL back to the oldest comment of the shown discussion (one request per 100 comments, up to 500; a note says when more are not shown), and the MR's reactions with REST. Removing a reaction reads your reaction's ID from GitLab again before deleting it. Names other than the common ones are shown as `:name:`.
- Saving, editing, deleting and selectively publishing server-side drafts, approving and revoking approval, and changing assignees, reviewers and the description. The description, assignees and reviewers are not written if they changed on GitLab since editing started. Unsupported APIs and missing permissions are shown as errors.
- The MR's "Pipelines" tab lists the MR's pipelines (state, ref, SHA, created time) and shows the selected pipeline's duration, jobs by stage and downstream pipelines. Choosing a job shows the end of its log (up to 512 KiB, moving back and forward 500 lines at a time), with colors and bold mapped to the theme's colors. Logs are not saved on the device. A running pipeline and job log refresh every 15 seconds only while shown, and stop when they finish. Jobs can be retried, canceled and run manually, and a pipeline's failed jobs retried or the pipeline canceled; canceling and manual runs ask for confirmation. Before sending, the action is checked against the current state on GitLab, and when the outcome is unknown, sending again to the MR it started from is stopped.
- "More actions" in the MR details header offers merge, setting and canceling auto-merge (merge when the pipeline succeeds), rebase, request changes, changing the title, draft state, labels and milestone, and close and reopen. Merge can be chosen only when GitLab's `detailed_merge_status` says it is possible, and otherwise the reason is shown in the app's language (unresolved threads, conflicts, pipeline, missing approvals, draft and so on). A state that cannot be identified is never shown as mergeable. A merge is sent with the head SHA from when the confirmation dialog opened, and can squash, delete the source branch and set the merge commit message. After a rebase, the MR is read again every 5 seconds, at most 12 times, until it completes. Labels are sent as only those added or removed, so others' concurrent changes are kept. The title, milestone and state are not written if they changed on GitLab since they were shown. A re-review can be requested next to a reviewer on the overview tab. Request changes needs GitLab 18.9 or later and re-review requests use GraphQL; when the instance does not support them, an error is shown.
- A SQLite cache per instance and user. Saved data is shown first and then refreshed, and its age and refresh failures are shown. Retention is 30 days, with a 128 MiB cache budget and 256 MiB for the whole database. Signing out deletes stored data and credentials.
- Unsent comments are saved on the device and restored after a restart, an expired sign-in or a screen recovery. They are kept apart from GitLab's server-side drafts, up to 100 per account and 64 KiB of text each. Normal quitting and updates wait for pending saves to finish, and a failed save is shown.
- Receipts of posts whose outcome is unknown are persisted, and sending again to the same MR stays stopped after a restart. Disconnecting and switching connections are refused while posting. Signing out also deletes unsent input and receipts, so it asks for confirmation.
- Views are split every 600 diff lines, 1,000 file lines, 20 discussions and 50 comments within a discussion, and moving back and forward shows all fetched data.
- Signed NSIS distribution with update checks. Updates are checked at start and every 6 hours while the app is shown; when one is found, the signature-verified package is downloaded in the background and shown in the footer and settings. It is installed and the app restarted only when you press "Restart to update", which cannot be pressed while there is unsaved input or a send in progress.

Posts are never resent automatically. When an outcome is unknown, sending again stays stopped until it is checked on GitLab. Approving and revoking approval, publishing drafts, merging, canceling auto-merge, rebasing, closing, switching draft/ready, requesting changes and re-reviews, applying suggestions, retrying, canceling and running jobs and pipelines, and deleting comments and drafts ask for confirmation before sending. Publishing and approving are separate actions, and drafts made on the web that are not selected are not published together. Per-commit viewing and version compare are kept apart from comment positions on the whole MR.

The shown MR, its discussion and notifications refresh every minute. Refreshing pauses while typing or editing, while sending and while the app is hidden. "Settings" → "Auto refresh and notifications" turns auto refresh and desktop notifications on or off. Windows notification permission is asked for when notifications are turned on.

Comment notifications cover the open MRs and the latest 30 comments of the first 10 assigned and review-waiting MRs by update order. Desktop notifications for To-Dos check the newest 100 items for new ones. The first fetch does not notify, and your own actions are excluded. Notifications contain no titles or comment text. Loading discussions and searching for diff positions are limited to 10 pages, and the screen shows the fetched range.

`Ctrl+O` opens an MR by URL, and `Ctrl+K` moves to the MR list's Search tab. The mouse back and forward buttons move between screens opened in this window (switching an MR's Discussion, Changes, Overview and Pipelines tabs is part of the history). In the MR list, `j`/`k` or the up and down arrows select a row, and Enter opens it. While an MR is open, `j`/`k` move to the previous or next MR of the list it was opened from, and Esc returns to the list. The first time this device opens an MR it opens on the Overview tab, and on the Discussion tab after that (or on the tab given by a notification or URL). On the Discussion tab, the "Description" button or `d` shows the description, labels and milestone over the right side, keeping the discussion's scroll position, and Esc closes it. In the comment editor, `Ctrl+Enter` adds the comment to the review and `Ctrl+Shift+Enter` posts it immediately.

Certificate verification is always on. A company CA comes from the Windows trust store, and requests use the environment's proxy settings. The app's own OAuth sign-in and automatic refresh, PAC, NTLM and mTLS are not supported for now; keep this apart from using an OAuth access token imported explicitly from glab. Issues, local full-text search and showing several connections at once are later designs. Compatibility with real Self-Managed instances and authenticated real posting still need to be checked once connected. See the [architecture](docs/architecture.md) for details.

## Development environment

Checked with: Windows x64, Node.js 24.16.0, npm 11.13.0, Rust 1.98.0, the Visual Studio 2022 C++ tools, the Windows SDK and the WebView2 Runtime.

Rust is pinned per project by `rust-toolchain.toml` at the root, so this folder uses that version even if your default Rust is older. See `.node-version` for the Node version. The first run takes a while to download dependencies and compile Rust.

```powershell
npm ci
npm run desktop:dev
```

A desktop window opens. To stop, close the window and press Ctrl+C in the development terminal if needed.

To check only the UI in a browser:

```powershell
npm run dev
```

[Local preview](http://localhost:1420). This mode cannot get information from Rust.

The interactive mock for exploring UI directions opens from the [UI mock](http://localhost:1420/#mock). It shows the review list, diffs and discussion, project discovery, past MR search and the light and dark themes. It always shows "UI mock / sample data / not connected", and comments and approvals are simulated in memory; reloading discards them. It is a preview separate from the real API connection and cache.

To check the real client screens with fixed data, open `http://localhost:1420/?fixture=ready` (development server only; not in production builds). `src/mock/fixtureIpc.ts` answers IPC in place of Rust and nothing is sent to GitLab. Changing `fixture` to `loading`, `error`, `empty` or `stale` shows the loading, failed, empty and stale-cache states, and MR details open directly from the hash, as in `#client/mrs?reviewer=self&state=opened&mr=101-42`. Posts and approvals change only the page's memory and are gone on reload. "Fixture data · not connected to GitLab" is shown at the bottom right.

Development screens open in a given color scheme without changing the saved theme when `theme=light|dark` is added after the hash (in the query for fixture data). The UI catalog scrolls to a section when `section` is given, as in `#foundation/catalog?section=review&theme=dark` (`section` is the part after `catalog-` of the ids in `UiCatalogPage.tsx`).

The following describes the sample screens of `#mock`. For what the real client supports, see the feature list at the top.

Open a project's screen from the project list to search its current and past MRs. In an MR's "Changes", pick the whole MR or a commit from the timeline, and switch between the selected version's changes and full text with "Diff / Whole file". An MR opens on "Discussion", at the left, to focus on comments and replies. "Overview" is a reference screen for the description and other details when needed.

Comments cover regular comments, resolvable threads, replies and line and file comments. Markdown preview, editing and deleting your own posts, and resolving and reopening discussions work. "Start / Add to review" collects unpublished comments, and the review screen lets you try editing, discarding, publishing all and optionally approving. Ctrl+Enter adds to the review and Ctrl+Shift+Enter posts immediately. For differences between the mock and the real client and plans such as suggestions, see [Comment and review parity](docs/comment-review-parity.md).

## Checks and builds

```powershell
npm run check
npm run desktop:build -- --no-bundle
```

`check` runs lint, behavior and release-script tests, the design constraints, TypeScript, the frontend build and Rust fmt, clippy and tests. The live test against the public GitLab.com API runs only when asked for: `cargo test --manifest-path src-tauri/Cargo.toml --locked gitlab_com_public_projects -- --ignored`.

Release executable: `src-tauri/target/release/gitlab-desktop.exe`. Distribution uses the NSIS installer with the public key embedded. The update signing key is stored as a GitHub repository secret and is not in the source. Tauri's update signature is separate from Windows Authenticode signing. WebView2 is also required where the app runs.

A push to main has Actions publish the tag, installer, signature and `latest.json` after the checks. If the push leaves the version unchanged, Actions bumps the patch version and commits it to main; if you bumped it first, for example with `npm run version:bump -- minor`, that version is published. Documentation-only changes are not published. See [Distribution and updates](docs/distribution.md).

Individual commands:

| Command | Purpose |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run design:guard` | Finds raw colors outside the theme, direct HTTP calls from the frontend and Japanese left in shipped code |
| `npm test` | Frontend behavior tests |
| `npm run build` | TypeScript and Vite build |
| `npm run ui:snap` | Captures each section of the UI catalog and the real MR list, discussion and diff shown with fixed data in light and dark × 960×640 / 1280×840, and the loading, failed, empty and stale-cache states in light and dark × 1280×840, and compares them with baseline images. Locally it compares with this device's baselines (`output/ui-snap/baselines`, recorded on the first run), and in CI with `tests/visual/screenshots`. Review differences in `output/ui-snap/report` |
| `npm run ui:snap:update` | Recaptures this device's baselines after an intended visual change. CI baselines (`tests/visual/screenshots`) are updated by running GitHub Actions' UI Preview manually with `update_snapshots` and committing its artifact |
| `npm run native:check` | Rust formatting, static checks and tests |
| `npm run tauri -- info` | Diagnoses the Tauri development environment |

## Code and design

- `src/`: UI, MUI theme, shared components and typed IPC wrappers.
- `src-tauri/`: Rust commands, window settings, CSP and least privilege.
- `AGENTS.md`: UI and responsibility rules that AI-assisted implementation also follows.
- [Architecture](docs/architecture.md): the architecture and development order, centered on Self-Managed GitLab, project and past-MR search, and MR review.
- [UI design](docs/ui-design.md): screen structure, information density, shared components and the change rules that keep the UI consistent.
- [Feasibility and next stages](docs/feasibility.md): expected performance, constraints and the design of the GitLab connection.
- [Validation](docs/validation.md): the initial build, tests and connectivity checks on real Windows machines.
- [Localization](docs/i18n.md): message files, supported languages and how to write messages.

MUI renders in WebView2. Actual speed gains are verified through fetching only the needed APIs, paging, caching and controlling how lists and diffs render. The current foundation alone does not measure a speed improvement over GitLab on the web.
