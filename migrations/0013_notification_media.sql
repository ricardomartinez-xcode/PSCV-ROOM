ALTER TABLE notifications ADD COLUMN media_url TEXT;
ALTER TABLE notifications ADD COLUMN media_type TEXT CHECK (media_type IS NULL OR media_type IN ('image','video','audio','file'));
