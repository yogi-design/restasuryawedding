-- Legacy two-table setup retained for existing installations.
-- New installs and full MySQL migration should use database/schema.sql.
CREATE DATABASE IF NOT EXISTS restasurya CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE restasurya;

CREATE TABLE IF NOT EXISTS wedding_rsvps (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  guest_name VARCHAR(100) NOT NULL,
  attendance ENUM('Hadir', 'Tidak hadir', 'Belum pasti') NOT NULL,
  guest_count INT NOT NULL DEFAULT 0,
  message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (guest_count >= 0 AND guest_count <= 4),
  CHECK (CHAR_LENGTH(TRIM(guest_name)) BETWEEN 1 AND 100)
);

CREATE TABLE IF NOT EXISTS wedding_wishes (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  guest_name VARCHAR(100) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (CHAR_LENGTH(TRIM(guest_name)) BETWEEN 1 AND 100),
  CHECK (CHAR_LENGTH(TRIM(message)) BETWEEN 1 AND 700)
);
