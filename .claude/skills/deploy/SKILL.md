---
name: deploy
description: Push Topo Heli to GitHub and wait for the GitHub Pages deploy. Use only when the user says "push" (or asks to deploy / put it live).
---

1. `git status --short`: commit anything finished that is still uncommitted (ask if unclear what it is).
2. `npm run build` must pass; stop and report if it does not.
3. `git push origin main`.
4. Wait for the Pages run and get its result:
   ```sh
   id=$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
   gh run watch "$id" --exit-status > /dev/null 2>&1
   gh run view "$id" --json conclusion,headSha --jq '.conclusion + " " + .headSha[0:7]'
   ```
5. Report in one or two lines: success (live at https://rednoos.github.io/topo-heli/, refresh to see it)
   or the failure with the failing step (`gh run view "$id" --log-failed`).
