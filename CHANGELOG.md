# LeetCode Sync (v1.5 Custom) – Development and Improvement Summary

This document summarizes all changes made to `leetcode-sync-1.5` from the beginning up to the current version.

---

## 1. Background and Initial Problem

- **Problem:** When running the GitHub Action `v1.5` (`joshcai/leetcode-sync@v1.5`), the workflow failed with:
  ```text
  Error: Request failed with status code 403
  ```
- **Cause:** LeetCode closed and blocked its old REST API (`https://leetcode.com/api/submissions/`) and now requires the **GraphQL API (`https://leetcode.com/graphql/`)** instead.
- **User requirements:**
  1. Modify `v1.5` to fetch data through the GraphQL API like `v1.7` does, to fix the 403 error.
  2. Keep the original `v1.5` directory structure and file naming (`solutions/problems/{problem_name}/solution.{ext}`).
  3. Keep the original `v1.5` commit message format (`Sync LeetCode submission - {Title} ({lang})`).

---

## 2. Changes

### 1. Switch to GraphQL API + Keep Original File Structure & Commit Format
- **Migrated to the LeetCode GraphQL API:**
  - Used `submissionList` to fetch the list of accepted (`Accepted`) submissions, with pagination (`offset`, `hasNext`).
  - Used `submissionDetails` to fetch the code of accepted submissions by `submissionId`.
- **Handled Premium / Locked problems:**
  - Added detection of HTTP 403 on `submissionDetails` so that Premium-locked problems are skipped without halting the whole sync.
- **Kept the original 1.5 file layout:**
  - Files are saved to: `{destinationFolder}/problems/{problem_name}/solution.{ext}`
  - Problem names are converted with `toLowerCase().replace(/\s/g, '_')` (snake_case as before, not the kebab-case with problem ID used in 1.7).
- **Kept the original commit format:**
  - Commit message: `Sync LeetCode submission - {submission.title} ({submission.lang})`

---

### 2. Fetch Problem Statements as `README.md`
- **Fetched problem descriptions via GraphQL:**
  - Added the function `getQuestionData(titleSlug)`, which runs the `getQuestionDetail` query to retrieve the problem statement (`content`).
  - Creates a `README.md` alongside `solution.{ext}` inside each problem's folder:
    ```text
    solutions/problems/{problem_name}/
    ├── README.md         <-- the problem statement
    └── solution.{ext}    <-- the accepted submitted code
    ```
- **Added a problem statement cache (`questionDataCache`):**
  - Stores the content by `titleSlug` so that no duplicate requests are made when a problem has multiple submissions.

---

### 3. Fixed `Cannot find module 'axios'` on GitHub Actions
- **Cause:**
  - The GitHub Actions runner does not automatically run `npm install` when downloading a custom action.
  - The `node_modules/` folder is listed in `.gitignore`, so it was never pushed to GitHub and the runner could not find the modules.
- **Fix:**
  - Used `@vercel/ncc` to compile and bundle all code, including dependencies (`axios`, `@octokit/rest`, `@actions/core`), into a single file at `dist/index.js`.
  - Updated `action.yml` to point to `main: 'dist/index.js'`.
  - Kept `node_modules/` in `.gitignore` to keep the repository small (no need to push 175 MB of `node_modules` to GitHub).

---

### 4. Code Quality and Robustness Improvements
- **Upgraded dependencies:**
  - Updated `axios` from `^0.21.2` (from 2021, with known security vulnerabilities and use of the deprecated `url.parse()`) to `^1.7.0`.
  - Removed the `node: "^16.18.1"` package from `devDependencies` and specified `"engines": { "node": ">=20" }` instead.
- **Deprecation and error handling:**
  - Changed `throw string` to `throw new Error(...)` to preserve stack traces.
- **Rate limit protection:**
  - Added `await delay(500)` between each submission fetch in the loop to avoid being disconnected by LeetCode when syncing many problems.
- **Refactoring and clean code:**
  - Defined the constant `const GRAPHQL_URL = `${BASE_URL}/graphql/`;` instead of hardcoding it in 3 places.
  - Moved the `fetchSubmissionsPage` function out of the do-while loop for readability and to avoid recreating the function on every iteration.
  - Updated the repository URL in `package.json` to match `ThakornToon/leetcode-sync`.
  - Added `default: ''` for `destination-folder` in `action.yml`.
  - Added `.DS_Store` to `.gitignore`.

---

### 5. Fixed and Guaranteed Correctness of `filterDuplicateSecs`
- **Improvements:**
  - In `index.js`: converted the input value with `Number(core.getInput('filter-duplicate-secs')) || 86400;`
  - In `src/action.js`: added the fallback `const duplicateWindowSecs = Number(filterDuplicateSecs) || 86400;` in the `addToSubmissions` function.
  - This ensures the value used in time comparisons is always a number, preventing issues from implicit type coercion.
- **Rebuilt the bundle:**
  - Recompiled `dist/index.js` with `ncc`, so the latest bundle is ready to use immediately.

---

## 3. Current Project File Structure

```text
leetcode-sync-1.5/
├── .gitignore            # Ignores node_modules, .DS_Store, .env
├── action.yml            # GitHub Action definition (uses node20, runs dist/index.js)
├── dist/
│   └── index.js          # The actual bundled file with everything included (~1.2 MB)
├── index.js              # Action entrypoint
├── package.json          # Defines scripts, engines, and dependencies (axios ^1.7.0)
├── package-lock.json     # Lockfile updated to match the latest dependencies
├── src/
│   ├── action.js         # Core logic (GraphQL, sync, rate limiting, file creation)
│   └── test_config.js    # Config for running local tests
└── CHANGELOG.md          # This document summarizing the development history
```

---


