-- T-02 the quest board and templates. Quests are versioned data; a version with no valid_from is a draft.

ALTER TABLE quests
  ADD COLUMN template text NOT NULL DEFAULT 'repeat'
    CHECK (template IN ('repeat', 'collect', 'steps', 'streak', 'mission')),
  ADD COLUMN building boolean NOT NULL DEFAULT false;  -- counts as a building activity (Fruit, T-05)

ALTER TABLE quest_versions
  ADD COLUMN title text NOT NULL DEFAULT '',
  ADD COLUMN each_item text CHECK (each_item IN ('ever', 'per_period')),  -- once per survey, course, shop…
  ADD COLUMN period_limit integer CHECK (period_limit > 0),                -- completions allowed per period
  ADD COLUMN steps jsonb,                                                  -- Steps: the stages; Streak: the milestones
  ALTER COLUMN watches TYPE text[] USING ARRAY[watches],
  ALTER COLUMN points DROP NOT NULL,                                       -- Steps and Streak carry their points per step
  ALTER COLUMN valid_from DROP NOT NULL,
  ALTER COLUMN valid_from DROP DEFAULT,
  DROP CONSTRAINT quest_versions_period_check,
  ADD CONSTRAINT quest_versions_period_check
    CHECK (period IN ('once', 'daily', 'weekly', 'monthly', 'quarterly'));

UPDATE quest_versions SET title = 'Confirm your phone' WHERE quest_id = 'identity.phone_confirmed';

