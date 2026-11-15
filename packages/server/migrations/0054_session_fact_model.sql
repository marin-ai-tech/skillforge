-- session-fact-model: the model that called the skill (lower case, validated), NULL when not reported or dropped
ALTER TABLE session_facts ADD COLUMN model TEXT;
