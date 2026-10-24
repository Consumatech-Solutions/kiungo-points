// Loads quests/*.json into the database named by DATABASE_URL. Run by the founder after migrations: npm run load-quests
import { readdirSync, readFileSync } from 'node:fs';
import { postgresDb } from '../src/db';
import { loadQuests, QuestFile } from '../src/quests/files';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to the database to load the quests into (from your database provider\'s dashboard).');
const files = readdirSync('quests').filter((f) => f.endsWith('.json')).sort().map((name) => {
  const parsed = QuestFile.safeParse(JSON.parse(readFileSync(`quests/${name}`, 'utf8')));
  if (!parsed.success) throw new Error(`quests/${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  return parsed.data;
});
try {
  const changed = await loadQuests(postgresDb(url), files);
  console.log(changed.length ? changed.join('\n') : 'Nothing new: the database already matches the quest files.');
  process.exit(0);
} catch (err) {
  console.error(`Nothing was changed. ${(err as Error).message}`);
  process.exit(1);
}
