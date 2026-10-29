# Owner's target architecture (29 Oct 2026, binding) - boss notes

RULE: BEFORE STARTING ANY WORK ON PROJEXA, DISCUSS WITH THE OWNER. Read-only study is allowed. Do not merge, move, migrate or change the Projexa repo (FChecklist/projexa), the Projexa Supabase project (evpckeuxgvahguwsaeul) or projexa-ai.com until the owner has discussed it. Priorities P1..P10 unchanged.

## Eight separate products, each with its own repositories (never merged together)
1. Games: Corporate Tambola, Bingo, Tic Tac Toe, Snakes and Ladders, Luck by Chance, Lucky Draw, master console, home site (domain corporatetambola.com: home., housie., bingo., tictactoe., snakes., luck., ...)
2. Veridian DPDP: dpdp.veridian-aios.com
3. Veridian Townhall: townhall.veridian-aios.com
4. CA/CS project: ca-cs.veridian-aios.com
5. Startup product: startup.rajatsir.com
6. Sumeet project = Projexa: fitout.projexa.com. Fit-outs and projects management, ONLY Sumeet's requirements.
7. Compliance and audit management software: ONLY compliance and audit. Not project, not CRM, not HR, not finance. Split out of the compliance-tracker repo.
8. Facilities and building management software: buildingmanagement.projexa.com (owner wrote 'buildingmanagment': confirm). ONLY facilities and building management. Not project, CRM, HR or finance.

## Four domains
- corporatetambola.com: all games
- projexa.com: small projects, BOQ, building management, facilities, Sumeet project
- veridian-aios.com: dpdp, ca-cs, townhall
- rajatsir.com: startup product

## Payments
ALL payments for every product are taken by IT SERVICES BY RAJAT AGARWAL through Razorpay only (one payment website, one gateway).

## What this changes
- P9 (demerger) = extract each product into its own repo(s) with history; keep old repos until verified.
- P10 (merge DBs/repos into one for Projexa) is ON HOLD: needs the owner's discussion first; it may be replaced by a split (Projexa stays separate; compliance/audit and facilities become separate products).
