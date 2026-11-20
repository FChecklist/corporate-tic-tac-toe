# Console voice (owner rule, 20 Nov 2026)

Full rules: marketing-ledger `plans/ID-INVITE-AND-ARCHITECTURE-RULES-2026-11-20.md`.

**Two voices, never mixed.**
- **Console voice** (console.corporatetambola.com and each game's organizer / Host / Co-host screens): speaks TO the organizer or Host as **you**. Simple English, short sentences, no jargon.
- **Game voice** (player screens): speaks to the players. Not covered by this file.

**Rules for console text**
1. Say "you" and "your". Never "I", "my", "me", "myself" (a button is "Add to your list", not "Add to my list").
2. One idea per sentence. Short words. Say what happens next ("Press Start when you are ready.").
3. No jargon: no "payload", "token", "endpoint", "hash", "bridge". Say what the person sees.
4. A question is asked of the organizer in the third person ("Who calls the numbers?"), and every answer starts with "You" or "The game".
5. Keep the owner's approved texts word for word (the ID-invite text, the start and number wording below).
6. A test (`apps/web/test/console-voice.test.ts`) fails if the new screens contain "I", "my", "me" or "myself"; the older screens may only improve.

**Approved wording, start and numbers**
- "The game starts by itself" / "The game begins at the time you set. You do nothing."
- "You start the game" / "The game waits for you. Press Start when you are ready."
- (Tambola and Bingo) "Numbers come by themselves" / "A new random number appears every 12 seconds."
- (Tambola and Bingo) "You call the numbers" / "Press Next whenever you want a new random number."
- Values stay: start auto / manual, call auto / host.

**Ten before and after**
| Before | After |
|---|---|
| Add to my list | Add to your list |
| Manual: I'll set each prize myself | Manual: you set each prize yourself |
| My total budget for this game's prizes is | Your total budget for this game's prizes is |
| I start it | You start the game |
| I call the numbers | You call the numbers |
| Each person I invite can bring family or friends | Each person you invite can bring family or friends |
| 3 people are on my list | 3 people are on your list |
| I press Start: at the start time the game waits | You press Start: at the start time the game waits |
| Auto start / The game starts by itself at the time I set. | The game starts by itself / The game begins at the time you set. You do nothing. |
| A new number comes every 12 seconds, by itself. | A new random number appears every 12 seconds. |
