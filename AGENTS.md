# GitLab Desktop development rules

## Responsibility

- The main agent owns requirements, architecture, risk decisions and final review.
- Delegate bounded implementation and local validation to `worker` (Luna Max). Escalate specific unresolved correctness issues to `sol_worker` after a focused correction attempt.
- Keep authentication, permissions, migrations and concurrency design with the main agent until the plan is clear. Tiny edits may be handled directly.

## Product scope

- A personal Windows-first GitLab API client: Tauri 2 + Rust + React + TypeScript + MUI.
- The target is Self-Managed GitLab. Project discovery and historical MR search are first-class requirements alongside MR review. Follow `docs/architecture.md` and `docs/ui-design.md` for the proposed next milestones; distinguish these plans from implemented functionality.
- MR search covers titles and descriptions. The initial usable release includes comments, line comments, replies, own-comment edits/deletion, resolve/reopen, drafts and approve/unapprove where supported. Read-only delivery is an intermediate checkpoint.
- Do not use glab for normal authentication, HTTP, login, refresh, or global configuration changes; connect directly to GitLab APIs from Rust over the internal network. The explicit user action 「glabの認証情報で接続」 is the only exception: Rust may perform the bounded, host-matched import described in `docs/architecture.md`, then stores the verified PAT/OAuth access token in the Windows credential store and uses Rust HTTP thereafter.
- Persist fetched metadata, discussions and diffs with bounded retention by default. Prioritize responsiveness with many MRs, diff lines and discussions; measure network, cache and rendering costs separately.
- Do not embed the GitLab website. Do not describe the application as fully native rendering or automatically faster.
- The current milestone is an offline foundation. Label disconnected, loading, failed, empty and successful states truthfully; never substitute fabricated GitLab data.
- Add new features in small vertical slices, starting with read-only MR retrieval after the target instance and authentication requirements are known.

## UI consistency contract

- Centralize colors, typography, spacing, radii and MUI component defaults in `src/theme.ts`. Reuse `src/components` before inventing page-specific patterns.
- Use semantic palette values. Do not put raw colors, gradients, arbitrary fonts or decorative styles in feature files.
- Use `sx` for layout and semantic theme references, not a parallel design system. Keep one primary action per section and consistent dense desktop spacing.
- Any new shared visual pattern must appear in the UI catalog. Review both themes, keyboard focus and 960×640 / 1280×840 layouts.
- Distinguish initial loading, background refresh, empty, error and stale data when data fetching is introduced.
- Run lint/design checks, type checking and relevant behavior tests. For visual changes, inspect the rendered page; screenshots alone do not prove behavior.
- Do not add a second component library, paid MUI X dependency or icon font without an explicit architectural reason.

## Boundaries and security

- Frontend calls typed wrappers in `src/lib`; GitLab HTTP and credentials belong to Rust. No credentials in localStorage, browser state persistence, logs, `.env` committed to Git, or frontend bundles.
- Keep Tauri capabilities minimal and local. Add each custom command to the application manifest and its explicit permission; never enable arbitrary shell/filesystem/HTTP capabilities as a shortcut.
- Keep CSP enabled. Emotion currently requires inline styles; that does not justify inline scripts in production.
- Future authentication: least-privilege access, OS credential storage, validated instance origin, HTTPS verification and redacted errors. Never turn off certificate checks to fix a Self-Managed connection.
- Future caches must be separated by instance and account, have bounded retention, and clear private data on logout. No unbounded parallel requests or whole-instance polling.

## Reproducibility

- Use npm with `package-lock.json`, commit Cargo.lock, and use the project-pinned Rust toolchain.
- Do not change the user's global Rust toolchain, install system software, publish or create remote repositories as an incidental implementation step.
- Consult README.md and docs/feasibility.md before widening scope. Record measured performance separately from targets or hypotheses.
