# Resta & Surya — Wedding Invitation

Undangan digital React + Vite bertema Midnight Royal Romance. Frontend menggunakan API Node.js/Express untuk membaca data undangan, menyimpan RSVP, dan mengelola ucapan ke MySQL. Supabase tetap tersedia sebagai jalur kompatibilitas lama; konfigurasi Supabase tidak otomatis dipindahkan ke MySQL.

## Audit dan arsitektur

- Frontend: React 18, Vite, Framer Motion; tidak ada routing atau panel admin.
- Backend: Express dan `mysql2/promise`; seluruh query MySQL menggunakan parameter prepared statement.
- Tabel lama `wedding_rsvps` dan `wedding_wishes` dipertahankan untuk menjaga data yang sudah ada.
- Konten undangan berada di `wedding_settings`, `couples`, `events`, `gallery_photos`, dan `love_story`.
- RSVP publik hanya menerima data; API tidak menyediakan endpoint baca RSVP.
- Tidak ada tabel `admins` karena belum ada fitur/admin panel.
- `@supabase/supabase-js` dan `supabase/schema.sql` dipertahankan. MySQL menjadi jalur utama jika `VITE_API_URL` diatur; jika tidak, Supabase lama dapat digunakan sebagai fallback RSVP/ucapan.

## Persyaratan

- Node.js 18 atau lebih baru (20 LTS disarankan)
- npm
- MySQL 8+

## Menyiapkan MySQL

1. Buat backup database `restasurya` sebelum menjalankan migrasi, terutama bila berisi data penting. Skrip berikut tidak menghapus tabel atau baris lama.
2. Jalankan [`database/schema.sql`](./database/schema.sql) menggunakan MySQL Workbench, phpMyAdmin, atau MySQL CLI:

   ```sql
   SOURCE database/schema.sql;
   ```

   Skrip membuat database jika belum ada, membuat tabel yang belum tersedia, serta mengisi data awal undangan dengan `INSERT IGNORE`. Data RSVP/ucapan lama tetap berada pada tabel bernama sama.
3. Untuk instalasi terdahulu yang sudah menjalankan `database/mysql-schema.sql`, gunakan `database/schema.sql` untuk menambahkan data undangan dan tabel konten baru. Jangan jalankan skrip lama sebagai pengganti skema baru.
4. Jika data RSVP/ucapan masih berada di Supabase, ekspor dan impor secara terpisah setelah mencadangkan data. Tidak ada migrasi otomatis Supabase → MySQL.

## Konfigurasi lokal

Salin `.env.example` menjadi `.env`, lalu isi host, port, username, dan password MySQL lokal Anda. Jangan menaruh kredensial database pada variabel `VITE_*` atau membagikan file `.env`.

Contoh nama variabel (gunakan nilai lokal Anda sendiri):

```dotenv
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=your_mysql_user
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=restasurya
PORT=4000
WEB_ORIGIN=http://localhost:5173,http://localhost:4173
VITE_API_URL=http://localhost:4000
```

Jalankan API dan frontend pada dua terminal:

```bash
npm install
npm run server
```

```bash
npm run dev
```

Buka URL lokal Vite, biasanya `http://localhost:5173`. API menyediakan `GET /api/health` untuk memeriksa koneksi database, `GET /api/invitation` dan `GET /api/wishes` untuk pembacaan publik, serta `POST /api/rsvp-and-wish` untuk satu pengiriman formulir. Endpoint lama `POST /api/rsvps` dan `POST /api/wishes` tetap tersedia untuk kompatibilitas, tetapi formulir website menggunakan endpoint gabungan yang menyimpan RSVP dan ucapan dalam satu transaksi MySQL. Pengiriman dibatasi 8 permintaan per 15 menit per alamat IP dan input divalidasi di server.

Jika menggunakan Supabase sebagai fallback, jalankan ulang [`supabase/schema.sql`](./supabase/schema.sql) di SQL Editor agar fungsi atomik `submit_wedding_rsvp_and_wish` tersedia.

Jika `npm run server` menampilkan `EADDRINUSE`, sudah ada proses yang memakai port API. Hentikan proses tersebut dari terminal tempat proses itu dijalankan sebelum memulai ulang, atau pilih port lain dengan `PORT` dan samakan `VITE_API_URL`. Vite membaca variabel `VITE_*` saat server frontend dimulai; mulai ulang Vite setelah mengubah `.env`.

## Foto, musik, dan konten

- Foto undangan dan galeri menggunakan `/images/photo1.jpeg` sampai `/images/photo4.jpeg`.
- Backsound menggunakan `public/audio/Resta dan Surya.mp3` dan mulai diputar dari menit 02:41 saat tombol musik ditekan.
- Data awal dapat diedit pada tabel `wedding_settings`, `couples`, `events`, `gallery_photos`, dan `love_story`.
- `INSERT IGNORE` pada seed tidak menimpa konten yang sudah disesuaikan di database. Skema memperbarui hanya path backsound placeholder lama (`/audio/wedding-music.mp3`) ke file baru, tanpa mengubah path musik kustom lainnya. Untuk memperbarui data lain yang sudah ada, edit record melalui alat MySQL Anda atau lakukan `UPDATE` yang ditinjau terlebih dahulu.

## Pemeriksaan

```bash
npm run build
```

Belum tersedia skrip lint atau test otomatis di proyek ini. Setelah skema diterapkan dan MySQL aktif, verifikasi API dengan `GET http://localhost:4000/api/health`, lalu periksa data melalui `GET http://localhost:4000/api/invitation` dan `GET http://localhost:4000/api/wishes`. Gunakan RSVP percobaan hanya bila Anda bersedia menambahkan baris baru ke database.

## Deploy

Frontend Vite dapat di-deploy ke Vercel. Backend Express dan MySQL harus di-host secara terpisah atau bersama pada layanan yang mendukung Node.js serta koneksi MySQL; MySQL yang hanya berjalan di komputer lokal tidak otomatis dapat diakses dari Vercel.

- Atur `VITE_API_URL` pada proses build frontend ke URL API HTTPS yang dapat diakses publik.
- Atur `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `PORT`, dan `WEB_ORIGIN` pada environment backend.
- `WEB_ORIGIN` harus berisi origin frontend yang diizinkan. Gunakan TLS dan kredensial database dengan hak minimum.
- Jangan mengatur `VITE_API_URL` ke `localhost` pada build production.
- Rate limit bawaan disimpan di memori proses; untuk deployment multi-instance, ganti/dukung dengan rate limiter berbagi storage di sisi server.

## Referensi database terdahulu

`database/mysql-schema.sql` tetap disimpan sebagai skrip legacy dua tabel saja. Skema baru/canonical adalah [`database/schema.sql`](./database/schema.sql). File Supabase juga dibiarkan tersedia agar integrasi dan data lama tidak hilang.
