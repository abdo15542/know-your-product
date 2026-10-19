CREATE TABLE IF NOT EXISTS products (
  barcode TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'imported',
  source_url TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_modified_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS products_name_search_idx ON products USING GIN (to_tsvector('simple', name || ' ' || brand));
CREATE TABLE IF NOT EXISTS contributions (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  barcode TEXT NOT NULL DEFAULT '',
  usage TEXT NOT NULL DEFAULT '',
  ingredients TEXT NOT NULL DEFAULT '',
  warnings TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS contributions_status_created_idx ON contributions(status, created_at DESC);
