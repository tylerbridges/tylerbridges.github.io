# Repository workflow

This is Tyler's personal GitHub Pages weather site. Optimize for a simple
iteration loop: request, implement, review, publish, verify.

## Default publishing workflow

- Work directly on `main` unless Tyler explicitly asks for a branch or pull
  request.
- At the start of a task, inspect `git status`. When the checkout is clean,
  update it with `git pull --ff-only origin main` before editing.
- Preserve unrelated or pre-existing changes. Never reset, overwrite, or
  discard them to make the checkout clean.
- Implement the complete requested change, including necessary accessibility
  and responsive behavior.
- Run `bash scripts/verify-site.sh` after editing.
- Review the full diff before publishing. Check correctness, regressions,
  accessibility, mobile layout, stale duplicated markup, secrets, and whether
  the service-worker cache key needs to change. Fix material findings and run
  verification again.
- Commit only task-scoped files with a descriptive commit message.
- Push the completed commit directly with `git push origin main`. Do not stop
  merely to ask whether to push, and do not open a pull request unless Tyler
  explicitly requests one.
- Never force-push or rewrite published history.
- After pushing, confirm that `origin/main` contains the new commit and check
  the GitHub Pages deployment. Report the commit, verification results, and
  deployment status.

## Site-specific checks

- `index.html`, `brief.html`, and `live.html` are synchronized entry pages and
  must remain byte-identical unless the task explicitly separates them.
- When changing a file listed in `SHELL` in `sw.js`, increment the
  `rochester-weather-vNN` cache key so installed clients refresh cleanly.
- Keep the site dependency-light and compatible with static GitHub Pages
  hosting.
- Prefer the existing design tokens and shared components in `assets/` over
  page-specific duplication.

## Code Review Rules

- Treat broken navigation, stale cached assets, inaccessible controls, runtime
  JavaScript errors, and layouts that fail at narrow widths as release-blocking.
- Verify dialogs and menus have correct focus behavior, Escape dismissal,
  backdrop dismissal where appropriate, and accurate ARIA state.
- Do not publish credentials, private data, generated build debris, or
  unrelated formatting churn.
