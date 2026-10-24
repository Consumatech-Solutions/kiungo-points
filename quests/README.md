# The quest board

Every core quest is a file here, named after the quest (`need.shopping_list.json`). These files are the public rules: anyone can read exactly what each activity earns, how often, and from when.

## Changing a quest

1. Add a **new version** at the end of its `versions` list, with the next number and the date it takes effect (`validFrom`). Never edit a version already published: the loader refuses that, so the past is never rewritten.
2. Open a pull request. Once the founder approves and merges it, the change is public and dated.
3. Load it: `npm run load-quests` with `DATABASE_URL` set (founder only). Activity from before the new date keeps the old version's rules.

To pause or end a quest, change its `status` to `paused` or `ended`. To add a quest, add a file.

## Fields

`questLine`, `template` (repeat, collect, steps, streak) and `building` (counts as a building activity for Fruit) can't change once published. Each version has: `title`, `watches` (the kinds of activity it counts), `target`, `period` (once, daily, weekly, monthly, quarterly), `limit` (times it pays per period), `eachItem` (`ever` or `per_period`: once per survey, course, shop…), `points`, `steps` (a challenge's stages, or a streak's milestones), `trustNeeded` and `evidence`.

Points have no cash value.
