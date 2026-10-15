import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
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
  credentials: true,
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

const adminCookieName = 'resta_admin_session';
const adminSessionDuration = 8 * 60 * 60 * 1000;
const adminPasswordHashBytes = 64;

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');
  return leftBuffer.length === rightBuffer.length && leftBuffer.length > 0
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAdminUsernameValid(username) {
  return typeof username === 'string' && /^[A-Za-z0-9._-]{3,50}$/.test(username);
}

function cleanInvitationInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { nama_undangan: name, alamat_undangan: address, no_wa: phone } = value;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 255) return null;
  if (address !== undefined && address !== null && typeof address !== 'string') return null;
  if (phone !== undefined && phone !== null && typeof phone !== 'string') return null;
  const cleanAddress = typeof address === 'string' ? address.trim() : '';
  const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
  if (cleanAddress.length > 255 || cleanPhone.length > 255) return null;
  return {
    nama_undangan: name.trim(),
    alamat_undangan: cleanAddress,
    no_wa: cleanPhone,
  };
}

function createPasswordHash(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, adminPasswordHashBytes);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const [algorithm, saltHex, hashHex, extra] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex || extra !== undefined
      || !/^[\da-f]{32}$/i.test(saltHex)
      || !/^[\da-f]{128}$/i.test(hashHex)) {
    return false;
  }

  const expectedHash = Buffer.from(hashHex, 'hex');
  const actualHash = scryptSync(password, Buffer.from(saltHex, 'hex'), adminPasswordHashBytes);
  return timingSafeEqual(actualHash, expectedHash);
}

function signAdminPayload(payload) {
  if ((process.env.ADMIN_SESSION_SECRET || '').length < 32) {
    throw new Error('ADMIN_SESSION_SECRET harus memiliki minimal 32 karakter.');
  }
  return createHmac('sha256', process.env.ADMIN_SESSION_SECRET)
    .update(payload)
    .digest('hex');
}

function createAdminToken(admin) {
  const payload = Buffer.from(JSON.stringify({
    id: admin.id,
    username: admin.username,
    expiresAt: Date.now() + adminSessionDuration,
  })).toString('base64url');
  return `${payload}.${signAdminPayload(payload)}`;
}

function adminTokenIsValid(token) {
  const separator = token.lastIndexOf('.');
  if (separator < 1) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, signAdminPayload(payload))) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof session.id === 'string'
      && typeof session.username === 'string'
      && Number.isFinite(session.expiresAt)
      && session.expiresAt > Date.now()
      ? session
      : null;
  } catch {
    return null;
  }
}

