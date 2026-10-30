# After Dark Scrabble — multiplayer preview

This is a **development preview**, not a verified production release. It has been checked for JavaScript syntax and JSON syntax, but live two-iPad/Firebase testing has NOT been performed. **Do not overwrite the working GitHub Pages app yet.**

## Included
- GitHub Pages static web app with Firebase anonymous sign-in and Realtime Database synchronization
- Create/join/rejoin six-digit game code, no player accounts; random starting player
- Only active player controls word entry, challenges, and turn advance; both devices display the challenge
- Private secret words, 4–8 letters, 50-point match awarded after both reveal at the end
- Word input cleared after turn; saved challenge state; 24 turns, three challenge rounds
- End game by either player with confirmation

## Firebase setup before deployment
1. In Firebase Realtime Database > Rules, paste the contents of `database.rules.json`, and publish. The database is currently locked; without publishing rules the app cannot connect.
2. In Firebase Authentication > Settings > Authorized domains, ensure your GitHub Pages domain is authorized if required by your Firebase setup.
3. Upload `index.html`, `app.js`, `manifest.webmanifest`, `sw.js`, and the three PNG icon files to the ROOT of a **separate test GitHub Pages repository** first. Do not upload `database.rules.json` to your public website; it belongs only in Firebase Rules.
4. Test with two iPads: create/join, private secret entry, word submission, same challenge on both, next player, close/rejoin, reveal and scoring, end game.

## Important security limits
Firebase's public web config is not a password; its values are safe to ship in a client web app. **However, the supplied Realtime Database rules are a prototype, not hardened access controls.** They permit any anonymous authenticated user to read games if they know a six-digit code and do not fully enforce turn-level write permissions. A six-digit code is not a strong secret. This is NOT suitable for sensitive or private content until server-side rules are hardened and validated. Private secret words are stored under separate owner-only paths, but a malicious client could still tamper with shared game data under these prototype rules. Do not deploy broadly as-is.

## Known limitations
- No server-side dictionary validation.
- The game does not implement physical tile-bag tracking.
- Firebase requires an internet connection; service worker does not enable offline multiplayer.
- Secret words reveal only at the end of the fixed-turn game, not at the end of each individual round.
- The current fixed 24-turn format is retained from the original app.
