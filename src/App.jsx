import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Copy, Gift, Heart, MapPin, Music2, Pause, Play, Send, X } from 'lucide-react';
import AdminPage from './Admin';
import { wedding as defaultWedding } from './data/weddingConfig';
import { isApiConfigured, loadInvitation, loadWishes, submitGiftReport, submitRsvpAndWish } from './lib/api';
import { isSupabaseConfigured, supabase } from './lib/supabase';

const fadeUp = { hidden: { opacity: 0, y: 24 }, visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: 'easeOut' } } };
const dateCalendarUrl = (event, address, coupleNames) => `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${event.title} — ${coupleNames}`)}&dates=${event.start.replace(/\+07:00$/, '').replace(/[-:]/g, '')}/${event.end.replace(/\+07:00$/, '').replace(/[-:]/g, '')}&details=${encodeURIComponent(`Undangan pernikahan ${coupleNames}`)}&location=${encodeURIComponent(address)}`;

function SectionTitle({ eyebrow, children }) {
  return (
    <motion.div className="section-title" variants={fadeUp} initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.3 }}>
      <span className="eyebrow">{eyebrow}</span>
      <h2>{children}</h2>
      <span className="title-rule"><i /></span>
    </motion.div>
  );
}

function Countdown({ dateISO }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const diff = new Date(dateISO).getTime() - now;

  if (diff <= 0) {
    return <div className="countdown-finished">Hari bahagia telah tiba. Terima kasih telah menjadi bagian dari cerita kami.</div>;
  }

  const values = [
    ['Hari', Math.floor(diff / 86400000)],
    ['Jam', Math.floor((diff % 86400000) / 3600000)],
    ['Menit', Math.floor((diff % 3600000) / 60000)],
    ['Detik', Math.floor((diff % 60000) / 1000)],
  ];

  return (
    <div className="countdown">
      {values.map(([label, value]) => (
        <div className="countdown-cell" key={label}>
          <strong>{String(value).padStart(2, '0')}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

const MusicPlayer = forwardRef(function MusicPlayer({ enabled, musicPath, startSeconds = defaultWedding.musicStartSeconds }, ref) {
  const audioRef = useRef(null);
  const hasAppliedStartRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [hasFile, setHasFile] = useState(true);

  useEffect(() => {
    if (!enabled && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
    }
  }, [enabled]);

  const seekToStart = (audio) => {
    if (hasAppliedStartRef.current || !audio || !Number.isFinite(audio.duration) || audio.duration <= startSeconds) return;
    audio.currentTime = startSeconds;
    hasAppliedStartRef.current = true;
  };

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !hasFile) return;

    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }

    try {
      await audio.play();
      seekToStart(audio);
      setPlaying(true);
    } catch {
      setHasFile(false);
    }
  };

  const startPlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !hasFile) return;

    seekToStart(audio);

    try {
      await audio.play();
      seekToStart(audio);
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  };

  useImperativeHandle(ref, () => ({ play: startPlayback }), [hasFile, startSeconds]);

  return (
    <>
      <audio ref={audioRef} src={musicPath} loop preload="metadata" onError={() => setHasFile(false)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
      <button className={`music-button ${playing ? 'is-playing' : ''}`} aria-label={playing ? 'Jeda musik' : 'Putar musik'} onClick={toggle} title={!hasFile ? 'Periksa file backsound pada folder public/audio' : 'Musik latar mulai pada menit 02:41'}>
        <Music2 size={17} />
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
    </>
  );
});

function WeddingInvitation() {
  const reduceMotion = useReducedMotion();
  const musicPlayerRef = useRef(null);
  const [opened, setOpened] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(null);
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftThanksOpen, setGiftThanksOpen] = useState(false);
  const [invitation, setInvitation] = useState(defaultWedding);
  const [rsvp, setRsvp] = useState({ name: '', attendance: 'Hadir', guests: '1', message: '' });
  const [wishes, setWishes] = useState([]);
  const [rsvpStatus, setRsvpStatus] = useState('');
  const [giftStatus, setGiftStatus] = useState('');
  const [giftReportStatus, setGiftReportStatus] = useState('');
  const [giftReport, setGiftReport] = useState({ name: '', amount: '' });
  const [databaseError, setDatabaseError] = useState('');
  const [busy, setBusy] = useState(false);
  const wedding = invitation;
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(wedding.address)}`;
  const story = wedding.loveStory?.length
    ? wedding.loveStory
    : [{ title: 'Dua hati, satu tujuan', text: wedding.intro, date: null }];
  const brideDisplayName = wedding.bride.fullName.trim().split(/\s+/)[0] || wedding.bride.fullName;
  const groomDisplayName = wedding.groom.fullName.trim().split(/\s+/)[0] || wedding.groom.fullName;
  const coupleNames = `${brideDisplayName} & ${groomDisplayName}`;

  const openInvitation = () => {
    setOpened(true);
    musicPlayerRef.current?.play();
  };

  const guestName = useMemo(() => {
    const raw = new URLSearchParams(window.location.search).get('to');
    return raw ? raw.slice(0, 100) : '';
  }, []);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (isApiConfigured) {
        try {
          const [nextInvitation, nextWishes] = await Promise.all([loadInvitation(), loadWishes()]);
          if (alive) {
            setInvitation(nextInvitation);
            setWishes(nextWishes);
          }
        } catch (error) {
          if (alive) setDatabaseError(error.message || 'Tidak dapat memuat data dari MySQL.');
        }
        return;
      }

      if (!isSupabaseConfigured) return;

      try {
        const { data, error } = await supabase
          .from('wedding_wishes')
          .select('id, guest_name, message, created_at')
          .order('created_at', { ascending: false })
          .limit(30);

        if (error) throw error;
        if (alive && data) {
          setWishes(data.map((item) => ({ id: item.id, name: item.guest_name, message: item.message })));
        }
        const { data: giftAccount, error: giftError } = await supabase
          .from('wedding_gift_accounts')
          .select('bank_name, account_number, account_name')
          .eq('id', 1)
          .single();

        if (giftError) throw giftError;
        if (alive) {
          setInvitation((current) => ({
            ...current,
            giftAccount: {
              bank: giftAccount.bank_name || '',
              accountNumber: giftAccount.account_number,
              accountName: giftAccount.account_name,
            },
          }));
        }
      } catch (error) {
        if (alive) setDatabaseError(error.message || 'Tidak dapat memuat data dari Supabase.');
      }
    };

    load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (galleryIndex === null) return;

    const onKey = (event) => {
      if (event.key === 'Escape') setGalleryIndex(null);
      if (event.key === 'ArrowRight') setGalleryIndex((index) => (index + 1) % wedding.photos.gallery.length);
      if (event.key === 'ArrowLeft') setGalleryIndex((index) => (index - 1 + wedding.photos.gallery.length) % wedding.photos.gallery.length);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [galleryIndex]);

  useEffect(() => {
    if (!giftOpen && !giftThanksOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setGiftOpen(false);
        setGiftThanksOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [giftOpen, giftThanksOpen]);

  const handleRsvpSubmit = async (event) => {
    event.preventDefault();
    setRsvpStatus('');

    if (!rsvp.name.trim() || !rsvp.message.trim()) {
      setRsvpStatus('Nama dan ucapan wajib diisi.');
      return;
    }
    if (rsvp.name.trim().length > 100 || rsvp.message.trim().length > 500) {
      setRsvpStatus('Nama maksimal 100 karakter dan ucapan maksimal 500 karakter.');
      return;
    }

    setBusy(true);

    try {
      if (isApiConfigured) {
        const payload = await submitRsvpAndWish({
          guest_name: rsvp.name.trim(),
          attendance: rsvp.attendance,
          guest_count: rsvp.attendance === 'Hadir' ? Number(rsvp.guests) || 1 : 0,
          message: rsvp.message.trim(),
        });
        if (payload?.item) {
          setWishes((current) => [{ id: payload.item.id, name: payload.item.name, message: payload.item.message }, ...current]);
        }
      } else if (isSupabaseConfigured) {
        const { data, error } = await supabase.rpc('submit_wedding_rsvp_and_wish', {
          p_guest_name: rsvp.name.trim(),
          p_attendance: rsvp.attendance,
          p_guest_count: rsvp.attendance === 'Hadir' ? Number(rsvp.guests) || 1 : 0,
          p_message: rsvp.message.trim(),
        });

        if (error) throw error;
        const item = Array.isArray(data) ? data[0] : data;
        if (item) {
          setWishes((current) => [{ id: item.id, name: item.guest_name, message: item.message }, ...current]);
        }
      } else {
        throw new Error('RSVP dan ucapan belum tersimpan. Konfigurasi database MySQL atau Supabase terlebih dahulu.');
      }

      setRsvpStatus('Terima kasih, RSVP dan ucapan Anda berhasil dikirim.');
      setRsvp({ name: '', attendance: 'Hadir', guests: '1', message: '' });
    } catch (error) {
      setRsvpStatus(error.message || 'RSVP dan ucapan belum berhasil dikirim. Silakan coba kembali.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyAccount = async () => {
    setGiftStatus('');

    try {
      await navigator.clipboard.writeText(wedding.giftAccount.accountNumber);
      setGiftStatus('Nomor rekening berhasil disalin.');
    } catch {
      setGiftStatus('Nomor rekening belum dapat disalin. Silakan salin nomor yang tertera.');
    }
  };

  const handleGiftReportSubmit = async (event) => {
    event.preventDefault();
    setGiftReportStatus('');
    const name = giftReport.name.trim();
    const amount = giftReport.amount.trim();

    if (!name || name.length > 100 || !/^[1-9]\d{0,17}$/.test(amount)) {
      setGiftReportStatus('Isi nama dan nominal transfer berupa angka bulat positif.');
      return;
    }

    setBusy(true);
    try {
      if (isApiConfigured) {
        await submitGiftReport({ guest_name: name, amount });
      } else if (isSupabaseConfigured) {
        const { error } = await supabase.from('wedding_gift_reports').insert({
          guest_name: name,
          amount,
        });
        if (error) throw error;
      } else {
        throw new Error('Formulir hadiah belum tersedia. Konfigurasi database terlebih dahulu.');
      }
      setGiftOpen(false);
      setGiftThanksOpen(true);
      setGiftReport({ name: '', amount: '' });
    } catch (error) {
      setGiftReportStatus(error.message || 'Laporan hadiah belum berhasil dikirim.');
    } finally {
      setBusy(false);
    }
  };

  const gallery = wedding.photos.gallery;

  return (
    <div className="site-shell">
      <AnimatePresence>
        {!opened && (
          <motion.div className="cover" initial={{ opacity: 1 }} exit={{ opacity: 0, y: -18, transition: { duration: 0.8 } }}>
            <motion.div
              className="cover-photo"
              aria-hidden="true"
              style={{ backgroundImage: `url('${wedding.photos.cover}')` }}
              initial={reduceMotion ? false : { opacity: 0, scale: 1.12 }}
              animate={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 1, scale: [1.08, 1.02, 1.08] }}
              transition={reduceMotion
                ? { duration: 0 }
                : { opacity: { duration: 1.2 }, scale: { duration: 24, repeat: Infinity, ease: 'easeInOut' } }}
            />
            <div className="cover-shade" />
            <div className="cover-grain" />
            <motion.div
              className="cover-frame"
              initial={reduceMotion ? false : { opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 1, delay: 0.25, ease: 'easeOut' }}
            >
              <span className="cover-topline">THE WEDDING OF</span>
              <div className="monogram">R<span>&</span>S</div>
              <h1>{brideDisplayName} <em>&</em> {groomDisplayName}</h1>
              <p className="cover-date">{wedding.dateLabel}</p>
              <div className="cover-divider" aria-hidden="true"><span /></div>
              <p className="cover-invite">Kepada Yth.</p>
              <p className="guest-name">{guestName || 'Bapak/Ibu/Saudara/i'}</p>
              <p className="cover-note">Dengan penuh rasa syukur, kami mengundang Anda untuk menjadi bagian dari hari bahagia kami.</p>
              <button className="button button-gold" onClick={openInvitation}><Heart size={16} /> Buka Undangan <ArrowDown size={15} /></button>
              <span className="cover-bottom">GARUT · JAWA BARAT</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="topbar">
        <a href="#home" className="brand">R<span>&</span>S</a>
        <nav aria-label="Navigasi utama">
          <a href="#couple">Mempelai</a>
          <a href="#event">Acara</a>
          <a href="#story">Cerita</a>
          <a href="#gallery">Galeri</a>
          <a href="#gift">Hadiah</a>
          <a href="#rsvp">RSVP</a>
        </nav>
        <MusicPlayer ref={musicPlayerRef} enabled={opened} musicPath={wedding.musicPath} startSeconds={wedding.musicStartSeconds} />
      </header>

      <main>
        <section id="home" className="hero">
          <div className="hero-image" style={{ backgroundImage: `linear-gradient(180deg, rgba(18,13,10,.18), rgba(18,13,10,.28) 35%, #17110e 100%), url('${wedding.photos.cover}')` }} />
          <div className="hero-ornament ornament-left">❧</div>
          <div className="hero-content">
            <span className="eyebrow">A CELEBRATION OF LOVE</span>
            <p className="hero-script">The Wedding Of</p>
            <h1>{brideDisplayName} <em>&</em><br className="mobile-break" /> {groomDisplayName}</h1>
            <p className="hero-date">{wedding.dateLabel}</p>
            <a href="#couple" className="scroll-cue"><span>SCROLL TO EXPLORE</span><ArrowDown size={15} /></a>
          </div>
          <div className="hero-ornament ornament-right">❧</div>
        </section>

        <section className="section-pad intro">
          <SectionTitle eyebrow="Our Story">Mempersatukan dua hati</SectionTitle>
          <p className="intro-copy">{wedding.intro}</p>
          <div className="intro-signature">{brideDisplayName} <span>&</span> {groomDisplayName}</div>
          <div className="tiny-flower">✦</div>
        </section>

        <section id="couple" className="section-pad couple">
          <SectionTitle eyebrow="The Couple">Mempelai</SectionTitle>
          <div className="couple-grid">
            <div className="person-card">
              <div className="person-photo" style={{ backgroundImage: `url('${wedding.photos.bride}')` }}>
                <span className="photo-label">THE BRIDE</span>
              </div>
              <span className="person-flourish">❧</span>
              <h3>{wedding.bride.fullName}</h3>
              <p className="nickname">{wedding.bride.nickname}</p>
              <p className="family-note">{wedding.bride.childOrder} dari</p>
              <p className="parents">{wedding.bride.parents}</p>
            </div>

            <div className="ampersand">&</div>

            <div className="person-card">
              <div className="person-photo" style={{ backgroundImage: `url('${wedding.photos.groom}')` }}>
                <span className="photo-label">THE GROOM</span>
              </div>
              <span className="person-flourish">❧</span>
              <h3>{wedding.groom.fullName}</h3>
              <p className="nickname">{wedding.groom.nickname}</p>
              <p className="family-note">{wedding.groom.childOrder} dari</p>
              <p className="parents">{wedding.groom.parents}</p>
            </div>
          </div>
        </section>

        <section id="event" className="section-pad countdown-section">
          <div className="countdown-bg-mark">R<span>&</span>S</div>
          <SectionTitle eyebrow="Countdown">Menunggu hari bahagia</SectionTitle>
          <p className="date-subtitle">{wedding.dateLabel}</p>
          <Countdown dateISO={wedding.dateISO} />
        </section>

        <section className="section-pad event-details">
          <SectionTitle eyebrow="Event Details">Agenda acara</SectionTitle>
          <div className="event-grid">
            <div className="event-card">
              <div className="event-icon"><CalendarDays size={18} /></div>
              <p className="event-label">Akad Nikah</p>
              <h3>{wedding.akad.title}</h3>
              <p>{wedding.akad.time}</p>
              <a className="text-link" href={dateCalendarUrl(wedding.akad, wedding.address, coupleNames)} target="_blank" rel="noreferrer">Simpan ke kalender</a>
            </div>

            <div className="event-card">
              <div className="event-icon"><Clock3 size={18} /></div>
              <p className="event-label">Resepsi</p>
              <h3>{wedding.reception.title}</h3>
              <p>{wedding.reception.time}</p>
              <a className="text-link" href={dateCalendarUrl(wedding.reception, wedding.address, coupleNames)} target="_blank" rel="noreferrer">Simpan ke kalender</a>
            </div>

            <div className="event-card venue-card">
              <div className="event-icon"><MapPin size={18} /></div>
              <p className="event-label">Lokasi</p>
              <h3>Tempat acara</h3>
              <p>{wedding.address}</p>
              <a className="text-link" href={mapUrl} target="_blank" rel="noreferrer">Lihat Maps</a>
            </div>
          </div>
        </section>

        <section id="story" className="section-pad story-section">
          <SectionTitle eyebrow="Our Story">Cerita perjalanan cinta</SectionTitle>
          <div className="story-timeline">
            {story.map((item, index) => (
              <article className="story-card" key={`${item.title}-${index}`}>
                <span className="story-marker" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                {item.date ? <p className="story-date">{item.date}</p> : null}
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="gallery" className="section-pad gallery-section">
          <SectionTitle eyebrow="Gallery">Momen indah</SectionTitle>
          <div className="gallery-grid">
            {gallery.map((photo, index) => (
              <button type="button" key={`${photo}-${index}`} className="gallery-item" onClick={() => setGalleryIndex(index)} style={{ backgroundImage: `url('${photo}')` }} aria-label={`Lihat foto ${index + 1}`} />
            ))}
          </div>
        </section>

        <section id="gift" className="section-pad gift-section">
          <SectionTitle eyebrow="Wedding Gift">Kirim hadiah</SectionTitle>
          <p className="gift-intro">
            Kehadiran dan doa Anda adalah hadiah terindah bagi kami. Namun, jika berhalangan hadir dan ingin mengirim tanda kasih, Anda dapat mengirimkannya melalui rekening berikut.
          </p>
          <button className="button button-gold gift-open-button" type="button" onClick={() => { setGiftStatus(''); setGiftReportStatus(''); setGiftReport({ name: guestName, amount: '' }); setGiftOpen(true); }}>
            <Gift size={16} /> Kirim Hadiah
          </button>
        </section>

        <section id="rsvp" className="section-pad rsvp-section">
          <SectionTitle eyebrow="RSVP & Messages">Konfirmasi kehadiran dan ucapan</SectionTitle>
          <div className="combined-rsvp-layout">
            <form className="panel" onSubmit={handleRsvpSubmit}>
              <div className="field-group">
                <label htmlFor="rsvp-name">Nama lengkap</label>
                <input id="rsvp-name" maxLength={100} required value={rsvp.name} onChange={(event) => setRsvp({ ...rsvp, name: event.target.value })} placeholder="Masukkan nama Anda" />
              </div>

              <div className="field-row">
                <div className="field-group">
                  <label htmlFor="rsvp-attendance">Konfirmasi</label>
                  <select id="rsvp-attendance" value={rsvp.attendance} onChange={(event) => setRsvp({ ...rsvp, attendance: event.target.value })}>
                    <option>Hadir</option>
                    <option>Tidak hadir</option>
                    <option>Belum pasti</option>
                  </select>
                </div>

                <div className="field-group">
                  <label htmlFor="rsvp-guests">Jumlah tamu</label>
                  <input id="rsvp-guests" type="number" min={1} max={4} value={rsvp.guests} onChange={(event) => setRsvp({ ...rsvp, guests: event.target.value })} />
                </div>
              </div>

              <div className="field-group">
                <label htmlFor="rsvp-message">Ucapan dan doa</label>
                <textarea id="rsvp-message" maxLength={500} required value={rsvp.message} onChange={(event) => setRsvp({ ...rsvp, message: event.target.value })} placeholder="Tulis ucapan dan doa untuk kedua mempelai" rows={5} />
              </div>

              <button className="button button-gold" type="submit" disabled={busy}>
                <Send size={15} /> {busy ? 'Mengirim...' : 'Kirim RSVP & Ucapan'}
              </button>

              {rsvpStatus ? <div className="status-box" role="status">{rsvpStatus}</div> : null}
            </form>

            <div className="wishes-wrap combined-wishes">
              <h3>Ucapan dan doa dari tamu</h3>
              {databaseError ? <p className="database-notice" role="status">{databaseError}</p> : null}
              {wishes.length === 0 ? (
                <div className="empty-state">Belum ada ucapan. Jadilah yang pertama mengirim doa terbaik.</div>
              ) : (
                wishes.map((item) => (
                  <div key={item.id} className="wish-item">
                    <strong>{item.name}</strong>
                    <p>{item.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="section-pad closing">
          <div className="closing-monogram">R<span>&</span>S</div>
          <h2>{brideDisplayName} <em>&</em> {groomDisplayName}</h2>
          <p>Terima kasih atas doa dan kehadiran Anda.</p>
        </section>
      </main>

      <AnimatePresence>
        {giftOpen && (
          <motion.div
            className="gift-modal-backdrop"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setGiftOpen(false)}
          >
            <motion.div
              className="gift-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gift-modal-title"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button className="gift-modal-close" type="button" onClick={() => setGiftOpen(false)} aria-label="Tutup informasi hadiah">
                <X size={18} />
              </button>
              <div className="gift-icon"><Gift size={22} /></div>
              <span className="eyebrow">Wedding Gift</span>
              <h2 id="gift-modal-title">Kirim tanda kasih</h2>
              <p className="gift-modal-intro">Terima kasih atas perhatian dan doa tulus Anda.</p>
              <dl className="gift-account-details">
                <div>
                  <dt>Nama Bank</dt>
                  <dd>{wedding.giftAccount.bank || 'Belum tersedia'}</dd>
                </div>
                <div>
                  <dt>No. Rekening</dt>
                  <dd className="gift-account-number">{wedding.giftAccount.accountNumber}</dd>
                </div>
                <div>
                  <dt>Atas Nama</dt>
                  <dd>{wedding.giftAccount.accountName}</dd>
                </div>
              </dl>
              <button className="button button-outline gift-copy-button" type="button" onClick={handleCopyAccount}>
                {giftStatus === 'Nomor rekening berhasil disalin.' ? <Check size={15} /> : <Copy size={15} />}
                Salin nomor rekening
              </button>
              <p className="gift-status" role="status" aria-live="polite">{giftStatus}</p>
              <form className="gift-report-form" onSubmit={handleGiftReportSubmit}>
                <h3>Sudah melakukan transfer?</h3>
                <p>Isi nama dan nominal transfer. Laporan ini akan kami cocokkan secara manual dengan mutasi rekening.</p>
                <label className="field-group">
                  <span>Nama Anda</span>
                  <input maxLength={100} required value={giftReport.name} onChange={(event) => setGiftReport({ ...giftReport, name: event.target.value })} placeholder="Masukkan nama" />
                </label>
                <label className="field-group">
                  <span>Nominal transfer (Rp)</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={18} required value={giftReport.amount} onChange={(event) => setGiftReport({ ...giftReport, amount: event.target.value.replace(/\D/g, '') })} placeholder="Contoh: 100000" />
                </label>
                <button className="button button-gold" type="submit" disabled={busy}>{busy ? 'Mengirim...' : 'Kirim laporan transfer'}</button>
                {giftReportStatus ? <p className="gift-report-status" role="status" aria-live="polite">{giftReportStatus}</p> : null}
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {giftThanksOpen && (
          <motion.div
            className="gift-modal-backdrop"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setGiftThanksOpen(false)}
          >
            <motion.div
              className="gift-modal gift-thanks-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="gift-thanks-title"
              initial={{ opacity: 0, y: 18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              onClick={(event) => event.stopPropagation()}
            >
              <button className="gift-modal-close" type="button" onClick={() => setGiftThanksOpen(false)} aria-label="Tutup ucapan terima kasih">
                <X size={18} />
              </button>
              <div className="gift-icon"><Check size={22} /></div>
              <span className="eyebrow">Wedding Gift</span>
              <h2 id="gift-thanks-title">Terima kasih</h2>
              <p className="gift-thanks-message">Semoga Allah membalasmu dengan kebaikan.</p>
              <button className="button button-gold" type="button" onClick={() => setGiftThanksOpen(false)}>Selesai</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {galleryIndex !== null && (
          <motion.div className="lightbox" role="dialog" aria-modal="true" aria-label="Galeri foto pernikahan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setGalleryIndex(null)}>
            <button type="button" className="lightbox-close" onClick={() => setGalleryIndex(null)} aria-label="Tutup galeri"><X size={18} /></button>
            <button type="button" className="lightbox-nav left" onClick={(event) => { event.stopPropagation(); setGalleryIndex((index) => (index - 1 + gallery.length) % gallery.length); }} aria-label="Galeri sebelumnya"><ChevronLeft size={22} /></button>
            <img src={gallery[galleryIndex]} alt={wedding.photos.galleryAlt?.[galleryIndex] || `Foto ${coupleNames} ${galleryIndex + 1}`} onClick={(event) => event.stopPropagation()} />
            <button type="button" className="lightbox-nav right" onClick={(event) => { event.stopPropagation(); setGalleryIndex((index) => (index + 1) % gallery.length); }} aria-label="Galeri selanjutnya"><ChevronRight size={22} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function App() {
  const isAdminRoute = window.location.pathname.replace(/\/+$/, '') === '/admin';
  return isAdminRoute ? <AdminPage /> : <WeddingInvitation />;
}

export default App;
