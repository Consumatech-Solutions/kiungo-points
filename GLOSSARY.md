# Glossary

Words used in this project's names, code and API. Use them; avoid the words in the last column.

| Term | Meaning | Avoid |
|---|---|---|
| **Kiungo** | The system Consumatech is pioneering: a network plus platforms. Always "Kiungo" or "the Kiungo system" | the Kiungo network, KIUNGO |
| **Kiungo ID** | A person's one identity. Letters, digits, `-` and `_`, up to 64 characters | user id, account |
| **Rail** | The shared ground underneath: each person's identity and activity record | platform (for the rail) |
| **Carriage** | A platform that runs on the rail (kiungo.africa, kasiPOS, Kasipages, Testify, the Telegram bot) | client, tenant |
| **Activity record** | What a person has done, on the rail. Theirs, portable | events log |
| **Entry** | One line in an activity record. The points system keeps only a reference to it | event (in the API) |
| **Quest** | A rule on the board: which activity it watches, the target, the period, the points | task, mission (except a unit mission) |
| **Quest line** | One of the eight groups of quests | category |
| **Award** | One line in the notebook: points given (or taken back by a correction) | transaction, payment |
| **Points** | Kiungo's recognition for building. No cash value | token, coin, credits, rewards |
| **Level** | Seed, Sprout, Root, Fruit, Seedkeeper | rank, tier |
| **Trust level** | Joined, vouched, verified | status |
| **Unit** | A community unit: a place-based community anchored on its shops | market, territory |
| **Streak** | *Keep it up*: weeks running in which a person said what they need. Bonus only | |
| **Run** | A streak's weeks so far. One missed week is forgiven; two in a row start a new run | chain |
| **Milestone** | A run length that pays: 4, 12 and 26 weeks | badge |
| **Evidence** | What a quest needs to see before it pays, such as a sale code. A reference, never the thing itself | proof of purchase |
| **Never earns** | Vouching, paying money and buying anything: never paid, whatever quests exist. Carriages name these kinds `vouch.…`, `payment.…`, `purchase.…` | |
| **Reader** | A carriage (or Kiungo's points system itself, `kiungo-points`) that a member allows to read something of theirs | client, consumer |
| **Mark** | A lasting recognition: Founding member (joined before 1 January 2030), or first in a unit, country or language (a first is freed for the next member if its award is corrected) | badge, achievement |
| **Flag** | A note that a pattern looks unusual, for a person to review. Never a penalty | strike, ban |
| **Follows** | A quest that pays for an item only once another quest has paid the member for the same item (`after`); until then, `needs_earlier_quest`, and the entry waits: it is paid as soon as the other quest pays | depends on |
