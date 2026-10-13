// THE list of everything an organizer can get done, and how each one is done through the AI link. One list, many readers:
// GET /ai/<key>/map prints it (text or JSON), the front door points to it, and a test (apps/edge/test/ai-enablement.test.ts) plays an outside AI and checks
// that every function here is really reachable the way it says, and that the long manual mentions every address used. If a function is added or changed here
// and not in the software (or the other way round), a test fails: this ends the drift where the manual said something the software no longer did.
//
// who:  ai       the AI does it by itself, through the address in `call` (or the step link in `go`)
//       handover the AI prepares everything and gives the organizer a link that opens the exact confirm screen: ONE tap by the organizer (publish, erase, pause, stop)
//       human    only the organizer, never the AI (payment, guest names and numbers, sign-in)

export type Who = "ai" | "handover" | "human";
export interface Fn {
  id: string; name: string; who: Who; what: string;
  /** METHOD path under the key, e.g. "PATCH z/{id}/settings". */
  call?: string; body?: string;
  /** A step link under the key (the guided path), e.g. "go/new". */
  go?: string;
  /** The console address (under the site, not the key) the organizer is taken to for a hand-over or a human step. */
  console?: string;
  /** What to tell the organizer. */
  say: string;
}

export const FUNCTIONS: Fn[] = [
  { id: "facts", name: "Answer questions about the software", who: "ai", what: "Safety, privacy, law, cost, what the software does.", go: "facts", call: "GET facts", say: "Answer ONLY from the 10 facts; say \"I do not know that\" for anything else." },
  { id: "demo", name: "Try a free demo", who: "human", what: "A real board and a short practice game of about a minute; one button, nothing to type.", console: "/demo.html", say: "Give the organizer the demo link; they press Run Demo themselves." },
  { id: "new-game", name: "Start a new game", who: "ai", what: "Pick day, time, occasion, size, who can join, prizes; then save a draft.", go: "go/new", call: "POST z", body: "{id, startRound, callSeconds, cap, ...}", say: "Nothing is saved until the organizer says yes to the read-back." },
  { id: "list-games", name: "List my games", who: "ai", what: "Games not yet started, with their code, start time and head-count.", go: "go/games", call: "GET history", say: "Show only games that have not started when the organizer wants to change something." },
  { id: "read-game", name: "Read one game back", who: "ai", what: "Everything saved, the links, and what is left to do.", go: "go/game?id={id}", call: "GET z/{id}/summary", say: "Read the summary back after every change." },
  { id: "change-time", name: "Change the day or time", who: "ai", what: "At most 30 days ahead for a game that is not paid, or any date within 365 days of the payment for a paid game, and before the game starts (an unpaid game can still be moved until its guest data is erased). The tournament itself begins when the Organizer or a Host presses Start.", go: "go/gtime?id={id}", call: "PATCH z/{id}/settings", body: "{startRound}", say: "Turn a date and time into startRound with GET z/schedule?at=<ISO time with +05:30>." },
  { id: "size-speed", name: "Change the people limit", who: "ai", what: "Limit of players (the price follows the size).", call: "PATCH z/{id}/settings", body: "{cap?}", say: "Prices come from the price list; never type a price yourself. After payment the limit cannot go above the paid size." },
  { id: "format-clock", name: "Format and move clock", who: "human", what: "One against one or team against team (teams of 3 or 5), and a move clock of 10, 20, 30 or 60 seconds. The Organizer or a Host chooses them on the tournament page when they press Start.", console: "/host.html?e={id}", say: "Tell the organizer to open Run the tournament in the console and choose the format and the move clock there. You cannot set them." },
  { id: "prizes", name: "Prizes", who: "ai", what: "Which places to reward (first to fifth) and what each prize is. Every place has exactly one winner.", call: "PATCH z/{id}/settings", body: "{rewards: [{pattern, ordinal: 1, text}]}", say: "Send the COMPLETE list each time; it replaces what was saved." },
  { id: "brand", name: "Your brand", who: "ai", what: "The company name (1 to 40 characters), a colour from the list and a small logo, shown at the top of every player's page and on the big screen.", call: "PATCH z/{id}/settings", body: "{brand: {name, color, logo?}}", say: "The colours to choose from are in the manual (choices.brand_colors)." },
  { id: "invites", name: "Open or invite-only, and guest invitations", who: "ai", what: "Anyone with the link, or only people on a list (whoCanJoin); each guest may invite 1 to 10 (a Co-host lists 10 to 1000, default 100). The people lists themselves are the owner's, in the console.", call: "PATCH z/{id}/settings", body: "{whoCanJoin?: \"list\"|\"anyone\", closed?, invites?: {on, per, cats}, coHostLimit?}", say: "Guest kinds are listed in section 1 of the long manual." },
  { id: "guest-list", name: "Load the guest list (names and mobile numbers)", who: "human", what: "Only the organizer, in the console. Names and numbers never pass through an AI.", console: "/zc.html?e={id}", say: "Tell the organizer kindly that this one is theirs, and give the console link." },
  { id: "reuse-list", name: "Reuse an earlier list", who: "ai", what: "Copies the people of an earlier game of the same organizer, while that list still exists (guest data is erased 23 hours after each game).", call: "POST z/{id}/reuse", body: "{from}", say: "Works only for a very recent game." },
  { id: "publish", name: "Publish (free)", who: "handover", what: "The organizer confirms their own e-mail and mobile number and presses Publish. The AI brings them to that screen.", call: "POST z/{id}/publish", console: "/zc.html?e={id}&do=publish", say: "Give the hand-over link: one tap. Tell them what happens next: the guest link and pay link arrive by e-mail." },
  { id: "pay", name: "Pay", who: "human", what: "Only the organizer, a Host or a Co-host, at any time until the guest data is erased (a late payment starts the game 2 minutes after it is confirmed); credit from a cancelled game pays first. The AI never pays and cannot make a pay link anyone can open (POST z/{id}/paylink answers 403): the owner makes that in the console, and it works for 7 days or until the game is paid.", console: "/pay.html?e={id}", say: "Give the pay link, the start time (startsAt) and the last moment to pay (payUntil in the summary)." },
  { id: "links", name: "Show the links", who: "ai", what: "Console, guest link, big-screen link, pay link, test page.", go: "go/links?id={id}", call: "GET z/{id}/summary", say: "The guest link and big-screen link exist only after publishing." },
  { id: "helpers", name: "Hosts and Co-hosts", who: "human", what: "A Host (up to 5) looks after the game with the Organizer: game, prizes, guest invites, game day. A Host cannot change the account or add a Host. A Host needs a name and an e-mail address or a mobile number (at least one); on first opening their personal link the Host confirms an e-mail and adds a mobile number, and later signs in with an e-mail code or Google. A Co-host (no limit) needs a name and a mobile number only. Only the owner enters those, in the console under Your team: the AI cannot add a Host or a Co-host, send a Host's link or touch sign-in.", say: "Tell the organizer to add Hosts and Co-hosts in the console, under Your team. Never ask them for a mobile number or an e-mail address in the chat." },
  { id: "people", name: "Guest lists, personal links, waiting room, removing people", who: "human", what: "Every inviter (Organizer, Host, Co-host, a guest) has one list of names and mobile numbers, and each person on it gets a personal link. People on no list wait for approval. All of it holds names and numbers, so it is the owner's, in the console (My people): the AI gets 403 on every people and waiting route. The AI can only set who can join (whoCanJoin), the guest invite limit and the Co-host limit.", say: "Tell the organizer to open My people in the console to add, send links, remove or approve people. You never see or handle names or numbers." },
  { id: "cancel", name: "Cancel a game", who: "human", what: "Only the Organizer or a Host, in the console, with three confirmations. We do not give refunds: before the start time a paid game that is cancelled becomes credit for the next game for 365 days (unused credit lapses at the end of day 365); once the start time has passed a paid game cannot be cancelled. The AI never cancels.", console: "/zc.html?e={id}", say: "Tell the organizer where to find Cancel this game in the console. Never cancel for them." },
  { id: "credit", name: "Use credit from a cancelled game", who: "human", what: "Credit from a cancelled paid game pays for the next game (oldest first; the rest is paid at checkout). The Organizer, a Host or the game's Co-host taps Use my credit on the Pay step. The AI never pays and never sees credit.", console: "/zc.html?e={id}", say: "If the owner mentions credit, tell them to tap Use my credit on the Pay step. Never promise a refund: we do not give refunds." },
  { id: "clone", name: "Create a new game like this one", who: "human", what: "Only the Organizer or a Host, in the console: a new draft with the same settings (prizes, brand, invites). The date and time are chosen again; nothing is paid or published, and the guests are not copied unless the owner ticks the box.", console: "/zc.html?e={id}", say: "Tell the owner about the Create a new game like this one button. The AI cannot do it." },
  { id: "announce", name: "Message every guest", who: "ai", what: "Up to 160 characters, spoken and shown on every phone and the big screen; published games only; one every 5 seconds.", go: "go/say?id={id}", call: "POST z/{id}/announce", body: "{text}", say: "Ask before sending; keep it short and kind." },
  { id: "who-joined", name: "Who has joined", who: "ai", what: "Head-count and seat numbers; never names or mobile numbers.", go: "go/who?id={id}", call: "GET z/{id}/participants", say: "Report counts only." },
  { id: "mark-seat", name: "Mark Organizer, Host or Co-host seats; change of phone", who: "handover", what: "By seat number. The AI cannot find a person's seat from a name; the organizer reads the number in the console.", call: "POST z/{id}/mark | POST z/{id}/unbind", body: "{seat, role} | {seat}", console: "/zc.html?e={id}", say: "Ask for the seat number, or send the organizer to the console." },
  { id: "pause-stop", name: "Pause, resume or stop a running game", who: "handover", what: "The AI asks; the organizer approves with one tap in their own console.", call: "POST z/{id}/control/request", body: "{action: pause|resume|stop, note}", console: "/zc.html?e={id}&do=pause", say: "Give the hand-over link; the organizer presses the button." },
  { id: "results", name: "Results and prizes", who: "ai", what: "Winners by seat number and whether each prize was handed over.", call: "GET z/{id}/results | GET z/{id}/prizes", say: "Winners are shown as seat numbers; names stay in the console." },
  { id: "prize-given", name: "Tick a prize as handed over", who: "ai", what: "Records that a prize was given, with the date.", call: "POST z/{id}/prizegiven", body: "{round, pattern, ordinal, seat, given}", say: "Copy the values from the prizes list." },
  { id: "report", name: "The report after the game", who: "ai", what: "Status only: it is e-mailed to the organizer about 3 minutes after the game ends and opens for 22 hours.", call: "GET z/{id}/reportlink", say: "Remind the organizer to save the report within 22 hours; it holds guest data that is erased at 23 hours." },
  { id: "erase", name: "Erase all guest data now", who: "handover", what: "The AI asks; the organizer confirms in their console.", call: "POST z/{id}/control/request", body: "{action: erase, note}", console: "/zc.html?e={id}&do=erase", say: "Give the hand-over link; the organizer presses Confirm." },
  { id: "audit", name: "What the AI did", who: "ai", what: "Every call made with an AI link, readable by the organizer.", call: "GET org/ai/audit", say: "The organizer can always see this in their console." },
  { id: "ideas", name: "Suggest a feature", who: "ai", what: "A shared ideas board; no names or numbers.", call: "POST z/suggestions", body: "{kind, title, body}", say: "Describe the need, not code." },
  { id: "sign-in", name: "Sign in, keys, close the account", who: "human", what: "Always the organizer's own act.", console: "/zc.html", say: "Never ask for a code or a password." },
];

