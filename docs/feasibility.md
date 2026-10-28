# Feasibility study for Rust + MUI

Study date: 2026-09-30. Target: a personal, Windows-first GitLab desktop client.

For the design after the requirements were made concrete, see the [overall design](architecture.md). The first version centers on viewing Self-Managed MRs and searching projects and past MRs. This document remains as the first feasibility study.

## Decision

It is fine to start with this stack. Tauri 2 connects Rust and React/MUI. MUI is a React library, so the work divides into TypeScript/React for the UI and Rust for OS integration and API handling.

However, moving to Tauri alone does not make the app faster than the GitLab web UI. On Windows, HTML/CSS rendering by WebView2 remains, and so does the GitLab server's response time. The main source of improvement is implementing only the work that is used, small, and limiting how much is fetched and rendered. Aiming to reimplement the whole web UI would be a heavy maintenance burden.

| Topic | Decision and approach |
| --- | --- |
| Desktop base | Use Tauri 2. It uses the OS WebView and calls Rust commands through a typed wrapper |
| UI | React + TypeScript + MUI. The theme and shared components are the only standard |
| API | REST v4 first. Implement the one highest-priority item among MRs, issues and pipelines |
| Data fetching | Asynchronous HTTP in Rust. Return only the DTOs the UI needs. Do not add a large state management library at the early stage |
| Cache | Consider SQLite or similar in the next stage. First measure one screen, then design capacity, expiry and account separation |
| Authentication | For initial personal verification, a least-privilege PAT is a candidate. For continued use and distribution, also compare OAuth PKCE |
| Distribution | For now, only up to a local executable. Signing, installer and auto-update are a separate stage |
| Alternative | If eliminating web rendering itself is the goal, evaluate Rust UIs such as egui/iced separately. MUI cannot be used then |

## Performance design ideas (not implemented, not measured)

1. At first, fetch only one screen and one page. Start with a page size of 20 to 50 items and use the API's next-page information. Do not fetch everything.
2. Show the cache immediately and display the update time and the refetching state. Separate manual refresh from low-frequency background refresh.
3. Include instance/account/project/filter in the cache key. Merge duplicate in-flight requests and do not apply stale results after the screen changes.
4. Set limits on API concurrency and timeouts. Follow Retry-After on 429. Suppress polling in a hidden window.
5. Page long lists, and virtualize them if needed. Read diffs, Markdown and CI logs when opened, and limit their size.
6. Do not run CPU-heavy diff parsing or search on the UI thread. Do not put heavy synchronous work on Rust's async runtime either.

Candidate acceptance targets: p95 of 100 ms or less for switching a cached list, and 2 seconds or less from cold start to being operable. These are neither guarantees nor current measurements. After connecting to GitLab, compare the web UI and the release build on the same PC, project and data volume for startup, list display, detail display and search. Measure each condition several times and separate network wait from rendering time. Count memory across the WebView2 child processes, not just the app itself.

## Keeping the UI consistent

MUI alone does not prevent custom spacing, colors and density from multiplying. Use theme tokens, MUI defaults, shared layout, state displays and the UI catalog as the standard. AGENTS.md holds the change rules, and static checks detect raw colors and direct HTTP. Static checks do not guarantee every visual, so check new screens by eye in light and dark themes, with the keyboard and at the minimum window size. Add screenshot regression tests for representative states once the data screens are settled.

## Decide before connecting to GitLab

- GitLab.com or Self-Managed; for Self-Managed, the version, URL subpath, and whether there is a VPN, proxy or internal CA.
- The slowest tasks and their frequency: MR list, review diff, issue search, pipelines/logs and so on.
- Whether read-only is enough. Writes such as comments, approvals, merges and reruns need separate permission and operation design.
- Whether tokens can be issued, and SSO and organization policy. Do not use a method that pastes secrets into chat.

In the authentication implementation, use the OS credential store and do not return the token to the frontend. Keep HTTPS verification. When following redirects or paging URLs, do not send credentials to another host. Do not trust external data such as Markdown and diffs, and avoid inserting HTML. Treat the local cache as private data too.

## Development order by stage

1. Now: reproducible build, theme, screen frames, UI catalog, Rust IPC connectivity.
2. Decide the target server, then implement least-privilege authentication and one kind of list fetch, paging and error display.
3. Cache and detail display based on measurements. Judge the improvement by comparison with the web UI.
4. Add needed write operations, notifications, search and so on. Design signing and updates when distribution becomes necessary.

## Primary sources

- [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) — C++ and WebView2.
- [Tauri WebView](https://v2.tauri.app/reference/webview-versions/) — the rendering base for each platform.
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/) / [CSP](https://v2.tauri.app/security/csp/) — the boundary between IPC and the WebView.
- [MUI installation](https://mui.com/material-ui/getting-started/installation/) / [theming](https://mui.com/material-ui/customization/theming/) — the React dependency and centralized appearance settings.
- [GitLab REST API](https://docs.gitlab.com/api/rest/) — paging depends on the endpoint and version. Use keyset where supported.
- [GitLab API authentication](https://docs.gitlab.com/api/rest/authentication/) — tokens and rate limits.
- [GitLab OAuth](https://docs.gitlab.com/api/oauth2/) — PKCE and app registration.

The real target server has not been accessed yet. The size of the performance improvement, organization-specific authentication and GitLab version compatibility are unverified.
