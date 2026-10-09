import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { pool, pingDb } from './db.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const allowedOrigins = new Set(
  (process.env.WEB_ORIGIN || 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const rateLimitBuckets = new Map();

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin));
  },
}));
app.use(express.json({ limit: '1mb' }));

const limitSubmissions = (req, res, next) => {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxRequests = 8;
  const key = req.ip;
  const current = rateLimitBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  if (bucket.count > maxRequests) {
    res.set('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Terlalu banyak pengiriman. Silakan coba kembali beberapa saat lagi.' });
  }

  if (rateLimitBuckets.size > 1000) {
    for (const [ip, entry] of rateLimitBuckets) {
      if (entry.resetAt <= now) rateLimitBuckets.delete(ip);
    }
  }

  next();
};

app.get('/api/health', async (_req, res) => {
  try {
    await pingDb();
    res.json({ ok: true, database: process.env.MYSQL_DATABASE || 'restasurya' });
  } catch {
    res.status(503).json({ ok: false, message: 'Database connection failed' });
  }
});

app.get('/api/invitation', async (_req, res) => {
  try {
    const [[settings], couples, events, gallery, loveStory] = await Promise.all([
      pool.query(
        `SELECT title, DATE_FORMAT(date_iso, '%Y-%m-%dT%H:%i:%s') AS date_iso,
                date_label, address, intro, cover_image, music_path
         FROM wedding_settings WHERE id = 1 LIMIT 1`
      ).then(([rows]) => rows),
      pool.query(
        `SELECT role, full_name, nickname, parents, child_order, photo_path
         FROM couples WHERE wedding_id = 1 ORDER BY FIELD(role, 'bride', 'groom')`
      ).then(([rows]) => rows),
      pool.query(
        `SELECT slug, title, DATE_FORMAT(event_date, '%Y-%m-%d') AS event_date,
                TIME_FORMAT(start_time, '%H:%i:%s') AS start_time,
                TIME_FORMAT(end_time, '%H:%i:%s') AS end_time, address
         FROM events WHERE wedding_id = 1 ORDER BY start_time`
      ).then(([rows]) => rows),
      pool.query(
        `SELECT image_path, alt_text FROM gallery_photos
         WHERE wedding_id = 1 ORDER BY sort_order, created_at`
      ).then(([rows]) => rows),
      pool.query(
        `SELECT title, story_text, story_date FROM love_story
         WHERE wedding_id = 1 ORDER BY sort_order, created_at`
      ).then(([rows]) => rows),
    ]);

    if (!settings || couples.length !== 2 || events.length < 2) {
      return res.status(503).json({ message: 'Data undangan belum lengkap. Jalankan database/schema.sql.' });
    }

    const toEvent = (event) => ({
      title: event.title,
      time: event.slug === 'resepsi'
        ? `${event.start_time.slice(0, 5).replace(':', '.')}–${event.end_time.slice(0, 5).replace(':', '.')} WIB`
        : `${event.start_time.slice(0, 5).replace(':', '.')} WIB`,
      start: `${event.event_date}T${event.start_time}+07:00`,
      end: `${event.event_date}T${event.end_time}+07:00`,
      address: event.address,
    });
    const bride = couples.find((couple) => couple.role === 'bride');
    const groom = couples.find((couple) => couple.role === 'groom');
    const akad = events.find((event) => event.slug === 'akad');
    const reception = events.find((event) => event.slug === 'resepsi');

    if (!bride || !groom || !akad || !reception) {
      return res.status(503).json({ message: 'Data undangan belum lengkap. Jalankan database/schema.sql.' });
    }

    res.json({
      bride: {
        fullName: bride.full_name,
        nickname: bride.nickname,
        parents: bride.parents,
        childOrder: bride.child_order,
      },
      groom: {
        fullName: groom.full_name,
        nickname: groom.nickname,
        parents: groom.parents,
        childOrder: groom.child_order,
      },
      dateISO: `${settings.date_iso}+07:00`,
      dateLabel: settings.date_label,
      address: settings.address,
      intro: settings.intro,
      akad: toEvent(akad),
      reception: toEvent(reception),
      photos: {
        cover: settings.cover_image,
        bride: bride.photo_path,
        groom: groom.photo_path,
        gallery: gallery.map((photo) => photo.image_path),
        galleryAlt: gallery.map((photo) => photo.alt_text),
      },
      loveStory: loveStory.map((story) => ({
        title: story.title,
        text: story.story_text,
        date: story.story_date,
      })),
      musicPath: settings.music_path,
    });
  } catch (error) {
    console.error('Invitation query failed:', error.code || error.name);
    res.status(500).json({ message: 'Gagal memuat data undangan dari database.' });
  }
});

app.get('/api/wishes', async (_req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, guest_name AS name, message, created_at FROM wedding_wishes ORDER BY created_at DESC LIMIT 30'
    );
    res.json(rows);
  } catch (error) {
    console.error('Wishes query failed:', error.code || error.name);
    res.status(500).json({ message: 'Gagal memuat ucapan.' });
  }
});