export const WHO_WORDS: Record<Who, string> = { ai: "you do it", handover: "you prepare it, the organizer taps ONCE to confirm", human: "only the organizer (never you)" };

const fill = (s: string, base: string, origin: string) => s.replace(/\{id\}/g, "{id}");

/** The map as text: every function, who does it, and the address. `base` is the keyed address; `origin` the site. */
export function mapText(base: string, origin: string): string {
  const L: string[] = ["EVERYTHING YOU CAN GET DONE FOR THE ORGANIZER (this list is complete; if it is not here, do not try it)", `Base address: ${base}`, "Replace {id} with the game code (GET " + base + "/history lists them).", ""];
  for (const f of FUNCTIONS) {
    L.push(`- ${f.name} [${WHO_WORDS[f.who]}]`, `    ${f.what}`);
    if (f.go) L.push(`    Step link: ${base}/${fill(f.go, base, origin)}`);
    if (f.call) L.push(`    Call: ${f.call.replace(/^(GET|POST|PATCH)( |$)/, (m) => m)}${f.body ? "  Body: " + f.body : ""}`);
    if (f.console) L.push(`    Organizer's page: ${/^https?:/.test(f.console) ? f.console : origin + f.console}`);
    L.push(`    Say: ${f.say}`);
  }
  return L.join("\n");
}
export const mapJson = (base: string, origin: string) => ({ base, functions: FUNCTIONS.map((f) => ({ ...f, go: f.go ? `${base}/${f.go}` : undefined, console: f.console ? (/^https?:/.test(f.console) ? f.console : origin + f.console) : undefined, who_means: WHO_WORDS[f.who] })) });
