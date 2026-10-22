# kiungo-points

The Kiungo points system: quests, levels and a permanent record of points, for the Kiungo system that Consumatech is pioneering.

**Points have no cash value.** They can't be bought, sold, transferred or exchanged for money.

## How it fits

What people do is theirs. Carriages (kiungo.africa, kasiPOS, Kasipages, Testify and others) write it to each person's **activity record on the rail**, next to their identity. With the person's permission, this points system reads that record, checks it against the public quest board, and gives points. It never keeps anyone's activity, only a reference to each entry it has read.

Until the identity and activity rails exist, **stand-ins** play their part (`src/standin`). The points system goes live for real members only once the real rails exist.

The code is published under Apache 2.0 so anyone can check that points are given exactly as the quest board says.

## The blueprint

The technical requirements, decision records and tickets are in the kiungo.africa repository: [`docs/gamification/engine/`](https://github.com/Consumatech-Solutions/kiungo-africa-site/tree/main/docs/gamification/engine). Tickets live in this repository's issues.

## Run the tests

```bash
npm install
npm test
```

Tests run against PGlite, a PostgreSQL that runs inside the test process, so nothing else needs installing.

## Set-up (founder only)

1. Create a managed PostgreSQL database and run the files in `migrations/` in order.
2. In the Cloudflare dashboard, create a Hyperdrive for it and put its id in `wrangler.jsonc`.
3. Set the `ADMIN_KEY` secret in the Cloudflare dashboard. Never in code or chat.