function getAdminToken(req) {
  const cookies = req.headers.cookie || '';
  const cookie = cookies.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${adminCookieName}=`));
  return cookie ? cookie.slice(adminCookieName.length + 1) : '';
}

async function requireAdmin(req, res, next) {
  if ((process.env.ADMIN_SESSION_SECRET || '').length < 32) {
    return res.status(503).json({ message: 'Konfigurasi ADMIN_SESSION_SECRET belum lengkap di server.' });
  }
  const session = adminTokenIsValid(getAdminToken(req));
  if (!session) {
    return res.status(401).json({ message: 'Sesi admin tidak valid atau sudah berakhir.' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT id, username, is_active FROM admin_users WHERE id = ? LIMIT 1',
      [session.id]
    );
    const admin = rows[0];
    if (!admin || !admin.is_active || admin.username !== session.username) {
      return res.status(401).json({ message: 'Akun admin tidak aktif atau sesi telah dicabut.' });
    }
    req.admin = { id: admin.id, username: admin.username };
    next();
  } catch (error) {
    console.error('Admin session lookup failed:', error.code || error.name);
    res.status(500).json({ message: 'Tidak dapat memverifikasi sesi admin.' });
  }
}

function requireAllowedOrigin(req, res, next) {
  if (!allowedOrigins.has(req.get('origin'))) {
    return res.status(403).json({ message: 'Origin tidak diizinkan.' });
  }
  next();
}

function setAdminCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  res.set('Set-Cookie', `${adminCookieName}=${token}; HttpOnly; Path=/api/admin; SameSite=${sameSite}; Max-Age=${adminSessionDuration / 1000}${secure ? '; Secure' : ''}`);
}

function clearAdminCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const sameSite = secure ? 'None' : 'Lax';
  res.set('Set-Cookie', `${adminCookieName}=; HttpOnly; Path=/api/admin; SameSite=${sameSite}; Max-Age=0${secure ? '; Secure' : ''}`);
}

function isValidEventDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

async function loadAdminDashboard() {
  const [[settings], couples, [giftAccount], rsvps, giftReports] = await Promise.all([
    pool.query(
      `SELECT DATE_FORMAT(date_iso, '%Y-%m-%d') AS event_date,
              date_label, address
       FROM wedding_settings WHERE id = 1 LIMIT 1`
    ).then(([rows]) => rows),
    pool.query(
      `SELECT role, full_name FROM couples
       WHERE wedding_id = 1 ORDER BY FIELD(role, 'bride', 'groom')`
    ).then(([rows]) => rows),
    pool.query(
      `SELECT bank_name, account_number, account_name
       FROM wedding_gift_accounts WHERE id = 1 LIMIT 1`
    ).then(([rows]) => rows),
    pool.query(
      `SELECT id, guest_name, attendance, guest_count, message,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM wedding_rsvps ORDER BY created_at DESC LIMIT 500`
    ).then(([rows]) => rows),
    pool.query(
      `SELECT id, guest_name, CAST(amount AS CHAR) AS amount,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM wedding_gift_reports ORDER BY created_at DESC LIMIT 500`
    ).then(([rows]) => rows),
  ]);

  if (!settings || couples.length !== 2 || !giftAccount) {
    throw new Error('Data undangan belum lengkap. Jalankan database/schema.sql.');
  }
  const bride = couples.find((couple) => couple.role === 'bride');
  const groom = couples.find((couple) => couple.role === 'groom');
  if (!bride || !groom) throw new Error('Data mempelai belum lengkap.');

  return {
    settings: {
      brideName: bride.full_name,
      groomName: groom.full_name,
      eventDate: settings.event_date,
      address: settings.address,
      bankName: giftAccount.bank_name || '',
      accountNumber: giftAccount.account_number,
      accountName: giftAccount.account_name,
    },
    rsvps,
    giftReports,
  };
}

async function bootstrapFirstAdmin() {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME?.trim();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!username && !password) return;

  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM admin_users');
  if (Number(total) > 0) {
    console.log('Admin bootstrap skipped because admin_users already has accounts.');
    return;
  }
  if (!isAdminUsernameValid(username) || typeof password !== 'string'
      || password.length < 12 || password.length > 200) {
    throw new Error('ADMIN_BOOTSTRAP_USERNAME harus 3-50 karakter (huruf/angka/._-) dan ADMIN_BOOTSTRAP_PASSWORD minimal 12 karakter.');
  }

  await pool.query(
    'INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)',
    [randomUUID(), username, createPasswordHash(password)]
  );
  console.log('Initial admin account created in admin_users.');
}

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
    const [[settings], couples, events, gallery, loveStory, [giftAccount]] = await Promise.all([
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
      pool.query(
        `SELECT bank_name, account_number, account_name
         FROM wedding_gift_accounts WHERE id = 1 LIMIT 1`
      ).then(([rows]) => rows),
    ]);

    if (!settings || couples.length !== 2 || events.length < 2 || !giftAccount) {
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
      giftAccount: {
        bank: giftAccount.bank_name || '',
        accountNumber: giftAccount.account_number,
        accountName: giftAccount.account_name,
      },
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

app.post('/api/gift-reports', limitSubmissions, async (req, res) => {
  const { guest_name, amount } = req.body || {};
  const name = typeof guest_name === 'string' ? guest_name.trim() : '';
  const amountText = typeof amount === 'string' ? amount.trim() : '';

  if (!name || name.length > 100) {
    return res.status(400).json({ message: 'Nama wajib diisi dan maksimal 100 karakter.' });
  }
  if (!/^\d{1,18}$/.test(amountText) || BigInt(amountText) === 0n) {
    return res.status(400).json({ message: 'Nominal harus berupa angka bulat positif maksimal 18 digit.' });
  }

  try {
    await pool.query(
      'INSERT INTO wedding_gift_reports (id, guest_name, amount) VALUES (?, ?, ?)',
      [randomUUID(), name, amountText]
    );
    res.status(201).json({
      message: 'Laporan hadiah berhasil dikirim. Data akan dicocokkan manual dengan mutasi rekening.',
    });
  } catch (error) {
    console.error('Gift report insert failed:', error.code || error.name);
    res.status(500).json({ message: 'Laporan hadiah belum berhasil disimpan.' });
  }
});

app.post('/api/admin/login', limitSubmissions, requireAllowedOrigin, async (req, res) => {
  if ((process.env.ADMIN_SESSION_SECRET || '').length < 32) {
    return res.status(503).json({ message: 'Konfigurasi ADMIN_SESSION_SECRET belum lengkap di server.' });
  }

  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = req.body?.password;
  if (!isAdminUsernameValid(username) || typeof password !== 'string' || password.length > 200) {
    return res.status(401).json({ message: 'Username atau password salah.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, username, password_hash, is_active FROM admin_users WHERE username = ? LIMIT 1',
      [username]
    );
    const admin = rows[0];
    if (!admin || !admin.is_active || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ message: 'Username atau password salah.' });
    }

    await pool.query('UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);
    setAdminCookie(res, createAdminToken(admin));
    res.json({ authenticated: true, username: admin.username });
  } catch (error) {
    console.error('Admin login failed:', error.code || error.name);
    res.status(500).json({ message: 'Login admin belum berhasil. Periksa skema database.' });
  }
});

app.get('/api/admin/session', requireAdmin, (req, res) => {
  res.json({ authenticated: true, id: req.admin.id, username: req.admin.username });
});

app.post('/api/admin/logout', requireAllowedOrigin, (_req, res) => {
  clearAdminCookie(res);
  res.json({ authenticated: false });
});

app.get('/api/admin/dashboard', requireAdmin, async (_req, res) => {
  try {
    res.json(await loadAdminDashboard());
  } catch (error) {
    console.error('Admin dashboard query failed:', error.code || error.name);
    res.status(500).json({ message: error.message || 'Gagal memuat data admin.' });
  }
});

app.get('/api/admin/invitations', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, nama_undangan, alamat_undangan, no_wa
       FROM daftar_undangan
       ORDER BY nama_undangan, id`
    );
    res.json(rows);
  } catch (error) {
    console.error('Admin invitations query failed:', error.code || error.name);
    res.status(500).json({ message: 'Gagal memuat daftar undangan. Pastikan tabel daftar_undangan memiliki kolom nama_undangan, alamat_undangan, dan no_wa.' });
  }
});

