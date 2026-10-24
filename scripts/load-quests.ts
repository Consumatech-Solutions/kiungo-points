// Loads quests/*.json into the database named by DATABASE_URL. Run by the founder after migrations: npm run load-quests
import { readdirSync, readFileSync } from 'node:fs';
import { postgresDb } from '../src/db';
import { loadQuests, QuestFile } from '../src/quests/files';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to the database to load the quests into.');
const files = readdirSync('quests').filter((f) => f.endsWith('.json')).sort()
  .map((f) => QuestFile.parse(JSON.parse(readFileSync(`quests/${f}`, 'utf8'))));
const added = await loadQuests(postgresDb(url), files);
console.log(added.length ? `Added: ${added.join(', ')}` : 'Nothing new: the database already matches the quest files.');
process.exit(0);