-- The core quests: quest lines 1 to 7 of activities.md.
CREATE TEMPORARY TABLE core (
  id text, line text, title text, period text, lim integer, each text, points integer, trust text, building boolean
);
INSERT INTO core VALUES
  ('picture.name',             'picture',  'Choose your name on Kiungo',               'once',      NULL, NULL,         5,   'joined',   false),
  ('picture.look',             'picture',  'Create your look',                         'once',      NULL, NULL,         10,  'joined',   false),
  ('picture.privacy',          'picture',  'Choose who sees what',                     'once',      NULL, NULL,         10,  'joined',   false),
  ('picture.age_range',        'picture',  'Your age range',                           'once',      NULL, NULL,         5,   'joined',   false),
  ('picture.from',             'picture',  'Where you''re from',                       'once',      NULL, NULL,         5,   'joined',   false),
  ('picture.lives',            'picture',  'Where you live now',                       'once',      NULL, NULL,         10,  'joined',   false),
  ('picture.languages',        'picture',  'The languages you speak',                  'once',      NULL, NULL,         5,   'joined',   false),
  ('picture.household',        'picture',  'Your household',                           'once',      NULL, NULL,         10,  'joined',   false),
  ('picture.work',             'picture',  'What you do',                              'once',      NULL, NULL,         5,   'joined',   false),
  ('picture.joining_as',       'picture',  'What you''re joining as',                  'once',      NULL, NULL,         5,   'joined',   false),
  ('unit.joined',              'picture',  'Join your community unit or a group',      'once',      NULL, 'ever',       10,  'joined',   false),
  ('need.shopping_list',       'needs',    'Share your shopping list',                 'weekly',    2,    NULL,         10,  'joined',   false),
  ('need.bought_week',         'needs',    'What you bought in the last 7 days',       'weekly',    1,    NULL,         10,  'joined',   false),
  ('need.bought_month',        'needs',    'What you bought this month',               'monthly',   1,    NULL,         20,  'joined',   false),
  ('need.service_rated',       'needs',    'A service you use and what you think of it', 'quarterly', NULL, 'per_period', 10, 'joined',   false),
  ('need.survey',              'needs',    'What your household or business needs',    'once',      NULL, 'ever',       15,  'joined',   false),
  ('need.close_to_home',       'needs',    'What you''d buy close to home',            'monthly',   1,    NULL,         10,  'joined',   false),
  ('need.community_question',  'needs',    'The monthly community question',           'monthly',   1,    NULL,         15,  'joined',   false),
  ('offer.saved',              'offers',   'Say what you can offer',                   'once',      NULL, NULL,         20,  'joined',   false),
  ('offer.updated',            'offers',   'Keep it up to date',                       'quarterly', 1,    NULL,         5,   'joined',   false),
  ('offer.ready_now',          'offers',   'Say what you have ready now',              'weekly',    2,    NULL,         5,   'joined',   false),
  ('business.identity_opened', 'business', 'Start or bring in your business',          'once',      NULL, 'ever',       100, 'vouched',  true),
  ('business.page_completed',  'business', 'Complete your business page',              'once',      NULL, 'ever',       50,  'vouched',  false),
  ('business.shop_onboarded',  'business', 'Bring your shop onto kasiPOS',             'once',      NULL, 'ever',       150, 'vouched',  false),
  ('business.agent_active',    'business', 'Take up the role of an agent',             'once',      NULL, 'ever',       150, 'verified', false),
  ('business.course_completed','business', 'Complete an academy course',               'once',      NULL, 'ever',       50,  'joined',   false),
  ('business.course_on_time',  'business', 'Complete it within the set time',          'once',      NULL, 'ever',       25,  'joined',   false),
  ('business.franchise_launched','business','Launch a digital franchise',              'once',      NULL, 'ever',       200, 'vouched',  false),
  ('business.trading_month',   'business', 'A month of active trading',                'monthly',   1,    NULL,         20,  'vouched',  false),
  ('invite.joined',            'invites',  'Someone you invited joins and takes part', 'daily',     3,    'ever',       10,  'joined',   false),
  ('invite.sprout',            'invites',  'Someone you invited reaches Sprout',       'once',      NULL, 'ever',       10,  'joined',   false),
  ('invite.shop_live',         'invites',  'A shop you brought in goes live',          'once',      NULL, 'ever',       25,  'vouched',  false),
  ('share.card_first',         'sharing',  'Share your card for the first time',       'once',      NULL, NULL,         20,  'joined',   false),
  ('share.level',              'sharing',  'Share your new level',                     'once',      NULL, 'ever',       10,  'joined',   false),
  ('share.post',               'sharing',  'Share a Kiungo post or video',             'weekly',    2,    NULL,         5,   'joined',   false),
  ('build.translation_approved','building','A piece you translated is approved',       'once',      NULL, 'ever',       30,  'joined',   true),
  ('build.translation_reviewed','building','A translation you reviewed is published',  'once',      NULL, 'ever',       15,  'vouched',  true),
  ('build.consultation',       'building', 'Answer a question about Kiungo''s direction', 'once',   NULL, 'ever',       15,  'joined',   true),
  ('build.idea_taken_up',      'building', 'An idea of yours is taken up',             'once',      NULL, 'ever',       50,  'joined',   true),
  ('build.mistake_fixed',      'building', 'Report a mistake that gets fixed',         'monthly',   5,    'ever',       10,  'joined',   true),
  ('rating.verified',          'building', 'Rate a business you bought from',          'weekly',    5,    'ever',       5,   'joined',   false),
  ('rating.perception',        'building', 'Rate a brand or business',                 'weekly',    10,   NULL,         2,   'joined',   false),
  ('unit.telegram_joined',     'building', 'Join your unit''s Telegram group',         'once',      NULL, 'ever',       10,  'joined',   false);

INSERT INTO quests (id, quest_line, status, template, building) SELECT id, line, 'live', 'repeat', building FROM core;
INSERT INTO quest_versions (quest_id, version, title, watches, target, period, period_limit, each_item, points, trust_needed, valid_from)
  SELECT id, 1, title, ARRAY[id], 1, period, lim, each, points, trust, '2026-01-01T00:00:00Z' FROM core;
DROP TABLE core;

-- Your picture is complete: every section answered (Collect).
INSERT INTO quests (id, quest_line, status, template) VALUES ('picture.complete', 'picture', 'live', 'collect');
INSERT INTO quest_versions (quest_id, version, title, watches, target, period, points, trust_needed, valid_from)
  VALUES ('picture.complete', 1, 'Your picture is complete',
    ARRAY['identity.phone_confirmed', 'picture.name', 'picture.look', 'picture.privacy', 'picture.age_range',
          'picture.from', 'picture.lives', 'picture.languages', 'picture.household', 'picture.work',
          'picture.joining_as', 'unit.joined'],
    12, 'once', 25, 'joined', '2026-01-01T00:00:00Z');
