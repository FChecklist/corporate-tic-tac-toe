/* The guide: when something does not work, the person is never left with a bare error.
   They get (1) a polite, complete explanation, (2) the exact steps to put it right, (3) a button that takes them to the exact place (a field, a step, a page),
   and (4) a way back to where they were working. Nothing here changes a rule: the server still decides; this only explains and guides.
   No technical words are ever shown (no codes, no addresses, no JSON). The error is also recorded for the owner (blackbox.js), with a reference the person can quote.
   How each kind is shown:
     "field"      a mistake in something the person typed or chose -> shown right at that field, which is brought into view, outlined and focused (no pop-up)
     "blocked"    the person cannot go on from here (full game, cancelled game, ticket on another phone, sign-in needed) -> a pop-up with the way forward
     "wait"       nothing is wrong, it only needs a little time (busy, too many tries, payment being confirmed) -> a pop-up that says nothing is lost, with Try again
     "unexpected" something failed on our side -> a pop-up that apologises, says the work is safe, offers Try again and a WhatsApp message with the reference */
(function () {
  if (window.CTG) return;
  var CTG = (window.CTG = {});
  var WA = "919650397480";

  /* ---------------------------------------------------------------------------------------------------------------------------------
     The catalog. m = fragments of the server's message (any one, ignoring case and the numbers inside); s = statuses it applies to (empty = any).
     t = a short polite title; w = what happened in plain words; d = what to do, one short step each; g = where to go; k = kind.
     g: {step:N, field:"#id", label:"..."}  a step of the Organizer console (and a control in it)
        {href:"/path", label:"..."}          another page (the person is brought back afterwards)
        {retry:true}                         the same action again
        {none:true}                          nothing to go to: reading is enough
     Messages meant for the owner's own tools or for AI links (never on a person's screen) are listed in API_ONLY below and need no guide. */
  var C = [
    // ---------- sign in, e-mail, codes ----------
    { m: ["Please enter a valid work email", "Please enter a valid e-mail address", "Enter a valid e-mail address", "Please confirm a valid email address", "That e-mail address does not look right", "Enter the Organizer's e-mail address", "Enter the e-mail address you joined", "Enter a valid e-mail", "Please enter a valid work e-mail", "Please confirm a valid e-mail address"], k: "field", t: "Please check the e-mail address",
      w: "The e-mail address is missing or has a typing slip, so we cannot send you the code or link.", d: ["Type the full address: the part before the @ sign, the @ sign, and the part after it.", "Check there are no spaces and the @ sign is there.", "Then try again."], g: { field: 'input[type="email"], #pubEmail, #hemail, #email', label: "the e-mail box" } },
    { m: ["Enter the Organizer's e-mail address, not your own"], k: "field", t: "That is your own e-mail address",
      w: "This invitation is for the Organizer, so it needs the Organizer's address, not yours.", d: ["Ask the Organizer for the e-mail address they use for Corporate Tic Tac Toe.", "Type it in the box and send again."], g: { field: 'input[type="email"], #hemail', label: "the e-mail box" } },
    { m: ["That is not the e-mail address you joined Refer & earn with", "This invitation was sent to a different e-mail address", "This link is for"], k: "blocked", t: "This needs the e-mail address it was sent to",
      w: "For your safety this link works only with the e-mail address it was made for.", d: ["Sign in with the e-mail address that received the message.", "If you are not sure which one it was, ask the person who sent it to resend it to the address you want to use."], g: { href: "/#login", label: "Sign in" } },
    { m: ["That code is not right or has expired", "Enter the 6-digit code"], k: "field", t: "That code did not work",
      w: "The 6-digit code was typed differently from the one we sent, or it is more than a few minutes old.", d: ["Open the newest e-mail from us and type its 6 digits again.", "If it is old, press Send me a new code and use the newest e-mail only."], g: { field: "#code, input[inputmode=numeric], input[autocomplete=one-time-code]", label: "the code box" } },
    { m: ["This sign-in link is not valid any more"], k: "blocked", t: "This sign-in link has been used or has expired",
      w: "Each sign-in link works once and for a short time, for your safety.", d: ["Go to the sign-in page and ask for a new link or code.", "Use the newest e-mail we send you."], g: { href: "/#login", label: "Get a new sign-in link" } },
    { m: ["There is no account for this Google e-mail yet"], k: "blocked", t: "We do not have an account for this Google address yet",
      w: "Signing in needs an account first.", d: ["Choose Sign up to make your account with this address.", "Then come back and sign in."], g: { href: "/#login", label: "Sign up" } },
    { m: ["Too many codes requested"], s: [429], k: "wait", t: "Please give it a little time",
      w: "Several codes were asked for in a short time, so we paused new ones to keep your account safe.", d: ["Use the newest code in your e-mail.", "If it has not arrived, check the spam folder, or try again in an hour."], g: { retry: true } },
    { m: ["Too many tries from this network", "Too many new games from this network", "Too many new engagements from this network", "Too many payment attempts from this network", "Too many tries from this network today"], s: [429], k: "wait", t: "Please try again a little later",
      w: "Many tries came from this internet connection in a short time, so we paused it to keep everyone safe. Nothing you did is lost.", d: ["Wait a few minutes, or try again tomorrow if it says so.", "You can also switch from Wi-Fi to your phone's data and try again."], g: { retry: true } },
    { m: ["You already asked for several fresh links today"], k: "wait", t: "You already have a fresh link",
      w: "We limit new links in a day for your safety.", d: ["Open the latest e-mail we sent you and use that link.", "Or press Replace my AI link if that is what you need."], g: { none: true } },
    { m: ["Please sign in first", "Please sign in again", "Please sign in, or open your ticket link first", "Please sign in, or open your personal link first", "Please sign in, or open your card link first", "Please sign in, or open your game link first"], k: "blocked", t: "Please sign in to continue",
      w: "We need to know it is you before we go on. Your work on this screen is kept.", d: ["Press Sign in and use your work e-mail.", "We will bring you straight back to this place."], g: { href: "/#login", label: "Sign in" } },
    { m: ["Say whether you are signing up, signing in or finishing a Host setup"], k: "unexpected", t: "That sign-in could not start", w: "Something unexpected stopped the sign-in from starting.", d: ["Please open the sign-in page again.", "If it happens again, message us and we will help."], g: { href: "/#login", label: "Open sign-in" } },
    // ---------- start time and dates ----------
    { m: ["Check the start time", "Pick a start time in the future", "That time has already passed", "The start time has passed or has not been chosen", "Please choose a start time in the future", "Pick the date and time of this game first"], k: "field", t: "Please choose a start time that is still ahead",
      w: "The game needs a date and time that has not passed yet. At least two hours ahead gives your people time to join.", d: ["Open Date and time.", "Pick the day, then the time.", "Press Save and continue."], g: { step: 1, field: "#f-timeo", label: "Date and time" } },
    { m: ["can be set at most 30 days ahead"], k: "field", t: "That date is too far ahead for now",
      w: "A game that is not paid yet can be set up to 30 days ahead. After you pay, it can be moved up to a year.", d: ["Pick a day within the next 30 days.", "Or pay first, then move the date."], g: { step: 1, field: "#f-timeo", label: "Date and time" } },
    { m: ["Give a date and time with a time zone"], k: "unexpected", t: "That time was not clear", w: "The date and time need a time zone, such as India time, so the game starts at the right hour.", d: ["Please pick the date and time again from the calendar."], g: { step: 1, field: "#f-timeo", label: "Date and time" } },
    // ---------- size, pack, people ----------
    { m: ["That many participants needs a custom arrangement"], k: "blocked", t: "That is bigger than our standard packs", w: "Our standard packs go up to 10,000 people. For a bigger game we make a special arrangement.", d: ["Press Message us and tell us how many people you expect.", "Or choose 10,000 or fewer."], g: { wa: true, step: 2, field: "#f-cap", label: "Number of participants" } },
    { m: ["Your pack allows up to", "Buy a bigger pack to raise the limit"], k: "blocked", t: "Your pack is smaller than this number", w: "The number of participants is more than the pack you bought allows.", d: ["Either lower the number of participants,", "or pay for the bigger pack. Credit from an earlier game is counted."], g: { step: 2, field: "#f-cap", label: "Number of participants" } },
    { m: ["The limit cannot be lower than the people already on the list"], k: "field", t: "There are already more people on your list", w: "The number of participants cannot be lower than the people already added.", d: ["Type a number that is at least the size of your list,", "or remove some people from the list first."], g: { step: 2, field: "#f-cap", label: "Number of participants" } },
    { m: ["This game is for", "and all places are taken", "This engagement is full", "Your list is full"], k: "blocked", t: "All the places in this game are taken", w: "The number of people this game was made for has been reached, so no more can be added.", d: ["If you are the Organizer, raise the number in Number of participants (a bigger pack may be needed).", "If you are a guest, please ask the Organizer to make room."], g: { step: 2, field: "#f-cap", label: "Number of participants" } },
    { m: ["Pick an earlier engagement", "That engagement's people list has already been deleted", "This engagement is smaller than the earlier roster"], k: "blocked", t: "That earlier list cannot be used", w: "Names and numbers are deleted within 24 hours after a game, as promised, so an old list may be gone or too big for this game.", d: ["Add your people again in Invite and share links.", "Use Paste or upload to add them in one go."], g: { step: 6, label: "Invite and share links" } },
    { m: ["Send at least one person", "people at a time; the console sends a bigger list", "Send between 1 and 100 people at a time"], k: "field", t: "Please add at least one person", w: "The list was empty, or it was longer than one go allows.", d: ["Type one name and mobile number per line.", "Press Add. A long list is added in parts automatically."], g: { step: 6, label: "Invite and share links" } },
    { m: ["That number is already invited"], k: "field", t: "That number is already on your list", w: "Each mobile number is on a game once, so nobody gets two tickets.", d: ["Nothing more to do for this number.", "If it is a different person, check the digits."], g: { none: true } },
    { m: ["They have already joined with their first number", "They have already joined with their first mobile number", "That number was removed from this game", "That person was removed. Add them again first", "Add it back from My people first"], k: "blocked", t: "This needs one small step first", w: "A person who has joined keeps the number they joined with, and a removed number must be added back before it can be used.", d: ["Open My people and find the person.", "Add them back if they were removed, then send the link again."], g: { step: 6, label: "My people" } },
    { m: ["Once the game has started only the Organizer or a Host", "Only the Organizer and Hosts can download a list"], k: "blocked", t: "Only the Organizer or a Host can do that now", w: "After a game starts, changes to who is in it are limited to the Organizer and Hosts, so the game stays fair.", d: ["Please ask the Organizer or a Host to do it for you."], g: { none: true } },
    { m: ["That is a team member's own seat"], k: "blocked", t: "That seat belongs to a team member", w: "A Host or Co-host has their own seat that goes with their role.", d: ["Open Make hosts and co-hosts.", "Retire the team member there if they should no longer take part."], g: { step: 5, label: "Make hosts and co-hosts" } },
    { m: ["The game has ended, so no one can be added", "The game has ended, so this request has lapsed", "The game has ended, so these requests have lapsed"], k: "blocked", t: "This game has already ended", w: "People cannot be added or admitted after a game ends.", d: ["You can make a new game like this one in one tap from the home screen."], g: { href: "/zc.html", label: "Go to my games" } },
    { m: ["The game is running. Please delete this person after it ends"], k: "blocked", t: "Please do that after the game", w: "To keep the game fair, a person cannot be deleted while it is running.", d: ["Wait for the game to end, then delete their data from After the game."], g: { step: 10, label: "After the game" } },
    // ---------- brand and hosts ----------
    { m: ["Please give your mobile number", "Enter a valid mobile number", "Please enter a valid mobile number", "That mobile number does not look right", "Please confirm a valid mobile number", "We need your mobile number to make your play link"], k: "field", t: "Please check the mobile number",
      w: "A mobile number is needed here, and the one given has a digit missing or extra.", d: ["Type the 10-digit mobile number without spaces.", "Add the country code only if the person is outside India."], g: { field: "#ph, #hostphone, #cohostphone, #pubPhone, #pdph, input[type=tel]", label: "the mobile number box" } },
    { m: ["Choose which game this Co-host is for", "A Co-host needs a name and a mobile number"], k: "field", t: "A Co-host needs a name and a game", w: "To make the Co-host's link we need their name, their mobile number and the game they help with.", d: ["Type the name and mobile number.", "Then press Add a Co-host."], g: { step: 5, field: "#cohostlabel", label: "Name of the new Co-host" } },
    { m: ["A Host needs a mobile number or an e-mail address", "Only the owner sends a Host's link", "Only the owner enters those"], k: "blocked", t: "Only the Organizer can do this, in the console", w: "For safety, Host and Co-host details are entered only by the Organizer in their own console.", d: ["Please ask the Organizer to open Make hosts and co-hosts and add the person there."], g: { none: true } },
    { m: ["Hosts at a time. Retire one first", "clients at a time"], k: "blocked", t: "You have reached the number of Hosts allowed", w: "A game has a limit on Hosts so the team stays easy to manage.", d: ["Open Make hosts and co-hosts.", "Retire a Host you no longer need, then add the new one."], g: { step: 5, label: "Make hosts and co-hosts" } },
    { m: ["This Host has already finished setup", "Your e-mail is already confirmed", "Your mobile number is already saved"], k: "blocked", t: "That part is already done", w: "This Host's setup is complete, so it cannot be done again from the setup link.", d: ["Sign in with the e-mail address you confirmed.", "If you cannot get in, ask the Organizer to retire you and add you again."], g: { href: "/#login", label: "Sign in" } },
    { m: ["That person is not on your team", "Pick a Host from the list", "Pick a person from the list"], k: "field", t: "Please choose someone from the list", w: "The person chosen is not on your team any more.", d: ["Open Make hosts and co-hosts and pick again."], g: { step: 5, label: "Make hosts and co-hosts" } },
    { m: ["Pick a key from the list", "That is the key you are using right now"], k: "field", t: "Please pick a different AI link", w: "That link is the one you are using right now.", d: ["Choose another from the list, or sign in with another link first."], g: { none: true } },
    // ---------- participants joining ----------
    { m: ["This engagement is by invitation", "Guests invited by a guest can play but cannot invite more people", "The organizer has not switched on guest invitations", "Your team seat invites through the console"], k: "blocked", t: "This game is by invitation", w: "The Organizer decides who can take part, and your number is not on the list yet.", d: ["Please ask the Organizer (or the person who invited you) to add your mobile number.", "Then open your link again."], g: { none: true } },
    { m: ["This invitation has already been used by"], k: "blocked", t: "This invitation link has reached its limit", w: "One person can bring only a set number of guests, and that number has been reached.", d: ["Please ask the Organizer to add you directly, or to send you a link of your own."], g: { none: true } },
    { m: ["This phone already holds a ticket in this engagement", "This phone already has a board in this game", "This phone already holds a card in this", "This phone already holds a place in this", "This phone already holds a seat in this"], k: "blocked", t: "This phone already has a ticket", w: "To keep the game fair, one phone holds one ticket.", d: ["Open the game again on this phone to find your ticket.", "If it is for another person, ask them to open the link on their own phone."], g: { none: true } },
    { m: ["This link was already opened on another phone", "This ticket is already on another phone", "This card is already on another phone", "This place is already on another phone"], k: "blocked", t: "This ticket is already on another phone", w: "A ticket plays on one phone only, for fairness.", d: ["If you are the same person on a new phone, ask whoever invited you to send the link again.", "If you are someone else, type your own mobile number to ask to join."], g: { none: true } },
    { m: ["You were removed from this game", "You were removed from this game by the organizer"], k: "blocked", t: "You are not part of this game any more", w: "The Organizer removed this ticket from the game.", d: ["If you think this is a mistake, please ask the Organizer to add you back."], g: { none: true } },
    { m: ["This link is not valid any more. Please ask the person who invited you", "This engagement is not open yet", "The game is not published yet", "Publish the engagement first"], k: "blocked", t: "This game is not open yet, or the link is old", w: "Either the Organizer has not published the game yet, or the link was replaced by a newer one.", d: ["Please ask the person who invited you to send the latest link.", "If you are the Organizer, publish the game first in Check and publish."], g: { step: 7, label: "Check and publish" } },
    { m: ["That game no longer exists", "This game did not start. Your details have been erased", "This game did not start and is closed", "This game was cancelled", "That game was cancelled", "This game was cancelled by the organizer"], k: "blocked", t: "This game is not going ahead", w: "The game was cancelled, or it did not start and was closed. Names and numbers are erased within a day.", d: ["Nothing more to do here.", "If you are the Organizer, you can make a new game like this one from your games."], g: { href: "/zc.html", label: "Go to my games" } },
    { m: ["Please open this from the phone that holds", "This is not the phone that holds this", "Your ticket link is the one you were sent", "Not a participant of this game", "Not a participant of this engagement"], k: "blocked", t: "Please use the phone that holds your ticket", w: "For privacy, only the phone that holds a ticket can ask about it or change it.", d: ["Open your ticket link on the same phone you joined with."], g: { none: true } },
    { m: ["Many people are waiting for an answer right now", "This game could not add you"], k: "wait", t: "Please try once more in a little while", w: "Many people are asking to join at once. Your request is safe.", d: ["Wait a minute, then press Try again.", "If it still does not work, tell the person who invited you."], g: { retry: true } },
    { m: ["Please refresh this page and try again", "Please tap Allow to agree", "Please tick the box to continue", "Please tick the box to join", "Please agree to join Refer & earn"], k: "field", t: "One box needs ticking first", w: "We need your agreement before we can go on, as the law asks.", d: ["Tick the box next to the line that explains it.", "Then press the button again."], g: { field: 'input[type="checkbox"]', label: "the tick box" } },
    { m: ["Your game link is the one you were sent", "Your card link is the one you were sent"], k: "blocked", t: "Please use the link you were sent", w: "Your own link is the one that opens your place in the game.", d: ["Open the message you were sent and tap the link in it."], g: { none: true } },
    { m: ["No prize recorded for this board"], k: "blocked", t: "No prize has been recorded for that ticket", w: "A prize only appears once the game has recorded it.", d: ["Check the ticket number, or look at the list of winners again."], g: { none: true } },
    { m: ["Please type your name"], k: "field", t: "Please type your name", w: "We need a name so the game can show who you are.", d: ["Type your name in the box, then continue."], g: { field: "input" } },
    { m: ["Sign-up for this game has closed"], k: "blocked", t: "This game has already started", w: "New players can only join before the game begins.", d: ["Ask the Organizer if they can add you for the next game."], g: { none: true } },
    { m: ["Give the card number (or the mobile number)", "Give the seat number (or the mobile number)"], k: "field", t: "Please give a ticket number or a mobile number", w: "We need to know which person you mean, and which role they should have.", d: ["Type the ticket number or mobile number.", "Choose a role from the list, then try again."], g: { none: true } },
    { m: ["Only the Organizer or a Host can", "Only the finalists' phones or the Organizer's page"], k: "blocked", t: "That is for the Organizer or a Host", w: "To keep the game fair, only the Organizer or a Host can do this.", d: ["Ask the Organizer or a Host to do it.", "If you are the Organizer, sign in again and open the console."], g: { none: true } },
    { m: ["You are not in this game", "You are not in this match", "Open the game link on your own phone", "This place is on another phone"], k: "blocked", t: "This place is not on this phone", w: "Each player plays from the phone they joined with.", d: ["Open the link you were sent on your own phone.", "If you have not joined, ask the Organizer for a link."], g: { none: true } },
    { m: ["The tournament has already started.", "The tournament has started and the list is closed.", "The tournament has not started.", "The tournament is not running.", "The final is not finished.", "The two earlier matches are not finished yet.", "That match is not open yet.", "This board is finished.", "The host paused the game."], k: "blocked", t: "That cannot be done right now", w: "The game is not at the stage where this is possible. Nothing is lost.", d: ["Wait a moment and look at the screen again.", "If it stays the same, ask the Organizer."], g: { none: true } },
    { m: ["A move clock is", "A team has 3 or 5 players", "Too many players", "Pick a square on the board", "The winner must be one of the two players"], k: "field", t: "Please check what you chose", w: "That choice is not allowed in this game.", d: ["Change it to one of the allowed choices, then try again."], g: { none: true } },
    { m: ["Bad draw.", "Bad match.", "Bad match in the draw.", "Bad move.", "Bad result.", "The draw is not complete.", "A team lists someone who did not join", "A board lists someone who did not join", "A match needs the two matches it comes from", "No such board."], k: "unexpected", t: "That did not go through", w: "The game could not use what was sent. This is not your doing, and nothing is lost.", d: ["Look at the screen again, then try once more."], g: { none: true } },
    { m: ["That match is already registered with other players", "The board changed. Look again"], k: "wait", t: "The board has just changed", w: "Someone else moved first. Nothing is lost.", d: ["Look at the board again, then go on."], g: { none: true } },
    { m: ["is waiting for the organizer's payment"], k: "blocked", t: "This game is waiting for payment", w: "The Organizer has not finished paying yet.", d: ["Please try again once the Organizer has paid."], g: { none: true } },
    { m: ["Pause is available for games of up to"], k: "blocked", t: "Pause is not available for a game this big", w: "Pausing works only for smaller games.", d: ["Carry on with the game, or ask for help from the Help Desk."], g: { none: true } },
    { m: ["No reward recorded for this", "No prize recorded for this"], k: "blocked", t: "No reward has been recorded for that place", w: "A reward only appears once the game has recorded it.", d: ["Check the number, or look at the list of winners again."], g: { none: true } },
    { m: ["That number has not joined this engagement", "That number has not joined yet", "No such person", "No such person on your list", "No such request", "That request is not here any more"], k: "blocked", t: "We could not find that person", w: "The person may have been removed, or the list changed while you were looking.", d: ["Open My people to see the latest list, then try again."], g: { step: 6, label: "My people" } },
    // ---------- payment ----------
    { m: ["Choose a pack", "Enter your name", "That GSTIN does not look right"], k: "field", t: "Please check the payment details", w: "One of the details needed to prepare your payment is missing or has a slip.", d: ["Fill in the highlighted box.", "A GSTIN has 15 characters, like 27ABCDE1234F1Z5. Leave it empty if you do not have one."], g: { field: "#payName, #payGst, #pack, input", label: "the payment details" } },
    { m: ["This engagement is already published", "That game is already published", "This game is already paid for", "Credit already covers this game", "This game is not waiting for payment"], k: "blocked", t: "This game is already taken care of", w: "Payment for this game is already done or covered by your credit.", d: ["Nothing more to pay.", "If your credit covers it, press Use my credit to finish."], g: { step: 8, label: "Pay" } },
    { m: ["A payment for this game is being confirmed", "Your payment is safe", "Online payments are not switched on", "Payments are not switched on yet", "Payments in US dollars are not switched on yet"], k: "wait", t: "Your payment needs a few more minutes", w: "Either your bank is still confirming the payment, or this payment method is not available yet. Nothing is lost, and you are never charged twice.", d: ["Wait about five minutes, then open Pay again.", "If it is the dollar option, please pay in rupees or write to us."], g: { retry: true } },
    { m: ["The payment could not be verified", "The payment details did not match the order", "We could not match this payment", "The payment is", "The payment service said", "Unknown payment"], k: "unexpected", t: "We could not confirm this payment yet", w: "If any money left your account it will be returned by your bank. Nothing is charged to your game until we confirm it.", d: ["Please try the payment once more.", "If money was taken, message us with the reference below and we will check straight away."], g: { retry: true, wa: true } },
    { m: ["Paying is for people to do themselves", "A pay link is for people to make themselves", "A Host's AI assistant cannot pay"], k: "blocked", t: "Payment is done by a person, in the console", w: "For safety, payments are not made by an AI assistant.", d: ["Please ask the owner to open Pay in their console and pay there."], g: { step: 8, label: "Pay" } },
    { m: ["Test payments are only available while the service is in test mode"], k: "blocked", t: "That test payment is not available now", w: "Test payments are only for trying the service out.", d: ["Please use the normal payment in Pay."], g: { step: 8, label: "Pay" } },
    { m: ["This invoice has already been e-mailed 5 times"], k: "blocked", t: "The invoice has already been sent several times", w: "To avoid mail piling up, an invoice can be e-mailed five times.", d: ["Please look in your inbox and spam folder for it.", "You can also download it from Pay."], g: { step: 8, label: "Pay" } },
    // ---------- publish, cancel, account ----------
    { m: ["Please confirm three times to cancel the game", "Please confirm in your console"], k: "field", t: "Please confirm to go on", w: "Cancelling cannot be undone, so we ask you to confirm each step.", d: ["Tick the box and press the confirm button at each step."], g: { step: 7, label: "Cancel this game" } },
    { m: ["A game is running. Close the account after it ends"], k: "blocked", t: "Please close the account after the game", w: "An account cannot be closed while one of its games is running.", d: ["Wait until the game ends, then close the account."], g: { none: true } },
    { m: ["Please finish your setup first"], k: "blocked", t: "Please finish your setup first", w: "Your e-mail address and mobile number are needed before a Host can work.", d: ["Open your setup link and add the missing detail."], g: { href: "/zc.html", label: "Finish setup" } },
    { m: ["unpublished drafts. Publish one"], k: "blocked", t: "You have several drafts waiting", w: "There is a limit on unpublished drafts so the list stays tidy. A draft that is not published is forgotten after 30 days.", d: ["Publish one of your drafts, or let one lapse.", "Then make the new game."], g: { href: "/zc.html", label: "Go to my games" } },
    { m: ["The engagement has already started, so it can no longer be changed", "Pause is available for engagements of up to"], k: "blocked", t: "That can no longer be changed", w: "Once a game has started, its rules are locked so every phone plays the same game.", d: ["If you need changes, make a new game like this one after it ends."], g: { none: true } },
    { m: ["Who can join: choose", "A Co-host can list", "Check the details", "Check the engagement details"], k: "field", t: "One setting needs a look", w: "A choice in the game's settings is missing or outside what is allowed.", d: ["Open Number of participants.", "Check each choice, then Save and continue."], g: { step: 2, field: "#f-cap", label: "Number of participants" } },
    { m: ["Flag your own team before the game begins", "Give the ticket number (or the mobile number) and a role"], k: "blocked", t: "That can only be set before the game starts", w: "The lucky-draw list is the same on every phone, so it cannot change after the start.", d: ["Make the change before the game starts, in Make hosts and co-hosts."], g: { step: 5, label: "Make hosts and co-hosts" } },
    // ---------- brand ----------
    { m: ["Names and mobile numbers are handled by the owner in the console, not by the AI"], k: "blocked", t: "Names and numbers are added by you, not the AI", w: "For privacy, the AI assistant never handles names or mobile numbers.", d: ["Open Invite and share links.", "Paste or upload your list there."], g: { step: 6, label: "Invite and share links" } },
    { m: ["Winners are decided by the software"], k: "blocked", t: "Winners are decided by the software", w: "Nobody can post or change winners. They are found by the software from the public numbers, so every result is fair.", d: ["Nothing to do. The result will appear by itself."], g: { none: true } },
    { m: ["Send a message", "Write the message to send", "A message can be at most 160 characters", "Please wait a few seconds before sending another message"], k: "field", t: "Please check the message", w: "The message is empty, longer than 160 characters, or sent too soon after the last one.", d: ["Write a message of up to 160 characters.", "Wait a few seconds between messages."], g: { step: 9, field: "#annText", label: "Message to your guests" } },
    // ---------- player rights and reports ----------
    { m: ["Please choose what you want", "Please write what should be corrected", "You have already sent several requests for this game"], k: "field", t: "Please tell us what you would like", w: "We need to know whether you want to see your data, correct it, delete it, or name another person.", d: ["Choose one option and, if you are correcting something, write what should change.", "If you have asked several times, please wait for our answer."], g: { none: true } },
    { m: ["This report link is not valid", "This report is not ready"], k: "blocked", t: "This report is not available", w: "The report link has closed (names and numbers are deleted within 24 hours of the game ending, as promised) or it is not ready yet.", d: ["Please use the latest e-mail we sent you, or open the report from Get your report while it is still open."], g: { step: 10, label: "After the game" } },
    { m: ["Please write your name", "Not given: this person was removed", "No reward recorded for this ticket", "No such reward"], k: "field", t: "Please check your details for the reward", w: "We need your name and mobile number to record your reward.", d: ["Write your name and mobile number, then press Send."], g: { none: true } },
    // ---------- partner, helper ----------
    { m: ["Enter a valid mobile number", "Enter a valid e-mail address. We send you a code"], k: "field", t: "Please check your details", w: "A mobile number or e-mail address is missing or has a slip.", d: ["Type them in full and try again."], g: { field: "input", label: "your details" } },
    { m: ["That is enough invitations for this hour"], k: "wait", t: "You have sent enough invitations for this hour", w: "To avoid spamming anyone, invitations are limited each hour.", d: ["Please try again a little later.", "Your other clients are not affected."], g: { none: true } },
    { m: ["That address has had enough invitations today"], k: "wait", t: "That address has had enough invitations today", w: "To avoid spamming anyone, one address is invited only a few times a day.", d: ["Please try again tomorrow.", "Meanwhile, you can tell the person to look in their inbox and spam folder."], g: { none: true } },
    { m: ["The Organizer was asked a moment ago"], k: "wait", t: "The Organizer was asked a moment ago", w: "We already sent the Organizer a request, so please give them a little time.", d: ["Please wait a few minutes before asking again.", "You can also message the Organizer yourself."], g: { none: true } },
    { m: ["You already have this client", "That client is not active", "That game was not prepared through this client", "Say which game"], k: "blocked", t: "That cannot be done just now", w: "Either this client is already yours, was not set up through you, or invitations are limited for a while to avoid spamming anyone.", d: ["Check the client's e-mail address in your list.", "If you have asked a moment ago, please wait a little before asking again."], g: { none: true } },
    // ---------- messages the screens write themselves ----------
    { m: ["Please give the number of players", "Please give the number of participants"], k: "field", t: "Please type how many people will play", w: "The game needs a whole number of players, for example 180, so we can prepare the right number of tickets.", d: ["Type a whole number in the box, like 180.", "Then press Save and continue."], g: { step: 2, field: "#f-cap", label: "Number of participants" } },
    { m: ["For more than 10,000 players"], k: "blocked", t: "That is more than our standard packs", w: "Standard packs go up to 10,000 players. For more than that we make a special arrangement.", d: ["Type 10,000 or fewer to carry on.", "Or message us and tell us how many people you expect."], g: { step: 2, field: "#f-cap", label: "Number of participants", wa: true } },
    { m: ["Pick at least one kind of guest"], k: "field", t: "Please choose who can join", w: "You switched on guest invitations, so we need to know which kinds of guests may be invited.", d: ["Tick at least one kind of guest.", "Then press Save and continue."], g: { step: 2, label: "Number of participants" } },
    { m: ["Tick at least one prize"], k: "field", t: "Please choose at least one prize", w: "A game needs at least one prize for people to play for.", d: ["Tick a prize, for example Full House.", "Then choose what the prize is, and press Save and continue."], g: { step: 3, field: "#sec3 input[type=checkbox]", label: "Set Prizes" } },
    { m: ["Add your company name for the top of the ticket", "Pick an accent colour for your company strip"], k: "field", t: "Please finish the company strip", w: "To show your company on the ticket we need its name and a colour. Or you can leave the strip empty.", d: ["Type your company name, and pick a colour.", "Or clear the colour and logo to skip the strip."], g: { step: 4, field: "#f-brand-name", label: "Company name" } },
    { m: ["Please choose a PNG, JPEG or WebP picture", "That picture is bigger than 5 MB"], k: "field", t: "Please choose a smaller picture of the right kind", w: "A logo should be a PNG, JPEG or WebP picture and under 5 MB.", d: ["Choose a different picture file.", "A small square logo works best."], g: { step: 4, field: "#brandlogo", label: "Small logo" } },
    { m: ["Pick the day and the time"], k: "field", t: "Please choose the day and the time", w: "The game needs both a day and a time to start.", d: ["Pick the day, then the time.", "Press Save and continue."], g: { step: 1, field: "#f-timeo", label: "Date and time" } },
    { m: ["Please type the Host's name"], k: "field", t: "Please type the Host's name", w: "The Host's own link is made with their name on it, so we need it.", d: ["Type the Host's name in the first box.", "Then press Add a Host."], g: { step: 5, field: "#hostlabel", label: "Name of the new Host" } },
    { m: ["Please type the Host's mobile number or e-mail"], k: "field", t: "Please give the Host's mobile number or e-mail", w: "We send the Host's own link to their mobile number (on WhatsApp) or to their e-mail, so we need at least one of them.", d: ["Type the Host's mobile number, or their e-mail address.", "Then press Add a Host."], g: { step: 5, field: "#hostphone", label: "Mobile number of the new Host" } },
    { m: ["Please check the Host's e-mail", "That e-mail address does not look right. Please check it"], k: "field", t: "Please check the Host's e-mail address", w: "The e-mail address has a typing slip, so the Host's link could not be sent to it.", d: ["Type the full address: the part before the @ sign, the @ sign, and the part after it.", "Then press Add a Host."], g: { step: 5, field: "#hostemail", label: "E-mail of the new Host" } },
    { m: ["Please check the Host's mobile number", "Please give the Host's e-mail address or mobile number"], k: "field", t: "Please check the Host's mobile number", w: "The mobile number has a digit missing or extra.", d: ["Type the 10-digit mobile number without spaces.", "Then press Add a Host."], g: { step: 5, field: "#hostphone", label: "Mobile number of the new Host" } },
    { m: ["Please type the Co-host's name", "Please give the Co-host's name"], k: "field", t: "Please type the Co-host's name", w: "The Co-host's own link is made with their name on it, so we need it.", d: ["Type the Co-host's name in the first box.", "Then press Add a Co-host."], g: { step: 5, field: "#cohostlabel", label: "Name of the new Co-host" } },
    { m: ["Please type the Co-host's mobile number", "Please give a valid mobile number for the Co-host"], k: "field", t: "Please check the Co-host's mobile number", w: "We send the Co-host's own link to their mobile number (on WhatsApp), so we need a correct 10-digit number.", d: ["Type the 10-digit mobile number without spaces.", "Then press Add a Co-host."], g: { step: 5, field: "#cohostphone", label: "Mobile number of the new Co-host" } },
    { m: ["Type your own mobile number, then press the button again", "That number looks wrong", "Please type their mobile number", "That number does not look right", "Please type their name", "Please check your mobile number"], k: "field", t: "Please check the mobile number", w: "The number has a digit missing or extra, or it is empty.", d: ["Type the 10-digit mobile number without spaces.", "Then press the button again."], g: { step: 6, field: "#ph, #ubph, #pdph, #gphone, #setupphone, input[type=tel]", label: "the mobile number box" } },
    { m: ["Write a message first"], k: "field", t: "Please write a message first", w: "There is nothing to send yet. A message can be up to 160 characters.", d: ["Type your message, or tap one of the ready messages.", "Then press Send to everyone."], g: { step: 9, field: "#annText", label: "Message to your guests" } },
    { m: ["The report is not ready yet"], k: "wait", t: "The report is not ready yet", w: "The report is made after the game ends. It usually takes a few minutes.", d: ["Please wait a few minutes after the last number is called.", "Then open After the game again."], g: { step: 10, label: "After the game" } },
    { m: ["Please type your e-mail", "Please enter a valid email."], k: "field", t: "Please check the e-mail address", w: "The e-mail address is missing or has a typing slip, so we cannot send you the code or the invoice.", d: ["Type the full address: the part before the @ sign, the @ sign, and the part after it.", "Then try again."], g: { field: "#setupemail, #em, #pubEmail, input[type=email]", label: "the e-mail box" } },
    { m: ["Please enter your mobile number", "Please enter your organization name"], k: "field", t: "Please fill in the missing detail", w: "One box needed for this step is empty.", d: ["Type the missing detail in the highlighted box.", "Then press the button again."], g: { field: "input:not([type=checkbox]):not([type=hidden])", label: "the empty box" } },
    { m: ["The code has 6 digits", "Enter the 6-digit passcode"], k: "field", t: "The code has 6 digits", w: "The sign-in code we e-mailed has exactly 6 digits.", d: ["Open the newest e-mail from us and type all 6 digits.", "Or press Send me a new code."], g: { field: "#lCode, #code, #setupcode, input[inputmode=numeric]", label: "the code box" } },
    { m: ["Please enter a valid 15-character GSTIN"], k: "field", t: "Please check the GSTIN", w: "A GSTIN has 15 letters and numbers, like 27ABCDE1234F1Z5. It is optional.", d: ["Type the 15 characters again, or leave it empty if you do not have one."], g: { field: "#gst, #payGst, input[name=gst]", label: "the GSTIN box" } },
    { m: ["No engagement was chosen"], k: "blocked", t: "Please open payment from your game", w: "This page does not know which game to pay for.", d: ["Open your game from My games.", "Then open Pay from inside the game."], g: { href: "/zc.html", label: "Go to my games" } },
    { m: ["That sign-in key or link was not accepted"], k: "blocked", t: "That link or key was not accepted", w: "A link can expire, be replaced by a newer one, or the game may have been removed.", d: ["Sign in again with your e-mail address to get a fresh link.", "If you were sent a link by someone, ask them for the newest one."], g: { href: "/#login", label: "Sign in" } },
    { m: ["Could not find a free game code"], k: "field", t: "Please try a different game name", w: "That name is already taken, so we could not make its game code.", d: ["Change the name a little, for example add the year.", "Then press the button again."], g: { field: "input[type=text]", label: "the game name" } },
    { m: ["That address already has an account"], k: "blocked", t: "That address already has an account", w: "You can use the same address. We will send you a code.", d: ["Press Send me a code and use the code from your e-mail."], g: { href: "/#login", label: "Sign in" } },
    { m: ["This request has expired", "Open this link in the browser where you set up this engagement"], k: "blocked", t: "This approval link cannot be used here", w: "The request has expired, or it was opened in a different browser from the one where the game was set up.", d: ["Open the link in the same browser where you set up the game.", "If it has expired, ask your AI assistant to prepare it again."], g: { none: true } },
    { m: ["Could not reach the payment service", "Could not open the payment window", "No connection right now", "We could not reach the service"], k: "wait", t: "We could not reach the service", w: "Your internet connection may have dropped for a moment. Nothing you typed is lost, and you have not been charged.", d: ["Check your internet connection.", "Then press Try again."], g: { retry: true } },
    { m: ["Payment was cancelled", "We are still waiting for Razorpay", "Razorpay has not confirmed yet"], k: "wait", t: "Your payment is not confirmed yet", w: "Either the payment window was closed, or the bank is still confirming. If money was taken it is returned or confirmed automatically, and you are never charged twice.", d: ["Wait about five minutes, then open Pay again.", "If money was taken and nothing changes, message us with the reference below."], g: { retry: true, wa: true } },
    { m: ["Please enter a valid email"], k: "field", t: "Please check the e-mail address", w: "The e-mail address is missing or has a typing slip, so we cannot send you the invoice.", d: ["Type the full address: the part before the @ sign, the @ sign, and the part after it.", "Then try again."], g: { field: 'input[type="email"], #em', label: "the e-mail box" } },
    { m: ["This is not switched on yet"], k: "wait", t: "This part is not switched on yet", w: "This feature is not available on our side at this moment. Nothing you did is lost.", d: ["Please try again a little later.", "If it is still not available tomorrow, message us and we will look into it."], g: { wa: true } },
    { m: ["We could not find that. The link may be old or mistyped"], k: "blocked", t: "We could not find that", w: "The link may be old or mistyped, or the item was removed.", d: ["Please open the link from your latest e-mail or message.", "Or ask the person who sent it for a new link."], g: { none: true } },
    { m: ["This engagement link is not valid", "This game link is not valid", "This link is incomplete"], k: "blocked", t: "This game link does not work", w: "The link may be mistyped, cut short when it was copied, or from an old game.", d: ["Please ask the person who invited you to send the link again.", "Open the new link on this phone."], g: { none: true } },
    { m: ["Could not reach the engagement", "Could not reach the game", "No connection right now. Your ticket is safe"], k: "wait", t: "We could not reach the game", w: "Your internet connection may have dropped for a moment. Your ticket is safe on this phone, and the game opens by itself when you are back online.", d: ["Check your internet connection.", "If it does not open by itself in a minute, press Try again."], g: { retry: true } },
    { m: ["The game could not be opened just now"], k: "wait", t: "The game could not be opened just now", w: "This is not your doing. Many people may be opening the game at the same moment, and your ticket is safe.", d: ["Please wait a minute.", "Then open the link again."], g: { retry: true } },
    { m: ["You are not on the list for this game"], k: "blocked", t: "Your number is not on this game's list", w: "This game is by invitation, and the number you typed is not on the Organizer's list.", d: ["Please ask the person who invited you to add your number.", "Then open your link again."], g: { none: true } },
    { m: ["Could not do that. Please try again", "Could not save. Please try again"], k: "wait", t: "That did not go through", w: "Something stopped it just now. Nothing you did is lost.", d: ["Please wait a moment.", "Then press the button again."], g: { retry: true } },
    { m: ["busy"], s: [503], k: "wait", t: "It is very busy right now", w: "A lot of people are using the service at this moment. Nothing you did is lost.", d: ["Please wait a minute or two.", "Then press Try again."], g: { retry: true } },
    // ---------- unexpected ----------
    { m: ["Something went wrong", "The service is not configured", "Could not make a new game code", "It is very busy right now", "It is busy right now", "Busy day"], k: "unexpected", t: "Something did not work on our side", w: "This is not your doing. Your work on this screen is kept.", d: ["Please wait a minute and press Try again.", "If it happens again, send us a WhatsApp message with the reference below."], g: { retry: true, wa: true } }
  ];
  /* Messages that are never put in front of a person (the owner's tools, AI links, the payment service calling us, internal checks). */
  var API_ONLY = ["Not found", "Too large", "Bad signature", "Bad request", "Bad body", "Bad key", "Bad claim", "Bad message", "Bad report", "Give the organizer's e-mail address: ?email", "Give the partner code", "Give the payment id", "Give an address to add or to remove", "Say which mode", "Rate must be between", "month must be YYYY-MM", "Webhook secret is not set", "Not allowed", "Say which: ?pid", "Say admit or decline", "Ask for pause, resume, stop or erase", "Pick a status", "No such suggestion", "No such engagement", "Your Co-host link is for a different game", "Give a kind (feature", "Please do not include e-mail addresses or phone numbers", "That is plenty for today", "Send up to 10 notices", "Winners are decided", "Say whether", "Give the Host's", "Give a date and time with a time zone"];

  /* What to show when nothing above matches: by status, still polite and complete. */
  var BY_STATUS = {
    0: { k: "wait", t: "We could not reach the service", w: "Your internet connection may have dropped for a moment. Nothing you typed is lost on this screen.", d: ["Check your internet connection.", "Then press Try again."], g: { retry: true } },
    400: { k: "field", t: "One detail needs a look", w: "Something you entered is missing or not in the form we expect.", d: ["Look at the boxes on this screen for a highlighted one.", "Correct it and try again."], g: { none: true } },
    402: { k: "blocked", t: "This needs a payment or a bigger pack", w: "What you asked for is more than the pack covers.", d: ["Open Pay to complete the payment or choose a bigger pack."], g: { step: 8, label: "Pay" } },
    403: { k: "blocked", t: "This is not available from here", w: "Your sign-in or link does not allow this action.", d: ["Please sign in again with the e-mail address you used.", "If you were given a link, open that link again."], g: { href: "/#login", label: "Sign in" } },
    404: { k: "blocked", t: "We could not find that", w: "The link may be old or mistyped, or the item was removed.", d: ["Please open the link from your latest e-mail or message.", "Or ask the person who sent it for a new link."], g: { none: true } },
    409: { k: "blocked", t: "That cannot be done at the moment", w: "The game or the list is in a state that does not allow it right now.", d: ["Please refresh this page to see the latest state, then try again."], g: { retry: true } },
    410: { k: "blocked", t: "That is no longer available", w: "It was removed, as promised, to protect people's privacy.", d: ["Please add the information again if you still need it."], g: { none: true } },
    413: { k: "field", t: "That is a little too big", w: "The file or list is larger than we can take in one go.", d: ["Please send it in smaller parts."], g: { none: true } },
    423: { k: "blocked", t: "This ticket or link is in use elsewhere", w: "A ticket or link works on one phone only, for fairness.", d: ["Please ask the person who invited you to send the link again."], g: { none: true } },
    429: { k: "wait", t: "Please give it a moment", w: "There were many tries in a short time, so we paused for your safety. Nothing is lost.", d: ["Wait a few minutes, then try again."], g: { retry: true } },
    500: { k: "unexpected", t: "Something did not work on our side", w: "This is not your doing. Your work is kept.", d: ["Please wait a minute and press Try again.", "If it happens again, message us with the reference below."], g: { retry: true, wa: true } }
  };
  BY_STATUS[502] = BY_STATUS[503] = BY_STATUS[504] = BY_STATUS[500];

  var norm = function (s) { return String(s == null ? "" : s).toLowerCase().replace(/\bgames?\b/g, "engagement").replace(/\b(?:board|card|place|seat)s?\b/g, "ticket") /*GAMEWORD: this game says game/board where the catalog says engagement/ticket*/.replace(/\$\{[^}]*\}/g, "").replace(/\{x\}/g, "").replace(/\d+/g, "").replace(/\s+/g, " ").trim(); };
  var apiOnly = function (msg) { var n = norm(msg); return API_ONLY.some(function (a) { return a && n.indexOf(norm(a)) === 0; }); };
  CTG.catalog = C; CTG.apiOnly = apiOnly;

  /** Finds the guide for an error: the first catalog entry whose fragment appears in the message (and whose status fits), else the status's own guide. */
  CTG.find = function (info) {
    info = info || {}; var n = norm(info.message), st = info.status === -1 ? -1 : Number(info.status) || 0, i, j, e;
    if (n) for (i = 0; i < C.length; i++) { e = C[i]; if (e.s && e.s.length && st !== -1 && e.s.indexOf(st) < 0) continue; for (j = 0; j < e.m.length; j++) { var f = norm(e.m[j]); if (f && n.indexOf(f) >= 0) return { entry: e, matched: true, frag: f, norm: n }; } }
    return { entry: BY_STATUS[st] || (st >= 500 ? BY_STATUS[500] : BY_STATUS[400]), matched: false };
  };
  var ref = function () { var s = "", a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", i; for (i = 0; i < 6; i++) s += a.charAt(Math.floor(Math.random() * a.length)); return s; };

  /** Who is looking: a guest on the game page, the Organizer in the console, someone on the pay page. A guest never gets a button that leads into the Organizer's console. */
  CTG.role = function () { var p = location.pathname.replace(/\.html$/, ""); return /^\/z$/.test(p) ? "player" : /^\/zc$/.test(p) ? "organizer" : /^\/big$/.test(p) ? "screen" : /^\/(pay|paylink)$/.test(p) ? "payer" : "other"; };
  var PLAYER_TEXT = {
    "All the places in this game are taken": { t: "This game is full", w: "All the places in this game have been taken, so no more people can join.", d: ["Please tell the Organizer, or the person who invited you, that you would like to join.", "They can make room for you. If you were already in, open the link on the phone you joined with."] },
    "This game is not open yet, or the link is old": { t: "This game is not open yet, or the link is old", w: "Either the Organizer has not opened the game yet, or the link was replaced by a newer one.", d: ["Please ask the person who invited you to send the latest link.", "Open the new link on this phone."] },
    "This game is not going ahead": { t: "This game is not going ahead", w: "The game was cancelled, or it did not start and was closed. Names and numbers are erased within a day.", d: ["Nothing more to do here.", "If you would like to play, please ask the person who invited you whether a new game is planned."] },
    "This game is by invitation": null
  };
  function forRole(o) {
    if (CTG.role() !== "player") return o; var x = PLAYER_TEXT[o.title];
    if (x) { o.title = x.t; o.what = x.w; o.steps = x.d.slice(); }
    var go = o.go || {}; if (go.step || (go.href && /^\/(zc|#login)/.test(go.href))) o.go = { none: true }; else if (go.wa) o.go = { none: true, wa: go.wa };
    return o;
  }
  /** The 'what happened' line: the person's screen or the server often says something the catalog cannot know (a limit, a name, "type your number to ask to join"). When the message says clearly more than the matched fragment, it is kept word for word. */
  function whatFor(entry, f, original) {
    var extra = f && f.norm && f.frag ? f.norm.length - f.frag.length : 0, o = String(original == null ? "" : original).replace(/\s+/g, " ").trim();
    if (!(extra > 14 && o.length > 20 && o.length < 360)) return entry.w;
    return entry.k === "wait" || entry.k === "unexpected" ? o + " " + entry.w : o; // a pause or a failure always carries the reassurance as well (nothing is lost, it is not the person's doing)
  }
  /** The guide for an error, ready to show. */
  CTG.explain = function (info) {
    var f = CTG.find(info), e = f.entry;
    return forRole({ key: (e.t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40), kind: e.k, title: e.t, what: f.matched ? whatFor(e, f, info && info.message) : e.w, steps: e.d.slice(), go: e.g || { none: true }, ref: ref(), matched: f.matched, status: Number(info && info.status) || 0 });
  };
  /** Called by every place that turns a failed call into an Error: the error gets .guide, and the failure is recorded for the owner (never with personal data). */
  CTG.wrap = function (err, ctx) {
    try {
      if (!err || err.guide) return err;
      SHOWN = {};
      var g = CTG.explain({ status: err.status, message: err.message, code: err.code });
      err.guide = g;
      if (ctx && ctx.watch) CTG.watch(err, ctx);
      if (window.__bb && g.kind !== "wait") window.__bb.report("guided", g.kind === "unexpected" ? "warn" : "info", "guided: " + g.key + " (" + (g.status || "net") + ")" + (ctx && ctx.what ? " while " + ctx.what : ""), "", { ref: g.ref });
    } catch (e) { /* guiding must never break the page */ }
    return err;
  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // showing it
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var css = '.ctg-wrap{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;background:rgba(10,20,40,.55);padding:0}@media(min-width:640px){.ctg-wrap{align-items:center;padding:24px}}' +
    '.ctg-card{background:#fff;color:#14213d;width:100%;max-width:520px;border-radius:18px 18px 0 0;padding:22px 20px 18px;box-shadow:0 -8px 40px rgba(0,0,0,.35);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-height:92vh;overflow:auto}@media(min-width:640px){.ctg-card{border-radius:18px}}' +
    '.ctg-card h2{margin:0 0 8px;font-size:21px;line-height:1.25}.ctg-card p{margin:0 0 10px}.ctg-card ol{margin:6px 0 14px;padding-left:22px}.ctg-card li{margin:4px 0}' +
    '.ctg-btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}.ctg-btn{min-height:46px;padding:10px 18px;border-radius:999px;border:2px solid #0B3D91;background:#fff;color:#0B3D91;font:700 16px system-ui,sans-serif;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}' +
    '.ctg-btn.main{background:#0B3D91;color:#fff}.ctg-btn.wa{border-color:#128C4A;color:#0a5a2e;background:#e8f8ee}.ctg-ref{margin:12px 0 0;font-size:13px;color:#4a5568}' +
    '.ctg-inline{border:2px solid #E4572E;background:#FFF4EF;color:#14213d;border-radius:12px;padding:12px 14px;margin:10px 0;font:15px/1.5 system-ui,sans-serif}.ctg-inline b{display:block;font-size:16px;margin-bottom:2px}.ctg-inline ol{margin:6px 0 8px;padding-left:20px}.ctg-inline .ctg-btn{min-height:40px;padding:6px 14px;font-size:15px}' +
    '.ctg-needs{margin:8px 0 0;font:14px/1.45 system-ui,sans-serif;color:#7a2e12}.ctg-flag{outline:4px solid #E4572E!important;outline-offset:3px;border-radius:6px;transition:outline-color .3s}' +
    '.ctg-back{position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:2147482000;background:#0B3D91;color:#fff;border:0;border-radius:999px;padding:12px 20px;font:700 15px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer;max-width:92vw}' +
    '@media(prefers-color-scheme:dark){html:not([data-theme="light"]) .ctg-card{background:#101a2e;color:#f1f5ff}html:not([data-theme="light"]) .ctg-btn{background:#101a2e;color:#cfe0ff;border-color:#7aa7ff}html:not([data-theme="light"]) .ctg-btn.main{background:#2f6bff;color:#fff;border-color:#2f6bff}}';
  var styled = false;
  function ensureStyle() { if (styled || !document.head) return; styled = true; var s = document.createElement("style"); s.id = "ctg-style"; s.textContent = css; document.head.appendChild(s); }

  var waLink = function (g) { return "https://wa.me/" + WA + "?text=" + encodeURIComponent("Hello, I need help with Corporate Tic Tac Toe. Reference: " + g.ref); };
  function body(g, ctx, mode) {
    var steps = g.steps.length ? "<ol>" + g.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" : "";
    var btns = "", go = g.go || {}, label = go.label ? esc(go.label) : "";
    if (go.step || go.field || go.href) btns += '<button type="button" class="ctg-btn main" data-ctg="go">Take me there' + (label ? ": " + label : "") + "</button>";
    if (go.retry && ctx && ctx.retry) btns += '<button type="button" class="ctg-btn' + (btns ? "" : " main") + '" data-ctg="retry">Try again</button>';
    if (go.wa || g.kind === "unexpected") btns += '<a class="ctg-btn wa" target="_blank" rel="noopener" href="' + waLink(g) + '">Message us on WhatsApp</a>';
    if (mode === "dialog") btns += '<button type="button" class="ctg-btn" data-ctg="close">' + (btns ? "Close" : "OK, I understand") + "</button>";
    return steps + '<div class="ctg-btns">' + btns + "</div>" + (g.kind === "unexpected" || go.wa ? '<p class="ctg-ref">Reference: <b>' + esc(g.ref) + "</b> (quote this if you message us; it holds no personal details).</p>" : "");
  }
  function act(g, ctx, how) {
    if (how === "go") CTG.go(g.go, ctx);
    else if (how === "retry" && ctx && ctx.retry) { CTG.close(); try { ctx.retry(); } catch (e) { /* the caller shows its own result */ } }
    else CTG.close();
  }
  CTG.close = function () { var w = document.getElementById("ctg-dialog"); if (w) { w.remove(); if (CTG._prev && CTG._prev.focus) try { CTG._prev.focus(); } catch (e) {} } };

  /** A pop-up: for blocked, waiting and unexpected situations, where the person must do something elsewhere or wait. */
  CTG.dialog = function (errOrGuide, ctx) {
    ensureStyle();
    var g = errOrGuide && errOrGuide.guide ? errOrGuide.guide : errOrGuide && errOrGuide.title ? errOrGuide : CTG.explain(errOrGuide);
    CTG.close(); CTG._prev = document.activeElement; lastShownAt = Date.now();
    var w = document.createElement("div"); w.id = "ctg-dialog"; w.className = "ctg-wrap";
    w.innerHTML = '<div class="ctg-card" role="alertdialog" aria-modal="true" aria-labelledby="ctg-t" aria-describedby="ctg-w"><h2 id="ctg-t">' + esc(g.title) + '</h2><p id="ctg-w">' + esc(g.what) + "</p>" + body(g, ctx, "dialog") + "</div>";
    document.body.appendChild(w);
    w.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-ctg]"); if (b) act(g, ctx, b.getAttribute("data-ctg")); else if (e.target === w) CTG.close(); });
    w.addEventListener("keydown", function (e) { if (e.key === "Escape") CTG.close(); });
    var first = w.querySelector(".ctg-btn.main") || w.querySelector(".ctg-btn"); if (first) first.focus();
    return g;
  };
  /** A message in place, right where the person is working: for mistakes in what they typed or chose. Returns the guide. */
  CTG.inline = function (host, errOrGuide, ctx) {
    ensureStyle();
    var g = errOrGuide && errOrGuide.guide ? errOrGuide.guide : errOrGuide && errOrGuide.title ? errOrGuide : CTG.explain(errOrGuide);
    var el = typeof host === "string" ? document.querySelector(host) : host; if (!el) return CTG.dialog(g, ctx);
    lastShownAt = Date.now(); var old = el.querySelector(".ctg-inline"); if (old) old.remove();
    var d = document.createElement("div"); d.className = "ctg-inline"; d.setAttribute("role", "alert");
    d.innerHTML = "<b>" + esc(g.title) + "</b>" + esc(g.what) + body(g, ctx, "inline");
    el.insertBefore(d, el.firstChild);
    d.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-ctg]"); if (b) act(g, ctx, b.getAttribute("data-ctg")); });
    bring(d);
    return g;
  };
  /** Shows an error the right way for its kind: a mistake in what was typed -> in place if a place is given; everything else -> a pop-up. */
  CTG.show = function (err, ctx) {
    ctx = ctx || {}; var g = err && err.guide ? err.guide : CTG.explain({ status: err && err.status, message: err && err.message });
    if (g.kind === "field" && ctx.host) return CTG.inline(ctx.host, g, ctx);
    return CTG.dialog(g, ctx);
  };

  // ---------- taking the person to the exact place, and back ----------
  const RET = "ctz-return"; // the one thing the guide keeps (this tab only): where to come back to
  var ss = { get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }, del: function (k) { try { sessionStorage.removeItem(k); } catch (e) {} } };
  /** Brings an element into view only if it is not already fully visible, and instantly: a page that scrolls smoothly lets the next tap land on the wrong control. */
  function bring(el) {
    try { var r = el.getBoundingClientRect(), h = window.innerHeight || document.documentElement.clientHeight; if (r.top >= 60 && r.bottom <= h - 20) return; el.scrollIntoView({ block: "center", behavior: "auto" }); } catch (e) {}
  }
  function flag(el) { if (!el) return false; el.classList.add("ctg-flag"); bring(el); try { el.focus({ preventScroll: true }); } catch (e) {} setTimeout(function () { el.classList.remove("ctg-flag"); }, 6000); return true; }
  CTG.focus = function (sel) { var list = String(sel || "").split(","), i, el; for (i = 0; i < list.length; i++) { try { el = document.querySelector(list[i].trim() + ":not([type=hidden])"); } catch (e) { el = null; } if (el && el.offsetParent !== null) return flag(el); } return false; };
  /** go = a guide target. ctx.back = {step, label} or {href, label}: where to come back to. */
  CTG.go = function (go, ctx) {
    ctx = ctx || {}; CTG.close(); go = go || {};
    if (ctx.back) { ss.set(RET, JSON.stringify({ back: ctx.back, at: Date.now() })); }
    if (go.href) {
      if (!ctx.back) ss.set(RET, JSON.stringify({ back: { href: location.pathname + location.search + location.hash, label: "where you were working" }, at: Date.now() }));
      location.href = go.href; return;
    }
    if (go.step && typeof window.ctzFocus === "function") { window.ctzFocus(go.step, go.field); showBack(); return; }
    if (go.field) CTG.focus(go.field);
    showBack();
  };
  function showBack() {
    var r; try { r = JSON.parse(ss.get(RET) || "null"); } catch (e) { r = null; }
    if (!r || !r.back || Date.now() - r.at > 3600000) return;
    ensureStyle(); var old = document.getElementById("ctg-back"); if (old) old.remove();
    var b = document.createElement("button"); b.id = "ctg-back"; b.type = "button"; b.className = "ctg-back"; b.textContent = "Done? Back to " + (r.back.label || "where you were");
    b.onclick = function () { b.remove(); ss.del(RET); if (r.back.step && typeof window.ctzFocus === "function") window.ctzFocus(r.back.step); else if (r.back.href) location.href = r.back.href; };
    document.body.appendChild(b);
  }
  CTG.arrive = showBack;

  // ---------- the watcher: a screen's own error message is upgraded in place ----------
  // Any short message a screen puts up that has a guide (a toast, a banner, a note under a box) becomes the full explanation, right where it appeared:
  // what happened, what to do, a button that outlines and focuses the exact box (or opens the right step), and a way back. The original text stays as the heading.
  var MSGSEL = '.zc-toast, .zbanner.bad, .zbanner, #fErr, #fErr *, .note.bad, .bad, .zc-err, .zerr, .zmsg, [role="alert"], [role="status"], .err, .errnote, #toast, .toast';
  var lastShownAt = 0; // when any guide was last put in front of the person: the safety net for swallowed failures stays quiet if one was shown since the failure, even if it has been closed again
  var SHOWN = {}; // pop-ups already shown for the failure in progress; a new failed action clears it
  var done = { has: function (el) { return !!(el && el.getAttribute && el.getAttribute("data-ctg-seen")); }, add: function (el) { try { el.setAttribute("data-ctg-seen", "1"); } catch (e) {} } };
  function okToUpgrade(el) {
    if (!el || done.has(el) || el.closest(".ctg-inline,#ctg-dialog,#ctg-back")) return false;
    var t = (el.textContent || "").replace(/\s+/g, " ").trim(); if (t.length < 8 || t.length > 420) return false;
    if (el.querySelector("input,select,textarea,form")) return false;
    return t;
  }
  function backHint(go) { try { if (go && go.step && typeof window.ctzStep === "function" && window.ctzStep() && window.ctzStep() !== go.step) return { step: window.ctzStep(), label: (window.ctzStepName && window.ctzStepName(window.ctzStep())) || "where you were" }; } catch (e) {} return null; }
  function upgrade(el, certain) {
    var text = okToUpgrade(el); if (!text) return; var f = CTG.find({ status: -1, message: text });
    if (!f.matched) return; done.add(el); ensureStyle();
    var e = f.entry, g = forRole({ key: (e.t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40), kind: e.k, title: e.t, what: whatFor(e, f, text), steps: e.d.slice(), go: e.g || { none: true }, ref: ref(), matched: true, status: 400 });
    var ctx = { back: backHint(g.go), retry: window.__ctgRetry || null };
    if (el.id === "toast" || g.kind === "wait" || g.kind === "unexpected") { if (el.id === "toast") el.classList.add("hidden"); else el.style.display = "none"; if (SHOWN[text]) return; SHOWN[text] = 1; CTG.dialog(g, ctx); return; } // shown once for each failure: a screen that redraws the same line after Close must not bring the pop-up back // a message that fades is no way to guide: show it as a pop-up that stays
    lastShownAt = Date.now(); el.classList.add("ctg-inline"); el.setAttribute("role", "alert"); el.setAttribute("data-ctg-done", "1");
    el.innerHTML = "<b>" + esc(g.title) + "</b>" + esc(g.what) + body(g, ctx, "inline");
    el.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest("[data-ctg]"); if (b) act(g, ctx, b.getAttribute("data-ctg")); });
    if (g.kind === "field" && g.go && g.go.field && !(g.go.step && backHint(g.go))) CTG.focus(g.go.field); // bring the box into view and outline it, right away
    bring(el);
    if (window.__bb) window.__bb.report("guided", "info", "guided: " + g.key + " (screen message)", "", { ref: g.ref });
  }
  var SKIP_TAG = { LABEL: 1, BUTTON: 1, A: 1, OPTION: 1, SELECT: 1, TEXTAREA: 1, INPUT: 1, TH: 1, LEGEND: 1, SUMMARY: 1, H1: 1, H2: 1, H3: 1, H4: 1, SCRIPT: 1, STYLE: 1, NAV: 1, HEADER: 1, FOOTER: 1, TITLE: 1 };
  /** A short standalone element whose text IS (not merely contains) one known message, e.g. the bold line a screen puts in a note. Returns the element to upgrade (its tidy parent when that holds nothing else). */
  function leafMessage(el) {
    if (!el || el.nodeType !== 1 || SKIP_TAG[el.tagName] || done.has(el)) return null;
    if (el.closest && el.closest(".ctg-inline,#ctg-dialog,#ctg-back,label,button,a,nav,header,footer,select,textarea,.zc-sech,.zc-sech-static,h1,h2,h3,h4,legend,summary")) return null;
    if (el.querySelector && el.querySelector("input,select,textarea,form,button,a")) return null;
    var t = (el.textContent || "").replace(/\s+/g, " ").trim(); if (t.length < 12 || t.length > 300) return null;
    if (el.children.length > 2) return null;
    var f = CTG.find({ status: -1, message: t }); if (!f.matched) return null;
    var n = norm(t), best = 0, j; for (j = 0; j < f.entry.m.length; j++) { var fr = norm(f.entry.m[j]); if (fr && n.indexOf(fr) >= 0 && fr.length > best) best = fr.length; }
    if (best < 0.6 * n.length) return null; // static help text that only mentions the words is not an error
    var par = el.parentNode; if (par && par.nodeType === 1 && /^(P|DIV|LI|SPAN)$/.test(par.tagName) && (par.textContent || "").replace(/\s+/g, " ").trim() === t && !done.has(par)) return par;
    return el;
  }
  function scan(root, first) {
    var list, seen = [];
    try { list = (root.matches && root.matches(MSGSEL) ? [root] : []).concat([].slice.call(root.querySelectorAll ? root.querySelectorAll(MSGSEL) : [])); } catch (e) { return; }
    list.forEach(upgrade);
    if (first) return; // what was already on the page when it opened is help text, not an error
    var leaves = [].slice.call(root.querySelectorAll ? root.querySelectorAll("p,b,span,div,li,small,em,strong") : []); if (root.nodeType === 1 && !SKIP_TAG[root.tagName]) leaves.unshift(root);
    leaves.forEach(function (l) { var t = leafMessage(l); if (t && seen.indexOf(t) < 0) { seen.push(t); upgrade(t, true); } });
  }
  var pending = false;
  function later(n) { if (n && n.nodeType === 1) queue.push(n); if (pending) return; pending = true; setTimeout(function () { pending = false; var q = queue.splice(0); q.forEach(function (n) { if (document.contains(n)) scan(n); }); hintDisabled(); }, 60); }
  var queue = [];
  if (window.MutationObserver) { new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(later); if (m.type === "characterData" && m.target.parentNode) later(m.target.parentNode); }); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); }

  // ---------- a greyed-out button says why ----------
  // A primary button that cannot be pressed yet explains what is still needed (empty boxes, unticked agreements) right under it, and updates as the person fills things in.
  var BTN = "button.zc-btn, button.btn, button.zbtn, #pubgo, #go, #paygo, #lgGo, #cdGo";
  function label(el) { var id = el.id, l = id && document.querySelector('label[for="' + id + '"]'); var t = (l && l.textContent) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || ""; return t.replace(/\s+/g, " ").trim().replace(/[:*].*$/, "").slice(0, 40); }
  function needs(btn) {
    var box = btn.closest("form,.zcard,.zc-card,.sheet,section,.zc-secb") || btn.parentNode, out = [], seen = {};
    box.querySelectorAll("input,select,textarea").forEach(function (i) {
      if (i.offsetParent === null || i.disabled || i.type === "hidden") return;
      if (i.type === "checkbox") { if (!i.checked && (i.hasAttribute("data-box") || i.required)) { var l = (i.closest("label") && i.closest("label").textContent || "").replace(/\s+/g, " ").trim(); var k = "tick:" + (i.getAttribute("data-box") || l.slice(0, 20)); if (!seen[k]) { seen[k] = 1; out.push({ tick: l.slice(0, 80) || "the agreement" }); } } }
      else if (i.required || i.hasAttribute("data-need")) {
        var v = String(i.value || "").trim(), lb = label(i) || "a box above";
        if (!v) { if (!seen[lb]) { seen[lb] = 1; out.push({ fill: lb }); } }
        else if (i.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { if (!seen["bad" + lb]) { seen["bad" + lb] = 1; out.push({ fix: lb, what: "has a typing slip" }); } }
        else if ((i.type === "tel" || i.getAttribute("inputmode") === "tel") && v.replace(/\D/g, "").length < 8) { if (!seen["bad" + lb]) { seen["bad" + lb] = 1; out.push({ fix: lb, what: "needs the full number" }); } }
      }
    });
    return out;
  }
  function hintDisabled() {
    document.querySelectorAll(BTN).forEach(function (b) {
      var off = b.disabled || b.getAttribute("aria-disabled") === "true"; var hint = b.nextElementSibling && b.nextElementSibling.classList && b.nextElementSibling.classList.contains("ctg-needs") ? b.nextElementSibling : null;
      if (!off || b.offsetParent === null) { if (hint) hint.remove(); return; }
      var n = needs(b); if (!n.length) { if (hint) hint.remove(); return; }
      var txt = "Still needed before this button works: " + n.map(function (x) { return x.tick ? "tick the agreement" + (n.filter(function (y) { return y.tick; }).length > 1 ? "s" : "") : x.fix ? "check \u201c" + x.fix + "\u201d (it " + x.what + ")" : "fill in " + x.fill; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join("; ") + ".";
      if (!hint) { ensureStyle(); hint = document.createElement("p"); hint.className = "ctg-needs"; hint.setAttribute("role", "status"); b.insertAdjacentElement("afterend", hint); }
      if (hint.textContent !== txt) hint.textContent = txt;
    });
  }
  document.addEventListener("input", function () { setTimeout(hintDisabled, 30); }, true); document.addEventListener("change", function () { setTimeout(hintDisabled, 30); }, true);
  CTG.scan = function (first) { scan(document.body, first); hintDisabled(); };

  // ---------- a failure a screen swallowed still reaches the person ----------
  // Every failed action is wrapped (CTG.wrap). If, a moment later, the screen has shown nothing at all, the guide shows its pop-up.
  var lastEl = null;
  document.addEventListener("click", function (e) { lastEl = e.target; }, true); document.addEventListener("keydown", function (e) { lastEl = e.target; }, true);
  function hostNear() { var e = lastEl; if (!e || !e.closest) return null; return e.closest("form,.zcard,.zc-card,.zc-secb,.sheet,section") || null; }
  CTG.watch = function (err, ctx) {
    try { var t0 = Date.now(), before = document.querySelectorAll("[data-ctg-done],.ctg-inline,#ctg-dialog").length; window.__ctgRetry = ctx && ctx.retry || null;
      setTimeout(function () { try {
        var count = function () { return document.querySelectorAll("[data-ctg-done],.ctg-inline,#ctg-dialog").length; };
        if (lastShownAt >= t0 || count() > before) return; CTG.scan(); if (lastShownAt >= t0 || count() > before) return;
        var c = Object.assign({}, ctx || {}), g = err && err.guide ? err.guide : CTG.explain({ status: err && err.status, message: err && err.message });
        if (g.kind === "field") { var h = hostNear(); if (h) { c.host = h; CTG.inline(h, g, c); if (g.go && g.go.field) CTG.focus(g.go.field); return; } }
        CTG.dialog(g, c);
      } catch (e) {} }, 700);
    } catch (e) {}
  };
  // ---------- nothing fails silently: an error nobody handled still gets a guide ----------
  addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason; if (!r || (!r.status && r.status !== 0 && !r.guide)) return;
    if (document.getElementById("ctg-dialog")) return;
    CTG.wrap(r); if (r.guide && r.guide.kind !== "field") CTG.dialog(r.guide);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { showBack(); CTG.scan(true); }); else setTimeout(function () { showBack(); CTG.scan(true); }, 0);
})();
