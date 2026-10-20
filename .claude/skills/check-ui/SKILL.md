---
name: check-ui
description: Check a Topo Heli UI change in the browser on desktop and phone (menu, HUD, end screens), and play a map through. Use after changing the menu, HUD, end screens, texts or gameplay, before telling the user it is ready to test.
---

1. Make sure the dev server runs on port 5180 (`curl -s -o /dev/null -w "%{http_code}" http://localhost:5180/`);
   if not, start `npm run dev:lan` in the background.
2. Screenshots for the maps/modes the change touches (default: the one changed):
   ```sh
   npm run shots -- --map netherlands --mode free --lang nl
   npm run shots -- --map nl-utrecht --mode list
   ```
   Modes: `free`, `physical` (waters / mountains on), `list` (Alles vinden). Languages: `nl`, `en`,
   `sr-Latn`, `sr-Cyrl`. Check a long language (Serbian) for texts that wrap or overflow.
3. Read the PNGs in `.shots/` that matter (menu, game, end; desktop and phone) and look for:
   overflow, cut-off lists, elements that jump between states, untranslated or transliterated names.
4. For gameplay changes: `npm run playtest -- --map <id> --mode <mode>`; it must report no page
   errors and no targets that cannot be found.
5. Fix what you find, then report briefly; send the relevant screenshots with SendUserFile when the
   user should see them.