app.post('/api/rsvps', limitSubmissions, async (req, res) => {
  const { guest_name, attendance, guest_count, message } = req.body || {};
  const name = typeof guest_name === 'string' ? guest_name.trim() : '';
  const note = typeof message === 'string' ? message.trim() : '';
  const guestCount = Number(guest_count);
  const validAttendance = ['Hadir', 'Tidak hadir', 'Belum pasti'].includes(attendance);

  if (!name || name.length > 100) {
    return res.status(400).json({ message: 'Nama wajib diisi dan maksimal 100 karakter.' });
  }
  if (!validAttendance) {
    return res.status(400).json({ message: 'Pilihan kehadiran tidak valid.' });
  }
  if (!Number.isInteger(guestCount) || (attendance === 'Hadir' && (guestCount < 1 || guestCount > 4)) || (attendance !== 'Hadir' && guestCount !== 0)) {
    return res.status(400).json({ message: 'Jumlah tamu harus 1–4 untuk hadir dan 0 jika tidak hadir.' });
  }
  if (typeof message !== 'undefined' && message !== null && typeof message !== 'string') {
    return res.status(400).json({ message: 'Pesan RSVP tidak valid.' });
  }
  if (note.length > 500) {
    return res.status(400).json({ message: 'Pesan maksimal 500 karakter.' });
  }

  try {
    await pool.query(
      `INSERT INTO wedding_rsvps (id, guest_name, attendance, guest_count, message)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), name, attendance, guestCount, note || null]
    );

    res.status(201).json({ message: 'Konfirmasi kehadiran berhasil dikirim.' });
  } catch (error) {
    console.error('RSVP insert failed:', error.code || error.name);
    res.status(500).json({ message: 'Gagal menyimpan RSVP.' });
  }
});

app.post('/api/rsvp-and-wish', limitSubmissions, async (req, res) => {
  const { guest_name, attendance, guest_count, message } = req.body || {};
  const name = typeof guest_name === 'string' ? guest_name.trim() : '';
  const note = typeof message === 'string' ? message.trim() : '';
  const guestCount = Number(guest_count);
  const validAttendance = ['Hadir', 'Tidak hadir', 'Belum pasti'].includes(attendance);

  if (!name || name.length > 100) {
    return res.status(400).json({ message: 'Nama wajib diisi dan maksimal 100 karakter.' });
  }
  if (!validAttendance) {
    return res.status(400).json({ message: 'Pilihan kehadiran tidak valid.' });
  }
  if (!Number.isInteger(guestCount) || (attendance === 'Hadir' && (guestCount < 1 || guestCount > 4)) || (attendance !== 'Hadir' && guestCount !== 0)) {
    return res.status(400).json({ message: 'Jumlah tamu harus 1–4 untuk hadir dan 0 jika tidak hadir.' });
  }
  if (!note || note.length > 500) {
    return res.status(400).json({ message: 'Ucapan wajib diisi dan maksimal 500 karakter.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const rsvpId = randomUUID();
    const wishId = randomUUID();

    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO wedding_rsvps (id, guest_name, attendance, guest_count, message)
       VALUES (?, ?, ?, ?, ?)`,
      [rsvpId, name, attendance, guestCount, note]
    );
    await connection.query(
      'INSERT INTO wedding_wishes (id, guest_name, message) VALUES (?, ?, ?)',
      [wishId, name, note]
    );
    await connection.commit();

    res.status(201).json({
      message: 'RSVP dan ucapan berhasil dikirim.',
      item: { id: wishId, name, message: note },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Combined RSVP and wish rollback failed:', rollbackError.code || rollbackError.name);
      }
    }
    console.error('Combined RSVP and wish insert failed:', error.code || error.name);
    res.status(500).json({ message: 'RSVP dan ucapan belum tersimpan. Silakan coba kembali.' });
  } finally {
    connection?.release();
  }
});

app.post('/api/wishes', limitSubmissions, async (req, res) => {
  const { guest_name, message } = req.body || {};
  const name = typeof guest_name === 'string' ? guest_name.trim() : '';
  const text = typeof message === 'string' ? message.trim() : '';

  if (!name || name.length > 100) {
    return res.status(400).json({ message: 'Nama wajib diisi dan maksimal 100 karakter.' });
  }
  if (!text || text.length > 700) {
    return res.status(400).json({ message: 'Ucapan wajib diisi dan maksimal 700 karakter.' });
  }

  try {
    const id = randomUUID();
    const [result] = await pool.query(
      'INSERT INTO wedding_wishes (id, guest_name, message) VALUES (?, ?, ?)',
      [id, name, text]
    );

    res.status(201).json({
      message: 'Ucapan berhasil dikirim.',
      item: { id: id || result.insertId, name, message: text },
    });
  } catch (error) {
    console.error('Wish insert failed:', error.code || error.name);
    res.status(500).json({ message: 'Gagal menyimpan ucapan.' });
  }
});

app.use((err, _req, res, _next) => {
  console.error('API request failed:', err.message);
  res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
});

const start = async () => {
  try {
    await pingDb();
    app.listen(port, () => {
      console.log(`Wedding API running on http://localhost:${port}`);
    });
  } catch {
    console.error('Database connection failed. Check the MySQL server and local environment settings.');
    console.log('Create/migrate tables using database/schema.sql.');
    process.exit(1);
  }
};

start();