app.post('/api/admin/invitations', requireAdmin, requireAllowedOrigin, async (req, res) => {
  const invitation = cleanInvitationInput(req.body);
  if (!invitation) {
    return res.status(400).json({ message: 'Nama undangan wajib diisi. Setiap kolom maksimal 255 karakter.' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO daftar_undangan (nama_undangan, alamat_undangan, no_wa) VALUES (?, ?, ?)',
      [invitation.nama_undangan, invitation.alamat_undangan, invitation.no_wa]
    );
    res.status(201).json({ message: 'Undangan berhasil ditambahkan.', id: result.insertId });
  } catch (error) {
    console.error('Admin invitation insert failed:', error.code || error.name);
    res.status(500).json({ message: 'Undangan belum berhasil ditambahkan.' });
  }
});

app.put('/api/admin/invitations/:id', requireAdmin, requireAllowedOrigin, async (req, res) => {
  const id = Number(req.params.id);
  const invitation = cleanInvitationInput(req.body);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ message: 'ID undangan tidak valid.' });
  }
  if (!invitation) {
    return res.status(400).json({ message: 'Nama undangan wajib diisi. Setiap kolom maksimal 255 karakter.' });
  }
  try {
    const [result] = await pool.query(
      `UPDATE daftar_undangan
       SET nama_undangan = ?, alamat_undangan = ?, no_wa = ?
       WHERE id = ?`,
      [invitation.nama_undangan, invitation.alamat_undangan, invitation.no_wa, id]
    );
    if (!result.affectedRows) {
      const [existing] = await pool.query('SELECT id FROM daftar_undangan WHERE id = ? LIMIT 1', [id]);
      if (!existing.length) {
        return res.status(404).json({ message: 'Undangan tidak ditemukan.' });
      }
    }
    res.json({ message: 'Undangan berhasil diperbarui.' });
  } catch (error) {
    console.error('Admin invitation update failed:', error.code || error.name);
    res.status(500).json({ message: 'Undangan belum berhasil diperbarui.' });
  }
});

