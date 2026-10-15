import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from '@e965/xlsx';
import { CalendarDays, Download, Gift, LogOut, Pencil, Plus, Save, Send, Trash2, Upload, Users } from 'lucide-react';
import {
  adminLogin,
  adminLogout,
  checkAdminSession,
  addAdminUser,
  createAdminInvitation,
  deleteAdminInvitation,
  importAdminInvitations,
  loadAdminDashboard,
  loadAdminInvitations,
  loadAdminUsers,
  resetAdminUserPassword,
  saveAdminSettings,
  setAdminUserActive,
  updateAdminInvitation,
} from './lib/api';

const emptySettings = {
  brideName: '',
  groomName: '',
  eventDate: '',
  address: '',
  bankName: '',
  accountNumber: '',
  accountName: '',
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(`${value.replace(' ', 'T')}+07:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const formatRupiah = (value) => `Rp${new Intl.NumberFormat('id-ID').format(BigInt(value || '0'))}`;
const emptyInvitation = { nama_undangan: '', alamat_undangan: '', no_wa: '' };

function AdminPage() {
  const invitationFileRef = useRef(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('ringkasan');
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [settings, setSettings] = useState(emptySettings);
  const [rsvps, setRsvps] = useState([]);
  const [giftReports, setGiftReports] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [invitationFormOpen, setInvitationFormOpen] = useState(false);
  const [editingInvitationId, setEditingInvitationId] = useState(null);
  const [invitationForm, setInvitationForm] = useState(emptyInvitation);
  const [adminUsers, setAdminUsers] = useState([]);
  const [passwordResets, setPasswordResets] = useState({});
  const [newAdmin, setNewAdmin] = useState({ username: '', password: '' });
  const [currentAdminId, setCurrentAdminId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const refreshDashboard = async () => {
    const [data, users] = await Promise.all([loadAdminDashboard(), loadAdminUsers()]);
    setSettings(data.settings);
    setRsvps(data.rsvps);
    setGiftReports(data.giftReports);
    setAdminUsers(users);
  };

  useEffect(() => {
    let active = true;
    checkAdminSession()
      .then(async (session) => {
        setCurrentAdminId(session.id);
        await refreshDashboard();
        if (active) setAuthenticated(true);
      })
      .catch((loadError) => {
        if (active && loadError.message !== 'Sesi admin tidak valid atau sudah berakhir.') {
          setError(loadError.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  const attendingGuestCount = useMemo(
    () => rsvps.filter((item) => item.attendance === 'Hadir')
      .reduce((total, item) => total + Number(item.guest_count), 0),
    [rsvps]
  );
  const reportedGiftTotal = useMemo(
    () => giftReports.reduce((total, item) => total + BigInt(item.amount || '0'), 0n).toString(),
    [giftReports]
  );

  const handleLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminLogin(credentials);
      await refreshDashboard();
      setAuthenticated(true);
      setCredentials({ username: '', password: '' });
    } catch (loginError) {
      setError(loginError.message || 'Tidak dapat masuk ke menu admin.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettings = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await saveAdminSettings({
        bride_name: settings.brideName,
        groom_name: settings.groomName,
        event_date: settings.eventDate,
        address: settings.address,
        bank_name: settings.bankName,
        account_number: settings.accountNumber,
        account_name: settings.accountName,
      });
      await refreshDashboard();
      setNotice(result.message);
    } catch (saveError) {
      setError(saveError.message || 'Pengaturan belum berhasil disimpan.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setError('');
    try {
      await adminLogout();
      setAuthenticated(false);
      setCurrentAdminId('');
      setNotice('');
    } catch (logoutError) {
      setError(logoutError.message || 'Tidak dapat keluar dari menu admin.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAdmin = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await addAdminUser(newAdmin);
      setNewAdmin({ username: '', password: '' });
      setNotice(result.message);
      setAdminUsers(await loadAdminUsers());
    } catch (createError) {
      setError(createError.message || 'Akun pengelola belum berhasil ditambahkan.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAdmin = async (user) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await setAdminUserActive(user.id, !user.is_active);
      setNotice(result.message);
      setAdminUsers(await loadAdminUsers());
    } catch (toggleError) {
      setError(toggleError.message || 'Status akun belum berhasil diubah.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetAdminPassword = async (user) => {
    const password = passwordResets[user.id] || '';
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await resetAdminUserPassword(user.id, password);
      setPasswordResets((current) => ({ ...current, [user.id]: '' }));
      setNotice(result.message);
    } catch (resetError) {
      setError(resetError.message || 'Password belum berhasil diubah.');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenTab = async (tabId) => {
    setActiveTab(tabId);
    setError('');
    setNotice('');
    if (tabId !== 'undangan') return;

    setInvitationsLoading(true);
    try {
      setInvitations(await loadAdminInvitations());
    } catch (loadError) {
      setError(loadError.message || 'Daftar undangan belum berhasil dimuat.');
    } finally {
      setInvitationsLoading(false);
    }
  };

  const handleDownloadInvitationTemplate = async () => {
    setError('');
    setNotice('');
    try {
      const XLSX = await import('@e965/xlsx');
      const worksheet = XLSX.utils.aoa_to_sheet([['nama_undangan', 'alamat_undangan', 'no_wa']]);
      worksheet['!cols'] = [{ wch: 30 }, { wch: 36 }, { wch: 22 }];
      worksheet['!ref'] = 'A1:C101';
      for (let row = 2; row <= 101; row += 1) {
        worksheet[`C${row}`] = { t: 's', v: ' ', z: '@' };
      }
      worksheet['!autofilter'] = { ref: 'A1:C1' };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Daftar Undangan');
      XLSX.writeFile(workbook, 'template-daftar-undangan.xlsx');
    } catch (downloadError) {
      setError(downloadError.message || 'Template Excel belum berhasil dibuat.');
    }
  };

  const handleInvitationFormOpen = (invitation = emptyInvitation) => {
    setEditingInvitationId(invitation.id ?? null);
    setInvitationForm({
      nama_undangan: invitation.nama_undangan || '',
      alamat_undangan: invitation.alamat_undangan || '',
      no_wa: invitation.no_wa || '',
    });
    setInvitationFormOpen(true);
    setError('');
    setNotice('');
  };

  const handleInvitationFormSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = editingInvitationId === null
        ? await createAdminInvitation(invitationForm)
        : await updateAdminInvitation(editingInvitationId, invitationForm);
      setInvitations(await loadAdminInvitations());
      setInvitationFormOpen(false);
      setInvitationForm(emptyInvitation);
      setEditingInvitationId(null);
      setNotice(result.message);
    } catch (saveError) {
      setError(saveError.message || 'Data undangan belum berhasil disimpan.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteInvitation = async (invitation) => {
    if (!window.confirm(`Hapus undangan untuk ${invitation.nama_undangan || 'tamu ini'}?`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await deleteAdminInvitation(invitation.id);
      setInvitations(await loadAdminInvitations());
      setNotice(result.message);
    } catch (deleteError) {
      setError(deleteError.message || 'Undangan belum berhasil dihapus.');
    } finally {
      setBusy(false);
    }
  };

  const handleInvitationImport = async (event) => {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5 * 1024 * 1024) {
        throw new Error('Pilih file .xlsx maksimal 5 MB.');
      }
      const XLSX = await import('@e965/xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet || !firstSheet['!ref']) {
        throw new Error('Sheet pertama pada file Excel kosong.');
      }
      const range = XLSX.utils.decode_range(firstSheet['!ref']);
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        for (let column = range.s.c; column <= range.e.c; column += 1) {
          const cell = firstSheet[XLSX.utils.encode_cell({ r: row, c: column })];
          if (cell?.f) throw new Error('Template tidak boleh berisi rumus Excel.');
        }
      }
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, defval: '', blankrows: false });
      const headers = rows.shift()?.map((value) => String(value).trim().toLowerCase()) || [];
      const columns = ['nama_undangan', 'alamat_undangan', 'no_wa'].map((name) => headers.indexOf(name));
      if (columns.some((index) => index < 0)) {
        throw new Error('Kolom wajib tidak ditemukan. Gunakan template dengan header nama_undangan, alamat_undangan, dan no_wa.');
      }
      const importedRows = rows
        .map((row) => ({
          nama_undangan: String(row[columns[0]] ?? '').trim(),
          alamat_undangan: String(row[columns[1]] ?? '').trim(),
          no_wa: String(row[columns[2]] ?? '').trim(),
        }))
        .filter((row) => row.nama_undangan || row.alamat_undangan || row.no_wa);
      if (!importedRows.length) throw new Error('Tidak ada baris undangan untuk diimpor.');
      if (importedRows.length > 300) throw new Error('Maksimal 300 undangan per file. Bagi data menjadi beberapa file.');
      if (importedRows.some((row) => !row.nama_undangan)) throw new Error('Nama undangan wajib diisi pada setiap baris.');
      if (importedRows.some((row) => Object.values(row).some((value) => value.length > 255))) {
        throw new Error('Setiap kolom maksimal 255 karakter.');
      }
      if (new TextEncoder().encode(JSON.stringify({ rows: importedRows })).length > 900 * 1024) {
        throw new Error('Ukuran data terlalu besar. Bagi data menjadi beberapa file.');
      }

      const result = await importAdminInvitations(importedRows);
      setInvitations(await loadAdminInvitations());
      setNotice(result.message);
    } catch (importError) {
      setError(importError.message || 'File Excel belum berhasil diimpor.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendInvitation = (invitation) => {
    const recipientName = invitation.nama_undangan?.trim() || '';
    const rawPhone = invitation.no_wa?.trim() || '';
    if (!rawPhone) {
      setNotice(`Nomor WhatsApp untuk ${recipientName || 'undangan ini'} belum diisi. Isi kolom no_wa terlebih dahulu.`);
      return;
    }

    const digits = rawPhone.replace(/\D/g, '');
    const phone = digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
    if (!phone) {
      setNotice(`Nomor WhatsApp untuk ${recipientName || 'undangan ini'} tidak valid. Periksa kolom no_wa.`);
      return;
    }

    const invitationUrl = `https://restasurya.ienvite.id/?to=${encodeURIComponent(recipientName)}`;
    const message = `Assalamu'alaikum Warahmatullahi Wabarakaatuh

Tanpa mengurangi rasa hormat, perkenankan kami mengundang Bapak/Ibu/Saudara/i ${recipientName} untuk menghadiri acara kami.

Maha Suci Allah SWT dengan segala Kebesaran-Nya yang telah menciptakan makhluk-Nya berpasang-pasangan, melalui pesan ini kami ingin menyampaikan kabar bahagia atas pernikahan kami:

Resta Syahwa Hafidza
&
Suryana Maulana

Berikut link undangan kami, untuk info lengkap dari acara kami:

${invitationUrl}

Do’a restu menjadi keberkahan untuk pernikahan kami menjadi keluarga yang sakinnah mawadah warrahmah.

Kami yang berbahagia,

Resta & Surya

Wassalamualaikum Warahmatullahi Wabarakatuh`;
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    setNotice('WhatsApp dibuka dengan pesan undangan. Tinjau pesannya lalu tekan Kirim di WhatsApp.');
  };

  if (loading) {
    return <main className="admin-page"><p className="admin-loading">Memuat menu admin...</p></main>;
  }

  if (!authenticated) {
    return (
      <main className="admin-page admin-login-page">
        <form className="admin-login-card" onSubmit={handleLogin}>
          <a className="admin-back-link" href="/">← Kembali ke undangan</a>
          <span className="eyebrow">Wedding Administration</span>
          <h1>Login Admin</h1>
          <p>Masuk untuk mengatur undangan serta melihat RSVP dan laporan hadiah.</p>
          <label className="admin-field">
            <span>Username</span>
            <input autoComplete="username" required value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} />
          </label>
          <label className="admin-field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" required value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} />
          </label>
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          <button className="button button-gold" type="submit" disabled={busy}>{busy ? 'Memeriksa...' : 'Masuk'}</button>
        </form>
      </main>
    );
  }

  const tabs = [
    { id: 'ringkasan', label: 'Ringkasan', icon: CalendarDays },
    { id: 'pengaturan', label: 'Pengaturan', icon: Save },
    { id: 'rsvp', label: 'RSVP', icon: Users },
    { id: 'hadiah', label: 'Laporan hadiah', icon: Gift },
    { id: 'undangan', label: 'Daftar undangan', icon: Send },
    { id: 'pengelola', label: 'Akun pengelola', icon: Users },
  ];

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="eyebrow">Wedding Administration</span>
          <h1>Dashboard Admin</h1>
        </div>
        <div className="admin-header-actions">
          <a className="button button-outline" href="/">Lihat undangan</a>
          <button className="button button-outline" type="button" onClick={handleLogout} disabled={busy}><LogOut size={15} /> Keluar</button>
        </div>
      </header>
      <nav className="admin-tabs" aria-label="Menu admin">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" className={activeTab === id ? 'is-active' : ''} onClick={() => handleOpenTab(id)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>
      {error ? <p className="admin-error" role="alert">{error}</p> : null}
      {notice ? <p className="admin-notice" role="status">{notice}</p> : null}

      {activeTab === 'ringkasan' && (
        <>
          <section className="admin-stats">
            <article><span>RSVP tersimpan</span><strong>{rsvps.length}</strong></article>
            <article><span>Tamu menyatakan hadir</span><strong>{attendingGuestCount}</strong></article>
            <article><span>Laporan hadiah</span><strong>{giftReports.length}</strong></article>
            <article><span>Total nominal dilaporkan</span><strong>{formatRupiah(reportedGiftTotal)}</strong></article>
          </section>
          <p className="admin-note">Daftar dashboard menampilkan maksimal 500 RSVP dan 500 laporan hadiah terbaru. Laporan hadiah adalah informasi dari tamu; cocokkan dengan mutasi rekening secara manual.</p>
        </>
      )}

      {activeTab === 'pengaturan' && (
        <form className="admin-panel admin-settings-form" onSubmit={handleSaveSettings}>
          <h2>Pengaturan undangan</h2>
          <div className="admin-settings-grid">
            <label className="admin-field"><span>Nama mempelai wanita</span><input maxLength={160} required value={settings.brideName} onChange={(event) => setSettings({ ...settings, brideName: event.target.value })} /></label>
            <label className="admin-field"><span>Nama mempelai pria</span><input maxLength={160} required value={settings.groomName} onChange={(event) => setSettings({ ...settings, groomName: event.target.value })} /></label>
            <label className="admin-field"><span>Tanggal acara</span><input type="date" required value={settings.eventDate} onChange={(event) => setSettings({ ...settings, eventDate: event.target.value })} /></label>
            <label className="admin-field admin-field-full"><span>Alamat acara</span><textarea maxLength={500} required rows={3} value={settings.address} onChange={(event) => setSettings({ ...settings, address: event.target.value })} /></label>
            <label className="admin-field"><span>Nama bank</span><input maxLength={80} value={settings.bankName} onChange={(event) => setSettings({ ...settings, bankName: event.target.value })} /></label>
            <label className="admin-field"><span>Nomor rekening</span><input inputMode="numeric" maxLength={34} required value={settings.accountNumber} onChange={(event) => setSettings({ ...settings, accountNumber: event.target.value })} /></label>
            <label className="admin-field admin-field-full"><span>Atas nama rekening</span><input maxLength={160} required value={settings.accountName} onChange={(event) => setSettings({ ...settings, accountName: event.target.value })} /></label>
          </div>
          <button className="button button-gold" type="submit" disabled={busy}><Save size={15} /> {busy ? 'Menyimpan...' : 'Simpan pengaturan'}</button>
        </form>
      )}

      {activeTab === 'rsvp' && (
        <section className="admin-panel">
          <h2>Konfirmasi kehadiran</h2>
          {rsvps.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Nama</th><th>Kehadiran</th><th>Jumlah tamu</th><th>Ucapan</th><th>Dikirim</th></tr></thead>
                <tbody>{rsvps.map((item) => (
                  <tr key={item.id}><td>{item.guest_name}</td><td>{item.attendance}</td><td>{item.guest_count}</td><td>{item.message || '—'}</td><td>{formatDate(item.created_at)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="admin-empty">Belum ada RSVP masuk.</p>}
        </section>
      )}

      {activeTab === 'hadiah' && (
        <section className="admin-panel">
          <h2>Laporan transfer hadiah</h2>
          <p className="admin-note">Nominal berikut dilaporkan oleh tamu dan belum diverifikasi terhadap rekening. Cocokkan secara manual dengan mutasi bank.</p>
          {giftReports.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Nama tamu</th><th>Nominal dilaporkan</th><th>Dikirim</th></tr></thead>
                <tbody>{giftReports.map((item) => (
                  <tr key={item.id}><td>{item.guest_name}</td><td>{formatRupiah(item.amount)}</td><td>{formatDate(item.created_at)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="admin-empty">Belum ada laporan hadiah.</p>}
        </section>
      )}

      {activeTab === 'undangan' && (
        <section className="admin-panel">
          <h2>Daftar undangan</h2>
          <p className="admin-note">Impor Excel hanya menambahkan data baru; baris yang sudah ada tidak diubah. Baris tanpa nama akan ditolak, sedangkan baris kosong diabaikan. Maksimal 300 baris per file. Tombol WhatsApp hanya membuka pesan untuk dikirim manual.</p>
          <div className="invitation-toolbar">
            <button className="button button-gold" type="button" onClick={() => handleInvitationFormOpen()} disabled={busy}>
              <Plus size={15} /> Tambah undangan
            </button>
            <button className="button button-outline" type="button" onClick={handleDownloadInvitationTemplate} disabled={busy}>
              <Download size={15} /> Download template Excel
            </button>
            <button className="button button-outline" type="button" onClick={() => invitationFileRef.current?.click()} disabled={busy}>
              <Upload size={15} /> {busy ? 'Memproses...' : 'Upload Excel'}
            </button>
            <input ref={invitationFileRef} className="visually-hidden" type="file" accept=".xlsx" onChange={handleInvitationImport} />
          </div>
          {invitationFormOpen && (
            <form className="invitation-edit-form" onSubmit={handleInvitationFormSubmit}>
              <h3>{editingInvitationId === null ? 'Tambah undangan' : 'Ubah undangan'}</h3>
              <label className="admin-field">
                <span>Nama undangan</span>
                <input maxLength={255} required value={invitationForm.nama_undangan} onChange={(event) => setInvitationForm({ ...invitationForm, nama_undangan: event.target.value })} />
              </label>
              <label className="admin-field">
                <span>Alamat</span>
                <input maxLength={255} value={invitationForm.alamat_undangan} onChange={(event) => setInvitationForm({ ...invitationForm, alamat_undangan: event.target.value })} />
              </label>
              <label className="admin-field">
                <span>No. WhatsApp</span>
                <input type="tel" maxLength={255} value={invitationForm.no_wa} onChange={(event) => setInvitationForm({ ...invitationForm, no_wa: event.target.value })} />
              </label>
              <div className="invitation-form-actions">
                <button className="button button-gold" type="submit" disabled={busy}><Save size={15} /> {busy ? 'Menyimpan...' : 'Simpan'}</button>
                <button className="button button-outline" type="button" onClick={() => setInvitationFormOpen(false)} disabled={busy}>Batal</button>
              </div>
            </form>
          )}
          {invitationsLoading ? <p className="admin-empty">Memuat daftar undangan...</p> : invitations.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table invitation-table">
                <thead><tr><th>Nama undangan</th><th>Alamat</th><th>No. WhatsApp</th><th>Aksi</th></tr></thead>
                <tbody>{invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.nama_undangan || '—'}</td>
                    <td>{invitation.alamat_undangan || '—'}</td>
                    <td>{invitation.no_wa || 'Belum diisi'}</td>
                    <td>
                      <div className="invitation-row-actions">
                        <button className="button button-outline invitation-send-button" type="button" onClick={() => handleSendInvitation(invitation)}>
                          <Send size={14} /> Kirim WhatsApp
                        </button>
                        <button className="button button-outline invitation-action-button" type="button" onClick={() => handleInvitationFormOpen(invitation)} disabled={busy} aria-label={`Ubah ${invitation.nama_undangan}`}>
                          <Pencil size={14} /> Ubah
                        </button>
                        <button className="button button-outline invitation-action-button" type="button" onClick={() => handleDeleteInvitation(invitation)} disabled={busy} aria-label={`Hapus ${invitation.nama_undangan}`}>
                          <Trash2 size={14} /> Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="admin-empty">Belum ada data di tabel daftar_undangan.</p>}
        </section>
      )}

      {activeTab === 'pengelola' && (
        <section className="admin-panel">
          <h2>Akun pengelola</h2>
          <p className="admin-note">Password disimpan sebagai hash scrypt dan tidak dapat dilihat kembali. Untuk mengganti password, buat password baru.</p>
          <form className="admin-user-create" onSubmit={handleCreateAdmin}>
            <label className="admin-field">
              <span>Username baru</span>
              <input autoComplete="off" minLength={3} maxLength={50} pattern="[A-Za-z0-9._-]+" required value={newAdmin.username} onChange={(event) => setNewAdmin({ ...newAdmin, username: event.target.value })} />
            </label>
            <label className="admin-field">
              <span>Password baru (minimal 12 karakter)</span>
              <input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={newAdmin.password} onChange={(event) => setNewAdmin({ ...newAdmin, password: event.target.value })} />
            </label>
            <button className="button button-gold" type="submit" disabled={busy}>Tambah akun</button>
          </form>
          <div className="admin-user-list">
            {adminUsers.map((user) => (
              <article className="admin-user-card" key={user.id}>
                <div className="admin-user-heading">
                  <div>
                    <strong>{user.username}</strong>
                    <span>{user.id === currentAdminId ? 'Akun Anda' : user.is_active ? 'Aktif' : 'Nonaktif'}</span>
                  </div>
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={busy || user.id === currentAdminId || (user.is_active && adminUsers.filter((entry) => entry.is_active).length <= 1)}
                    onClick={() => handleToggleAdmin(user)}
                  >
                    {user.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </div>
                <small>Terakhir masuk: {formatDate(user.last_login_at)}</small>
                <div className="admin-user-password">
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={200}
                    placeholder="Password baru (min. 12 karakter)"
                    value={passwordResets[user.id] || ''}
                    onChange={(event) => setPasswordResets((current) => ({ ...current, [user.id]: event.target.value }))}
                  />
                  <button className="button button-outline" type="button" disabled={busy || (passwordResets[user.id] || '').length < 12} onClick={() => handleResetAdminPassword(user)}>
                    Ubah password
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

export default AdminPage;
