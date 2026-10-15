CREATE DATABASE IF NOT EXISTS restasurya
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE restasurya;

CREATE TABLE IF NOT EXISTS wedding_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  date_iso DATETIME NOT NULL,
  date_label VARCHAR(120) NOT NULL,
  address VARCHAR(500) NOT NULL,
  intro TEXT NOT NULL,
  cover_image VARCHAR(500) NOT NULL,
  music_path VARCHAR(500) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS couples (
  id CHAR(36) NOT NULL PRIMARY KEY,
  wedding_id TINYINT UNSIGNED NOT NULL,
  role ENUM('bride', 'groom') NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  nickname VARCHAR(80) NOT NULL,
  parents VARCHAR(200) NOT NULL,
  child_order VARCHAR(80) NOT NULL,
  photo_path VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_couples_wedding_role (wedding_id, role),
  CONSTRAINT fk_couples_wedding FOREIGN KEY (wedding_id)
    REFERENCES wedding_settings (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  wedding_id TINYINT UNSIGNED NOT NULL,
  slug VARCHAR(40) NOT NULL,
  title VARCHAR(100) NOT NULL,
  event_date DATETIME NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  address VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_events_wedding_slug (wedding_id, slug),
  CONSTRAINT fk_events_wedding FOREIGN KEY (wedding_id)
    REFERENCES wedding_settings (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gallery_photos (
  id CHAR(36) NOT NULL PRIMARY KEY,
  wedding_id TINYINT UNSIGNED NOT NULL,
  image_path VARCHAR(500) NOT NULL,
  alt_text VARCHAR(160) NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_gallery_wedding_order (wedding_id, sort_order),
  CONSTRAINT fk_gallery_wedding FOREIGN KEY (wedding_id)
    REFERENCES wedding_settings (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS love_story (
  id CHAR(36) NOT NULL PRIMARY KEY,
  wedding_id TINYINT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  story_text TEXT NOT NULL,
  story_date VARCHAR(80) NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_story_wedding_order (wedding_id, sort_order),
  CONSTRAINT fk_story_wedding FOREIGN KEY (wedding_id)
    REFERENCES wedding_settings (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wedding_gift_accounts (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  bank_name VARCHAR(80) NULL,
  account_number VARCHAR(34) NOT NULL,
  account_name VARCHAR(160) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_gift_account_id CHECK (id = 1)
);

-- Keep these existing table names and row formats so earlier RSVP/wish data
-- remains available. Do not drop or recreate either table during migration.
CREATE TABLE IF NOT EXISTS wedding_rsvps (
  id CHAR(36) NOT NULL PRIMARY KEY,
  guest_name VARCHAR(100) NOT NULL,
  attendance ENUM('Hadir', 'Tidak hadir', 'Belum pasti') NOT NULL,
  guest_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  message VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rsvps_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS wedding_wishes (
  id CHAR(36) NOT NULL PRIMARY KEY,
  guest_name VARCHAR(100) NOT NULL,
  message VARCHAR(700) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_wishes_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS wedding_gift_reports (
  id CHAR(36) NOT NULL PRIMARY KEY,
  guest_name VARCHAR(100) NOT NULL,
  amount DECIMAL(18, 0) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (amount > 0),
  KEY idx_gift_reports_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  password_hash VARCHAR(200) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  UNIQUE KEY uq_admin_users_username (username),
  KEY idx_admin_users_active (is_active)
);

CREATE TABLE IF NOT EXISTS daftar_undangan (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nama_undangan VARCHAR(255) NULL,
  alamat_undangan VARCHAR(255) NULL,
  no_wa VARCHAR(255) NULL
);

INSERT IGNORE INTO wedding_settings
  (id, title, date_iso, date_label, address, intro, cover_image, music_path)
VALUES
  (1, 'Resta & Surya',
   '2026-11-29 08:00:00',
   'Minggu, 29 November 2026',
   'Jalan Jenderal Sudirman, Kelurahan Kota Kulon, Kecamatan Garut Kota, Kabupaten Garut, Jawa Barat 44112',
   'Dengan memanjatkan syukur kepada Tuhan Yang Maha Esa, kami mengundang Bapak/Ibu/Saudara/i untuk hadir menyaksikan momen spiritual dan bahagia dalam rangkaian pernikahan kami.',
   '/images/photo1.jpeg',
   '/audio/Resta%20dan%20Surya.mp3');

INSERT IGNORE INTO wedding_gift_accounts (id, bank_name, account_number, account_name)
VALUES (1, 'BCA', '1482351390', 'Resta Syahwa Hafidza');

UPDATE wedding_gift_accounts
SET bank_name = 'BCA'
WHERE id = 1 AND (bank_name IS NULL OR TRIM(bank_name) = '');

UPDATE wedding_settings
SET music_path = '/audio/Resta%20dan%20Surya.mp3'
WHERE id = 1 AND music_path = '/audio/wedding-music.mp3';

INSERT IGNORE INTO couples
  (id, wedding_id, role, full_name, nickname, parents, child_order, photo_path)
VALUES
  ('10000000-0000-4000-8000-000000000001', 1, 'bride',
   'Resta Syahwa Hafidza', 'Reres', 'Reza Cahniadi & Rosita',
   'Putri pertama', '/images/photo2.jpeg'),
  ('10000000-0000-4000-8000-000000000002', 1, 'groom',
   'Surya Maulana', 'Surya', 'Ato Sudrajat & Deuis Janah',
   'Putra pertama', '/images/photo3.jpeg');

INSERT IGNORE INTO events
  (id, wedding_id, slug, title, event_date, start_time, end_time, address)
VALUES
  ('20000000-0000-4000-8000-000000000001', 1, 'akad',
   'Akad Nikah', '2026-11-29 00:00:00', '08:00:00', '09:00:00',
   'Jalan Jenderal Sudirman, Kelurahan Kota Kulon, Kecamatan Garut Kota, Kabupaten Garut, Jawa Barat 44112'),
  ('20000000-0000-4000-8000-000000000002', 1, 'resepsi',
   'Resepsi', '2026-11-29 00:00:00', '11:00:00', '15:00:00',
   'Jalan Jenderal Sudirman, Kelurahan Kota Kulon, Kecamatan Garut Kota, Kabupaten Garut, Jawa Barat 44112');

INSERT IGNORE INTO gallery_photos
  (id, wedding_id, image_path, alt_text, sort_order)
VALUES
  ('30000000-0000-4000-8000-000000000001', 1, '/images/photo1.jpeg', 'Momen Resta dan Surya 1', 1),
  ('30000000-0000-4000-8000-000000000002', 1, '/images/photo2.jpeg', 'Momen Resta dan Surya 2', 2),
  ('30000000-0000-4000-8000-000000000003', 1, '/images/photo3.jpeg', 'Momen Resta dan Surya 3', 3),
  ('30000000-0000-4000-8000-000000000004', 1, '/images/photo4.jpeg', 'Momen Resta dan Surya 4', 4);

INSERT IGNORE INTO love_story
  (id, wedding_id, title, story_text, story_date, sort_order)
VALUES
  ('40000000-0000-4000-8000-000000000001', 1, 'Dua hati, satu tujuan',
   'Dengan penuh rasa syukur, Resta dan Surya mengundang keluarga serta sahabat untuk menjadi bagian dari hari bahagia mereka.',
   NULL, 1);
