# Resta & Surya — Wedding Invitation

Undangan digital React + Vite bertema Midnight Royal Romance. Frontend menggunakan API Node.js/Express untuk membaca dan mengatur data undangan, menyimpan RSVP, serta mengelola laporan hadiah di MySQL. Supabase tetap tersedia sebagai jalur kompatibilitas RSVP/ucapan/hadiah tamu; konfigurasi Supabase tidak otomatis dipindahkan ke MySQL.

## Audit dan arsitektur

- Frontend: React 18, Vite, Framer Motion; panel admin tersedia di `/admin`.
- Backend: Express dan `mysql2/promise`; seluruh query MySQL menggunakan parameter prepared statement.
- Tabel lama `wedding_rsvps` dan `wedding_wishes` dipertahankan untuk menjaga data yang sudah ada.
- Konten undangan berada di `wedding_settings`, `couples`, `events`, `gallery_photos`, dan `love_story`.
- Rekening untuk fitur kirim hadiah berada di `wedding_gift_accounts`; akun awal dapat diedit langsung di database.
- Laporan hadiah tamu berisi nama dan nominal di `wedding_gift_reports`. Data merupakan laporan tamu dan harus dicocokkan manual dengan mutasi bank; tidak ada integrasi untuk membaca rekening.
- RSVP publik hanya menerima data; daftar RSVP dan laporan hadiah hanya tersedia melalui endpoint admin yang dilindungi login.
- Menu **Daftar undangan** menyediakan CRUD, template Excel (`template-daftar-undangan.xlsx`), dan impor `.xlsx` (maksimal 300 baris per file) ke tabel `daftar_undangan` dengan kolom `id`, `nama_undangan`, `alamat_undangan`, dan `no_wa`. Impor hanya menambahkan baris; data yang sudah ada tidak diubah dan baris kosong diabaikan. Tombol WhatsApp membuka tautan berisi template undangan untuk ditinjau dan dikirim manual oleh admin; aplikasi tidak mengirim pesan otomatis.
- Akun admin disimpan di `admin_users`; password di-hash dengan scrypt dan tidak dapat dibaca kembali.
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
ADMIN_SESSION_SECRET=your_random_secret_at_least_32_bytes
# Hanya untuk membuat akun pertama jika admin_users masih kosong:
ADMIN_BOOTSTRAP_USERNAME=your_admin_username
ADMIN_BOOTSTRAP_PASSWORD=your_long_unique_password
VITE_API_URL=http://localhost:4000
```

`ADMIN_SESSION_SECRET` wajib diisi dengan nilai acak minimal 32 karakter pada server. Untuk membuat admin pertama, isi `ADMIN_BOOTSTRAP_USERNAME` (3–50 karakter: huruf, angka, titik, `_`, `-`) dan `ADMIN_BOOTSTRAP_PASSWORD` (minimal 12 karakter), lalu jalankan API. Jika tabel `admin_users` belum berisi akun, API akan membuat satu akun dengan password scrypt-hash. Hapus kedua nilai bootstrap dari `.env` segera setelah akun pertama dibuat. Jangan memasukkan kredensial ke Git atau frontend.

Jalankan API dan frontend pada dua terminal:

```bash
npm install
npm run server
```

```bash
npm run dev
```

Buka URL lokal Vite, biasanya `http://localhost:5173`. Buka `http://localhost:5173/admin` untuk login admin. Panel menyediakan pengaturan nama mempelai, tanggal/lokasi acara, rekening hadiah, daftar RSVP, laporan nama/nominal hadiah, dan pengelolaan beberapa akun admin. Admin dapat menambahkan akun, mengubah password, dan menonaktifkan akun. Password disimpan sebagai hash scrypt, bukan teks yang dapat dilihat. Sesi login menggunakan cookie HttpOnly yang berlaku 8 jam. Pengiriman publik dibatasi 8 permintaan per 15 menit per alamat IP dan input divalidasi di server.

API publik menyediakan `GET /api/health`, `GET /api/invitation`, dan `GET /api/wishes`, serta endpoint pengiriman RSVP/ucapan dan laporan hadiah. Endpoint daftar RSVP/laporan hadiah dan perubahan pengaturan hanya dapat diakses setelah admin login. Laporan hadiah tidak membuktikan transfer diterima; cocokkan nominal dan nama secara manual dengan mutasi rekening.

### Akses dari HP pada Wi-Fi yang sama

Vite dikonfigurasi untuk listen pada semua interface jaringan (`0.0.0.0`). Cari alamat IPv4 Wi-Fi komputer, lalu buka `http://ALAMAT-IP-KOMPUTER:5173` di browser HP. Contohnya `http://192.168.1.20:5173` (gunakan IP yang benar-benar ditampilkan komputer Anda). Tetapkan juga `VITE_API_URL=http://ALAMAT-IP-KOMPUTER:4000` dan tambahkan origin `http://ALAMAT-IP-KOMPUTER:5173` pada `WEB_ORIGIN`. Restart Vite dan API setiap kali `.env` berubah atau IP lokal berubah. Komputer dan HP harus berada pada jaringan yang sama, bukan guest Wi-Fi/client-isolated.

