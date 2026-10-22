-- T-03b weekly streaks: "Keep it up" (activities.md §8b). Bonus only; one missed week forgiven.
INSERT INTO quests (id, quest_line, status, template) VALUES ('streak.need_weekly', 'needs', 'live', 'streak');
INSERT INTO quest_versions (quest_id, version, title, watches, target, period, steps, trust_needed, valid_from)
  VALUES ('streak.need_weekly', 1, 'Keep it up',
    ARRAY['need.shopping_list', 'need.bought_week', 'need.bought_month', 'need.service_rated', 'need.survey',
          'need.close_to_home', 'need.community_question'],
    26, 'once', '[{"weeks": 4, "points": 20}, {"weeks": 12, "points": 50}, {"weeks": 26, "points": 100}]',
    'joined', '2026-01-01T00:00:00Z');
