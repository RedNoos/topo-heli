---
name: deploy
description: Push Topo Heli to GitHub and wait for the GitHub Pages deploy, live (main) or the test site (test branch, topoheli.com/test/). Use only when the user says "push" (or asks to deploy / put it live / put it on the test site).
---

1. `git status --short`: commit anything finished that is still uncommitted (ask if unclear what it is).
2. `npm run build` must pass; stop and report if it does not.
3. Live: `git push origin main`. Test site: `git push --force origin <branch>:test` (the branch
   to playtest, e.g. a feature branch; `test` is only a deploy target, never worked on).
   Before pushing to `test`: `git merge-base --is-ancestor origin/main <branch>` must succeed. A push
   to `test` runs the workflow file from that branch, so a branch behind `main` deploys the live site
   with an old `deploy.yml` (or none at all). If it fails, tell the user and offer to rebase the
   branch on `main` first; do not push it as is.
4. Wait for the Pages run and get its result:
   ```sh
   id=$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run watch "$id" --exit-status > /dev/null 2>&1
   gh run view "$id" --json conclusion,headSha --jq '.conclusion + " " + .headSha[0:7]'
   ```
5. Report in one or two lines: success (live at https://topoheli.com/, or the test site at
   https://topoheli.com/test/; refresh to see it)
   or the failure with the failing step (`gh run view "$id" --log-failed`).

Every run builds both `main` (live) and `test` (at /test/), so a push to either redeploys both.