Jika Windows Firewall meminta izin untuk Node.js, izinkan akses hanya pada jaringan Private yang dipercaya. Jangan membuat port-forward router atau mengekspos server development ini ke internet. Port development/API harus tetap digunakan di jaringan lokal tepercaya saja.

Jika menggunakan Supabase sebagai fallback, jalankan ulang [`supabase/schema.sql`](./supabase/schema.sql) di SQL Editor agar fungsi atomik `submit_wedding_rsvp_and_wish` tersedia.

Jalankan ulang [`database/schema.sql`](./database/schema.sql) untuk menambahkan tabel laporan hadiah dan `admin_users` pada instalasi MySQL yang sudah ada. Jika menggunakan Supabase untuk menerima laporan hadiah publik, jalankan ulang [`supabase/schema.sql`](./supabase/schema.sql). Panel admin dan pengaturan admin memerlukan API MySQL, tabel `admin_users`, serta `ADMIN_SESSION_SECRET`.

Jika `npm run server` menampilkan `EADDRINUSE`, sudah ada proses yang memakai port API. Hentikan proses tersebut dari terminal tempat proses itu dijalankan sebelum memulai ulang, atau pilih port lain dengan `PORT` dan samakan `VITE_API_URL`. Vite membaca variabel `VITE_*` saat server frontend dimulai; mulai ulang Vite setelah mengubah `.env`.

## Foto, musik, dan konten

- Nama mempelai dan elemen dekoratif memakai Great Vibes dari Google Fonts; font dirilis di bawah SIL Open Font License 1.1 (https://github.com/google/fonts/blob/main/ofl/greatvibes/OFL.txt). DM Sans dan Cormorant Garamond tetap digunakan untuk informasi dan teks panjang.
- Panel admin pada tab **Pengaturan** dapat mengubah nama, keterangan urutan anak (misalnya “Putri pertama”), serta nama orang tua masing-masing mempelai. Data tersebut disimpan di kolom `child_order` dan `parents` pada tabel `couples`.
- Foto undangan dan galeri menggunakan `/images/photo1.jpeg` sampai `/images/photo4.jpeg`.
- Backsound menggunakan `public/audio/Resta dan Surya.mp3` dan mulai diputar dari menit 02:41 saat tombol musik ditekan.
- Data awal dapat diedit pada tabel `wedding_settings`, `couples`, `events`, `gallery_photos`, dan `love_story`.
- Fitur Kirim Hadiah menampilkan rekening BCA dari `wedding_gift_accounts` (MySQL) atau tabel bernama sama di Supabase. Ubah `bank_name`, `account_number`, dan `account_name` sesuai rekening tujuan. Nomor rekening disimpan sebagai teks.
- Tamu dapat mengirim nama dan nominal setelah transfer melalui formulir hadiah; laporan tersimpan di `wedding_gift_reports` dan perlu diverifikasi manual di rekening.
- Isi nomor WhatsApp pada kolom `no_wa` di `daftar_undangan`. Tombol WhatsApp menghapus karakter selain angka dan mengubah awalan `0` menjadi `62` (contoh `0987817627` menjadi `62987817627`); nomor yang sudah memakai kode negara tetap digunakan. Nama penerima pada tautan undangan di-URL-encode.
- Unduh template Excel dari menu **Daftar undangan**, isi header `nama_undangan`, `alamat_undangan`, `no_wa` tanpa mengganti nama kolom, lalu unggah file `.xlsx`. Nama wajib diisi; alamat dan nomor WhatsApp boleh kosong. Impor ditambahkan secara transaksional sehingga bila ada masalah, tidak ada sebagian baris file yang tersimpan.
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
- Atur `ADMIN_SESSION_SECRET` dan, hanya saat bootstrap pertama, `ADMIN_BOOTSTRAP_USERNAME` serta `ADMIN_BOOTSTRAP_PASSWORD` pada environment backend. Setelah akun dibuat, kelola username dan password dari menu Akun Pengelola. Gunakan URL HTTPS pada production agar cookie sesi aman.
- `WEB_ORIGIN` harus berisi origin frontend yang diizinkan. Gunakan TLS dan kredensial database dengan hak minimum.
- Jangan mengatur `VITE_API_URL` ke `localhost` pada build production.
- Rate limit bawaan disimpan di memori proses; untuk deployment multi-instance, ganti/dukung dengan rate limiter berbagi storage di sisi server.

## Referensi database terdahulu

`database/mysql-schema.sql` tetap disimpan sebagai skrip legacy dua tabel saja. Skema baru/canonical adalah [`database/schema.sql`](./database/schema.sql). File Supabase juga dibiarkan tersedia agar integrasi dan data lama tidak hilang.