app.delete('/api/admin/invitations/:id', requireAdmin, requireAllowedOrigin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ message: 'ID undangan tidak valid.' });
  }
  try {
    const [result] = await pool.query('DELETE FROM daftar_undangan WHERE id = ?', [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Undangan tidak ditemukan.' });
    }
    res.json({ message: 'Undangan berhasil dihapus.' });
  } catch (error) {
    console.error('Admin invitation delete failed:', error.code || error.name);
    res.status(500).json({ message: 'Undangan belum berhasil dihapus.' });
  }
});

app.post('/api/admin/invitations/import', requireAdmin, requireAllowedOrigin, async (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 300) {
    return res.status(400).json({ message: 'File harus berisi 1 sampai 300 baris undangan.' });
  }
  const invitations = rows.map(cleanInvitationInput);
  if (invitations.some((invitation) => !invitation)) {
    return res.status(400).json({ message: 'Ada baris tidak valid. Pastikan nama diisi dan setiap kolom maksimal 255 karakter.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const values = invitations.flatMap((invitation) => [
      invitation.nama_undangan,
      invitation.alamat_undangan,
      invitation.no_wa,
    ]);
    const placeholders = invitations.map(() => '(?, ?, ?)').join(', ');
    await connection.query(
      `INSERT INTO daftar_undangan (nama_undangan, alamat_undangan, no_wa) VALUES ${placeholders}`,
      values
    );
    await connection.commit();
    res.status(201).json({ message: `${invitations.length} undangan berhasil ditambahkan. Data lama tidak diubah.`, imported: invitations.length });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Invitation import rollback failed:', rollbackError.code || rollbackError.name);
      }
    }
    console.error('Admin invitation import failed:', error.code || error.name);
    res.status(500).json({ message: 'Impor undangan gagal; tidak ada baris dari file ini yang ditambahkan.' });
  } finally {
    connection?.release();
  }
});

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, is_active,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
              DATE_FORMAT(last_login_at, '%Y-%m-%d %H:%i:%s') AS last_login_at
       FROM admin_users ORDER BY created_at`
    );
    res.json(rows);
  } catch (error) {
    console.error('Admin users query failed:', error.code || error.name);
    res.status(500).json({ message: 'Gagal memuat daftar akun pengelola.' });
  }
});

app.post('/api/admin/users', requireAdmin, requireAllowedOrigin, async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = req.body?.password;
  if (!isAdminUsernameValid(username)) {
    return res.status(400).json({ message: 'Username harus 3-50 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.' });
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    return res.status(400).json({ message: 'Password harus minimal 12 karakter dan maksimal 200 karakter.' });
  }

  try {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)',
      [id, username, createPasswordHash(password)]
    );
    res.status(201).json({ message: 'Akun pengelola berhasil ditambahkan.', id, username });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Username tersebut sudah digunakan.' });
    }
    console.error('Admin user insert failed:', error.code || error.name);
    res.status(500).json({ message: 'Akun pengelola belum berhasil ditambahkan.' });
  }
});

app.patch('/api/admin/users/:id', requireAdmin, requireAllowedOrigin, async (req, res) => {
  const { is_active: isActive } = req.body || {};
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ message: 'Status akun tidak valid.' });
  }
  if (!isActive && req.params.id === req.admin.id) {
    return res.status(400).json({ message: 'Anda tidak dapat menonaktifkan akun yang sedang digunakan.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.query('SELECT id FROM admin_users FOR UPDATE');
    const [accounts] = await connection.query(
      'SELECT id, is_active FROM admin_users WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    if (!accounts.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Akun pengelola tidak ditemukan.' });
    }
    if (!isActive && accounts[0].is_active) {
      const [[{ activeCount }]] = await connection.query(
        'SELECT COUNT(*) AS activeCount FROM admin_users WHERE is_active = TRUE'
      );
      if (Number(activeCount) <= 1) {
        await connection.rollback();
        return res.status(400).json({ message: 'Minimal harus ada satu akun pengelola yang aktif.' });
      }
    }

    await connection.query('UPDATE admin_users SET is_active = ? WHERE id = ?', [isActive, req.params.id]);
    await connection.commit();
    res.json({ message: isActive ? 'Akun pengelola diaktifkan.' : 'Akun pengelola dinonaktifkan.' });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Admin account rollback failed:', rollbackError.code || rollbackError.name);
      }
    }
    console.error('Admin account update failed:', error.code || error.name);
    res.status(500).json({ message: 'Status akun belum berhasil diperbarui.' });
  } finally {
    connection?.release();
  }
});

app.put('/api/admin/users/:id/password', requireAdmin, requireAllowedOrigin, async (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) {
    return res.status(400).json({ message: 'Password harus minimal 12 karakter dan maksimal 200 karakter.' });
  }
  try {
    const [result] = await pool.query(
      'UPDATE admin_users SET password_hash = ? WHERE id = ?',
      [createPasswordHash(password), req.params.id]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Akun pengelola tidak ditemukan.' });
    }
    res.json({ message: 'Password akun berhasil diubah.' });
  } catch (error) {
    console.error('Admin password update failed:', error.code || error.name);
    res.status(500).json({ message: 'Password akun belum berhasil diubah.' });
  }
});

app.put('/api/admin/settings', requireAdmin, requireAllowedOrigin, async (req, res) => {
  const {
    bride_name: brideName,
    groom_name: groomName,
    event_date: eventDate,
    address,
    bank_name: bankName,
    account_number: accountNumber,
    account_name: accountName,
  } = req.body || {};
  const cleanBrideName = typeof brideName === 'string' ? brideName.trim() : '';
  const cleanGroomName = typeof groomName === 'string' ? groomName.trim() : '';
  const cleanAddress = typeof address === 'string' ? address.trim() : '';
  const cleanBankName = typeof bankName === 'string' ? bankName.trim() : '';
  const cleanAccountNumber = typeof accountNumber === 'string' ? accountNumber.trim() : '';
  const cleanAccountName = typeof accountName === 'string' ? accountName.trim() : '';

  if (!cleanBrideName || cleanBrideName.length > 160
      || !cleanGroomName || cleanGroomName.length > 160) {
    return res.status(400).json({ message: 'Nama mempelai wajib diisi dan maksimal 160 karakter.' });
  }
  if (!isValidEventDate(eventDate)) {
    return res.status(400).json({ message: 'Tanggal acara tidak valid.' });
  }
  if (!cleanAddress || cleanAddress.length > 500) {
    return res.status(400).json({ message: 'Alamat wajib diisi dan maksimal 500 karakter.' });
  }
  if (cleanBankName.length > 80 || !/^\d{1,34}$/.test(cleanAccountNumber)
      || !cleanAccountName || cleanAccountName.length > 160) {
    return res.status(400).json({ message: 'Informasi rekening tidak valid.' });
  }

  const eventLabel = new Date(`${eventDate}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const formattedEventLabel = eventLabel.charAt(0).toLocaleUpperCase('id-ID') + eventLabel.slice(1);
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [coupleRows] = await connection.query(
      'SELECT role FROM couples WHERE wedding_id = 1 AND role IN (?, ?)',
      ['bride', 'groom']
    );
    if (!coupleRows.some((couple) => couple.role === 'bride')
        || !coupleRows.some((couple) => couple.role === 'groom')) {
      throw new Error('Data mempelai belum lengkap di database.');
    }
    await connection.query(
      `UPDATE wedding_settings
       SET title = ?, date_iso = ?, date_label = ?, address = ?
       WHERE id = 1`,
      [`${cleanBrideName} & ${cleanGroomName}`, `${eventDate} 08:00:00`, formattedEventLabel, cleanAddress]
    );
    await connection.query(
      'UPDATE couples SET full_name = ? WHERE wedding_id = 1 AND role = ?',
      [cleanBrideName, 'bride']
    );
    await connection.query(
      'UPDATE couples SET full_name = ? WHERE wedding_id = 1 AND role = ?',
      [cleanGroomName, 'groom']
    );
    await connection.query(
      `UPDATE events SET event_date = ?, address = ? WHERE wedding_id = 1`,
      [`${eventDate} 00:00:00`, cleanAddress]
    );
    await connection.query(
      `UPDATE wedding_gift_accounts
       SET bank_name = ?, account_number = ?, account_name = ?
       WHERE id = 1`,
      [cleanBankName || null, cleanAccountNumber, cleanAccountName]
    );

    await connection.commit();
    res.json({ message: 'Pengaturan berhasil disimpan.' });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Admin settings rollback failed:', rollbackError.code || rollbackError.name);
      }
    }
    console.error('Admin settings update failed:', error.code || error.name);
    res.status(500).json({ message: error.message || 'Pengaturan belum berhasil disimpan.' });
  } finally {
    connection?.release();
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
    try {
      await bootstrapFirstAdmin();
    } finally {
      delete process.env.ADMIN_BOOTSTRAP_USERNAME;
      delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
    }
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
