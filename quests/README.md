# The quest board

Every core quest is a file here, named after the quest (`need.shopping_list.json`). These files are the public rules: anyone can read exactly what each activity earns, how often, and from when.

## Changing a quest

1. Add a **new version** at the end of its `versions` list, with the next number and the date it takes effect (`validFrom`). Never edit a version already published: the loader refuses that, so the past is never rewritten.
2. Open a pull request. Once the founder approves and merges it, the change is public and dated.
3. Load it: `npm run load-quests`, with `DATABASE_URL` set to the database's connection address from your database provider (founder only). A new version can't be dated back over activity already counted, so activity always keeps the rules it was counted under. If anything is wrong, nothing is changed and the message says which file.

To pause or end a quest, change its `status` to `paused` or `ended`. Ending is for good: an ended quest can't come back (make a new quest instead).

Write each version out in full, exactly as it runs (for example a weekly quest's `limit`, a step's `upTo` and `period`): the loader refuses a version that leaves anything implied, and says what it expected. To add a quest, add a file.

## Fields

`questLine` and `template` (repeat, collect, steps, streak) can't change once published. `building` (counts as a building activity for Fruit) can be switched on by pull request, never off, so members keep credit for what they've done. It changes only through these files. Each version has: `title`, `watches` (the kinds of activity it counts), `target`, `period` (once, daily, weekly, monthly, quarterly), `limit` (times it pays per period), `eachItem` (`ever` or `per_period`: once per survey, course, shop…), `points`, `steps` (a challenge's stages, or a streak's milestones), `trustNeeded`, `evidence`, and optionally `after`: another quest it follows, paying for an item only once that quest has paid for the same item (a comment on a verified rating pays only after the rating has).

Points have no cash value.
