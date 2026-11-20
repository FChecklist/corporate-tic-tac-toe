# Suite rules version 1.1, 20 Nov 2026

`suiteRulesVersion: 1.1`

This repo: **tictactoe** (game site (play)). This is a copy of the owner's rules relevant here. Docs only: it changes no behaviour.

**Where the source is:** C:\ct\marketing-ledger\plans\SUITE-RULES-VERSION-2026-11-20.md (also in FChecklist marketing-ledger on GitHub, plans/, commit 3246082), with ID-INVITE-AND-ARCHITECTURE-RULES-2026-11-20.md (v1.0). If this copy and the ledger differ, the ledger wins; bump the number on every owner rule change.

## 1. Architecture (owner, decided)
- 1 login: home.corporatetambola.com (single gate for organizer, host, anyone who logs in). No game or page has its own login; if one exists it is hidden or redirected. Players joining by code/link are not "logged in".
- 1 console for ALL games: console.corporatetambola.com. Organizer/host only. One website, one set of rules.
- 1 credit and payment system: moneypenny.corporatetambola.com.
- 1 chatbot system: moneypennychat.corporatetambola.com. AI uses only the limited key cta_, never the organizer key ctk_; AI never self-confirms irreversible steps.
- All systems independent, joined by API. Console = set up, invite, pay, approve, monitor. Game = play, each with its own website and rules. Settings flow console -> game by API; a game keeps no copy of rules.
- **No own login, no own payment, no own chat in a game or the console. Pay only via Moneypenny.**

## 2. Invite by ID only
- ID = ONE alphanumeric field (employee, associate, vendor, customer ID are the same thing). No choice menu. No names, mobile or personal details.
- Organizer/host uploads or pastes IDs, one per line. A unique game link is generated. Invitee opens it and enters their ID: on the list = joins and plays; not on the list = organizer/host approves or declines.
- Family invite (optional): a listed person may invite up to 4 more with approval. Only organizer/host see the full list, the invite chain and the log.
- Normalisation: strip every non-alphanumeric character, uppercase (A-1101, A 1101, A/1101 = A1101) at upload, join, approval and matching.
- No one is admitted without approval if not on the list; hide "Anyone with the link" audiences.
- **Deletion: the list and all IDs are deleted within 24 hours after the game ends.**
- Screen text (verbatim): "Invite people with just an ID / No names or personal details are needed. / Just upload or paste the IDs of the people you want to invite: employee ID, associate ID, vendor ID or customer ID, whichever you use. / Your invitee opens the game link and enters their ID. If it is on your list, they join and play. If it is not, you get a request to approve or decline. / The list and all IDs are deleted within 24 hours after the game ends."

## 3. Payment chain and seamless rule
- Chain: home -> console -> moneypenny -> IT Services by Rajat Agarwal -> Razorpay.
- Moneypenny credits are bought through IT Services/Razorpay; Moneypenny updates credits and then THE SPECIFIC GAME, which becomes PAID. The game starts only when paid.
- Console and every game call ONLY Moneypenny, never IT Services or Razorpay directly. Moneypenny is the single gate.
- SEAMLESS: organizer, host and payee never see the backend and never leave console.corporatetambola.com. Cost, balance, Buy now, Pay, "Paid" and the payee pay link are console screens; the card/UPI window opens as an overlay on the console and returns to the same screen. Error text never names Moneypenny, IT Services or the API.
- Payee pay link: console page, no login, shows only the amount due; money goes to the ORGANIZER's Moneypenny account and is auto-applied to that game.
- Pay step is step 6, last, one shared flow for all six games: "Game only starts when you pay"; cost in credits, existing credits, "you only need to buy N credits to start the game", Buy now, Copy payment link, "You don't have to buy software or a subscription or download anything. You only pay per game. Simple and easy."
- Open owner decision: when short of credits, smallest listed pack that covers it (recommended) or exact credits.
- Deploy: Cloudflare only, no Vercel. Nothing is deployed from this docs change.

## 4. Voice and wording
- Console voice: "you", polite, simple English, never "I", not threatening; audience = organizer/host (cautious HR people). In the game the audience is the players.
- Privacy line: "designed to follow US privacy laws, EU GDPR and India's DPDP"; all participant information including IDs deleted within 24 hours after the game. Billing: the only sentence is "We keep billing data for audit and tax reasons." Never "forever".
- Prizes: "You (the company) give the prizes directly to the winners." Never "we never hold or pay prize money".
- Fairness: "No one knows the next number: not the organizer, not the host, not even the software."
- Prices use the rupee sign.
- Tagline: "Every ticket on the player's own phone, nothing to install. Each ticket is unique."

## 5. What not to claim
- Do not state "100% secure", "most secure gateway", "played by major companies" (no proof), or "PDF of all details by e-mail" until built and checked. Ask the owner before adding.
- Do not send the marketing PDF to a prospect until ID-invite/approval/family and 365-day deletion lines are live or softened.
