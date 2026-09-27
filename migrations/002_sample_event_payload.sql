-- Retain the full comparable trade, including trader and source provenance.
ALTER TABLE consumer_events ADD COLUMN event JSONB NOT NULL;
