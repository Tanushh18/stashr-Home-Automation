# WhatsApp sender: random rhythm and rest days

WhatsApp's spam systems look for numbers that behave like a machine. Before this change the sender was about as
machine-like as it gets: the same number of messages every day, the first one at 10:00 sharp, then one exactly every
12 minutes (the gap was always clamped to the longest gap), seven days a week, working through each list in order.

The sender now varies every part of that, in layers. Every layer can be seen on the website (WhatsApp sender → Rest days)
and in the Android app.

## The layers

| Layer | What changes | Rules |
|---|---|---|
| **Rest days** (each week) | 2 days a week (0 to 3, your choice) when nothing goes out, not even the nightly report | Never the same weekdays as the week before; a weekday is never off three weeks running; never more than 7 sending days in a row; never more than 3 rest days in a row. Among all choices that keep these rules, one is taken at random. Next week is picked in advance, so the website can show it. |
| **The day's plan** (each day) | How many messages (a random number from 70% of the limit up to the limit); the first message at a random time after the window opens (up to 90 minutes later) and the stop at a random time before it closes (up to 60 minutes earlier) | Never above the limit or outside the window. A new plan is picked when you change the window, the limit or the gaps. |
| **Rounds and lunch** (each day) | The day's messages are split into rounds (1 for up to 3 messages, 1 to 2 for up to 6, 2 to 3 for up to 12, 2 to 4 above) spread over the day with long breaks between them; a lunch break starts between 13:00 and 14:00 and lasts 30 to 75 minutes | The first round starts at the day's start; the spare time is shared out at random between the breaks. Nothing goes out during lunch; a round that reaches lunch carries on after it. |
| **The gap** (each message, inside a round) | A different wait after every message: anywhere between the shortest and the longest gap | About 1 in 8 gaps is a longer break (1 to 3 times the longest gap on top), like a person stopping for a while. Never shorter than the shortest gap. |
| **The tablet** (each message) | It waits 3 to 9 seconds on the open chat (or the picture's preview) before pressing Send, up to 3 more for a long message, instead of pressing it the moment it appears | Picked by Stashr for each message; Stashr Hub 1.9.5 or later (an older Stashr gets 3 to 8 seconds picked by the tablet). |
| **Who is next** | One of the next 25 people in line, at random, so a list (or a run of numbers in sequence) is never worked through in order | Sheets still take turns; a tie between sheets is decided at random. |
| **What is sent** | One of the sheet's messages at random with `{name}` filled in, and one of its pictures (up to 5) at random. New: `{Hi\|Hello\|Namaste}` in a message picks one of the choices for each person, so no two texts are exactly alike | Choices can be empty (`{\|🙂}`) and can sit inside each other. |

With the defaults (13 a day, 10:00 to 18:00, gap 6 to 12 minutes) a week looks like: 5 sending days on different
weekdays each week; on each one 10 to 13 messages in 2 to 4 rounds, the first one somewhere between 10:00 and 11:30, a lunch
break somewhere from 13:00, the gaps inside a round all different (mostly 6 to 12 minutes, now and then a break of 18 to 48),
and nothing after a stop time somewhere between 17:00 and 18:00. A sample day: 10:45 two messages, 12:54 eight (stopping for
lunch 13:46 to 14:58), 16:25 two, done by 17:38.

The window's default is now 10:00 to 18:00; an account still on the old 10:00 to 19:00 default was moved to 18:00 once. A
window you set yourself is kept.

The week this change is deployed only gets its fair share of rest days (deployed on a Saturday: Sunday is off about 3 times
in 10). Full weeks start the Monday after.

### Where the randomness comes from

The operating system's random source (`crypto.randomBytes`), not `Math.random`. The picks are stored in the account's
sender settings, so every server and the website agree. Nothing can be worked out from the date or the account.

## What timing cannot fix

Timing removes the bot fingerprint, but WhatsApp weighs what the **people who get the messages** do much more than when
the messages go out. These matter more than anything in the code:

1. **Blocks and "Report" taps** are the strongest signal against a number. Everything below is about keeping them low.
2. **Give people an easy way out.** End each message with something like "Reply STOP and we won't message again". Someone
   who can say no doesn't press Report. Remove those people from the sheet.
3. **Write at least 5 different messages per sheet**, use `{name}`, and put choices in them: `{Hi|Hello|Namaste} {name}, {our new|the latest} plots {are ready|are open now}{!|.}`.
   The same text to hundreds of people is a strong spam signal. Use more than one picture as well.
4. **Message only people who asked** (the We Three leads), the fresher the better. Old or bought lists get reported.
5. **Keep the daily limit low and raise it slowly.** Start at 10 to 15 a day and add about 2 a week while there are no
   warnings. Never jump. A new or recently re-registered number should start lower still.
6. **Answer replies.** Chats where people write back make the number look like a real business.
7. **No link in the first message**, and never a link shortener.
8. **Fill in the WhatsApp Business profile** (name, photo, description, address).
9. **If WhatsApp shows a warning or a temporary restriction:** switch sending off for a few days, lower the limit, then
   start again slowly.

No sending pattern makes this risk-free. Automating the WhatsApp Business app (a tablet pressing Send) is outside
WhatsApp's terms, and a number that gets enough reports can be banned however natural its timing looks. For larger
volumes the supported route is the official WhatsApp Business Platform (Cloud API), with approved message templates and
people who opted in.

## Settings

- **Rest days a week**: None, 1, 2 (the default) or 3. Changing it picks new days for the rest of this week and next week.
- **Pick other days**: new random rest days for the rest of this week and next week. Rest days that are over stay as they were,
  and today stays a sending day once something went out today.
- **Most messages a day**, **From / To**, **Shortest / Longest gap**: as before. Each day now picks its own number, its own
  start (after From) and stop (before To), a lunch break and its rounds inside them. The website shows today's plan.
- **Test mode** ignores all of it (window, limit, gap and rest days).

## Code

- `server/utils/waRhythm.js`: the rules (rest days, the day's plan, the gap), pure functions with an injectable random source.
- `server/utils/waSender.js`: keeps the picks in `WaSettings` (`restWeeks`, `dayPlan` with its `lunch` and `rounds`), applies
  them on every minute tick, sends the tablet each message's `pauseMs`, and serves them to the website (`rhythm` in
  `GET /wa/overview`; `POST /wa/rest-days/shuffle`).
- `hub-app/.../whatsapp/WaHuman.kt`: the tablet's pause before Send (used by `WhatsAppAccessibility.waStep`).
- Tests: `server/tests/waSender.test.js` ("the rhythm (pure rules)" and "rest days and the day's plan").
