/* ==================================================================
   مصحف — كل منطق التطبيق في ملف واحد (جافاسكربت عادي، بدون مكتبات)
   ------------------------------------------------------------------
   بنية البيانات في data/quran.json:
     surahs : [{n, name, tr, type, c, p}]            114 سورة
     pages  : [[بداية, نهاية], ...]                  604 صفحة (فهارس في verses)
     juz    : [رقم أول صفحة في كل جزء]               30 جزءًا
     verses : [[سورة, آية, صفحة, جزء, "النص", سجدة]] 6236 آية
   ================================================================== */

const APP_VERSION = '1.0.0';

// ------- اختصارات قصيرة -------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ------- الحالة -------
let DB = null;                 // بيانات المصحف بعد التحميل
let currentPage = 1;           // الصفحة المعروضة الآن (1 إلى 604)
let searchIndex = null;        // فهرس البحث (يُبنى عند أول بحث فقط)
let wakeLock = null;           // إبقاء الشاشة مضاءة

// ==================================================================
// 1) التخزين المحلي (يحفظ آخر صفحة والإعدادات في المتصفح)
// ==================================================================
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('mushaf.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('mushaf.' + key, JSON.stringify(value)); } catch (e) {}
  }
};

// ==================================================================
// 2) أدوات مساعدة للنصوص العربية
// ==================================================================

// تحويل الأرقام إلى أرقام عربية (١٢٣)
const AR_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
function arNum(n) {
  return String(n).split('').map(d => AR_DIGITS[+d] ?? d).join('');
}

// علامة نهاية الآية: ۝ متبوعة برقم الآية
function ayahMark(n) {
  return '۝' + arNum(n);
}

// تجريد النص من التشكيل والعلامات ليعمل البحث بدون حركات
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
function normalize(text) {
  return text
    .replace(DIACRITICS, '')
    .replace(/[آأإاٱ]/g, 'ا')  // أ إ آ ٱ  ->  ا
    .replace(/[ؤ]/g, 'و')
    .replace(/[ئى]/g, 'ي')
    .replace(/ة/g, 'ه')                            // ة -> ه
    .replace(/\s+/g, ' ')
    .trim();
}

// ==================================================================
// 3) رسم صفحة المصحف
// ==================================================================
function renderPage(pageNo) {
  pageNo = Math.min(604, Math.max(1, pageNo));
  currentPage = pageNo;

  const [from, to] = DB.pages[pageNo - 1];
  const box = $('#page');
  const parts = [];

  let lastSurah = null;
  let open = false; // هل هناك فقرة <p> مفتوحة؟

  for (let i = from; i <= to; i++) {
    const [sNo, aNo, , , text] = DB.verses[i];

    // إذا بدأت سورة جديدة داخل الصفحة، نضع عنوانها والبسملة
    if (sNo !== lastSurah) {
      if (open) { parts.push('</p>'); open = false; }
      const s = DB.surahs[sNo - 1];
      parts.push(
        '<div class="surah-head" id="sh-' + sNo + '">' +
          '<span class="nm">سُورَةُ ' + s.name + '</span>' +
          '<span class="meta"><bdi>' + arNum(s.c) + ' آية</bdi> · <bdi>' + s.type + '</bdi></span>' +
        '</div>'
      );
      // البسملة تُعرض لكل السور ما عدا الفاتحة (البسملة آية فيها) والتوبة
      if (sNo !== 1 && sNo !== 9 && aNo === 1) {
        parts.push('<div class="basmala">بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ</div>');
      }
      lastSurah = sNo;
    }

    if (!open) { parts.push('<p class="ayat">'); open = true; }
    parts.push(
      '<span class="ayah" data-i="' + i + '">' + text +
      '<span class="ayah-num">' + ayahMark(aNo) + '</span></span> '
    );
  }
  if (open) parts.push('</p>');

  const juzNo = DB.verses[from][3];
  parts.push(
    '<div class="page-footer">' +
      '<bdi>' + DB.surahs[DB.verses[from][0] - 1].name + '</bdi>' +
      '<bdi>صفحة ' + arNum(pageNo) + '</bdi>' +
      '<bdi>الجزء ' + arNum(juzNo) + '</bdi>' +
    '</div>'
  );

  box.innerHTML = parts.join('');
  $('#page-wrap').scrollTop = 0;

  // تحديث الشريط العلوي والسفلي
  $('#t-surah').textContent = DB.surahs[DB.verses[from][0] - 1].name;
  $('#t-juz').textContent = 'الجزء ' + arNum(juzNo);
  $('#t-page').textContent = arNum(pageNo);
  document.title = 'مصحف · ' + $('#t-surah').textContent;

  store.set('lastPage', pageNo);
}

function goToPage(p, highlightIndex) {
  renderPage(p);
  if (highlightIndex != null) {
    const el = $('.ayah[data-i="' + highlightIndex + '"]');
    if (el) {
      el.classList.add('hl');
      el.scrollIntoView({ block: 'center' });
      setTimeout(() => el.classList.remove('hl'), 2200);
    }
  }
}

// الانتقال إلى أول آية في سورة، مع التمرير إلى عنوانها في الصفحة
function goToSurah(sNo) {
  const idx = DB.verses.findIndex(v => v[0] === sNo && v[1] === 1);
  renderPage(DB.verses[idx][2]);
  const head = document.getElementById('sh-' + sNo);
  if (head) head.scrollIntoView({ block: 'start' });
  $('#t-surah').textContent = DB.surahs[sNo - 1].name;   // اسم السورة التي انتقلنا إليها
}

// ==================================================================
// 4) الفهرس (السور والأجزاء)
// ==================================================================
function buildIndex() {
  $('#list-surahs').innerHTML = DB.surahs.map(s =>
    '<button class="row" data-surah="' + s.n + '">' +
      '<span class="num">' + arNum(s.n) + '</span>' +
      '<span class="body">' +
        '<span class="t1">' + s.name + '</span>' +
        '<span class="t2"><bdi>' + arNum(s.c) + ' آية</bdi> · <bdi>' + s.type + '</bdi></span>' +
      '</span>' +
      '<span class="side">ص ' + arNum(s.p) + '</span>' +
    '</button>'
  ).join('');

  $('#list-juz').innerHTML = DB.juz.map((page, i) => {
    const v = DB.verses.find(x => x[2] === page && x[3] === i + 1) || DB.verses[0];
    const s = DB.surahs[v[0] - 1];
    return '<button class="row" data-page="' + page + '">' +
      '<span class="num">' + arNum(i + 1) + '</span>' +
      '<span class="body">' +
        '<span class="t1">الجزء ' + arNum(i + 1) + '</span>' +
        '<span class="t2"><bdi>يبدأ من ' + s.name + '</bdi> · <bdi>آية ' + arNum(v[1]) + '</bdi></span>' +
      '</span>' +
      '<span class="side">ص ' + arNum(page) + '</span>' +
    '</button>';
  }).join('');
}

// ==================================================================
// 5) البحث
// ==================================================================
function runSearch(query) {
  const out = $('#results');
  const q = normalize(query);

  if (q.length < 2) {
    out.innerHTML = '<div class="empty">اكتب كلمتين أو أكثر للبحث.</div>';
    return;
  }

  // نبني فهرس البحث مرة واحدة فقط (لتوفير الذاكرة عند البدء)
  if (!searchIndex) {
    searchIndex = DB.verses.map(v => normalize(v[4]));
  }

  const hits = [];
  for (let i = 0; i < searchIndex.length && hits.length < 200; i++) {
    if (searchIndex[i].includes(q)) hits.push(i);
  }

  if (!hits.length) {
    out.innerHTML = '<div class="empty">لا توجد نتائج مطابقة.</div>';
    return;
  }

  out.innerHTML =
    '<div class="empty" style="padding:10px">' + arNum(hits.length) +
    (hits.length === 200 ? '+ نتيجة' : ' نتيجة') + '</div>' +
    hits.map(i => {
      const [sNo, aNo, page] = DB.verses[i];
      const s = DB.surahs[sNo - 1];
      return '<button class="row" data-page="' + page + '" data-i="' + i + '">' +
        '<span class="body">' +
          '<span class="res-ayah">' + DB.verses[i][4] + '</span>' +
          '<span class="t2"><bdi>' + s.name + '</bdi> · <bdi>آية ' + arNum(aNo) + '</bdi> · <bdi>صفحة ' + arNum(page) + '</bdi></span>' +
        '</span>' +
      '</button>';
    }).join('');
}

// ==================================================================
// 6) الإعدادات (المظهر، حجم الخط، إبقاء الشاشة مضاءة)
// ==================================================================
function applyTheme(name) {
  document.documentElement.setAttribute('data-theme', name);
  const colors = { light: '#ffffff', sepia: '#f7f3e8', dark: '#101215' };
  document.querySelector('meta[name=theme-color]').setAttribute('content', colors[name] || '#f7f3e8');
  $$('#theme-seg button').forEach(b => b.classList.toggle('on', b.dataset.theme === name));
  store.set('theme', name);
}

function applyFontSize(px) {
  document.documentElement.style.setProperty('--fs', px + 'px');
  $('#fs').value = px;
  $('#fs-val').textContent = arNum(px);
  store.set('fontSize', px);
}

async function setAwake(on) {
  store.set('awake', on);
  try {
    if (on && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    } else if (wakeLock) {
      await wakeLock.release(); wakeLock = null;
    }
  } catch (e) { /* غير مدعوم في بعض المتصفحات */ }
}

// ==================================================================
// 7) فتح وإغلاق الشاشات
// ==================================================================
function openScreen(id) { $('#' + id).classList.add('open'); }
function closeScreens() { $$('.screen.sheet').forEach(s => s.classList.remove('open')); $('#goto').classList.remove('open'); }

// ==================================================================
// 8) ربط الأحداث
// ==================================================================
function wireEvents() {
  // التنقل بين الصفحات
  // ملاحظة: في العربية (من اليمين لليسار) زر "التالي" ينقلنا لصفحة بعدها
  $('#btn-next').onclick = () => renderPage(currentPage + 1);
  $('#btn-prev').onclick = () => renderPage(currentPage - 1);

  // فتح الشاشات
  $('#btn-index').onclick = () => openScreen('index');
  $('#btn-settings').onclick = () => openScreen('settings');
  $('#btn-search').onclick = () => { openScreen('search'); setTimeout(() => $('#q').focus(), 300); };
  $('#btn-goto').onclick = () => { $('#goto').classList.add('open'); $('#goto-input').value = ''; setTimeout(() => $('#goto-input').focus(), 100); };

  // أزرار الإغلاق
  $$('[data-close]').forEach(b => b.onclick = closeScreens);
  $('#goto').onclick = (e) => { if (e.target.id === 'goto') closeScreens(); };
  $('#goto-ok').onclick = () => {
    const p = parseInt($('#goto-input').value, 10);
    if (p >= 1 && p <= 604) { closeScreens(); goToPage(p); }
  };
  $('#goto-input').onkeydown = (e) => { if (e.key === 'Enter') $('#goto-ok').click(); };

  // تبويبات الفهرس
  $$('.tab').forEach(t => t.onclick = () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('#list-surahs').classList.toggle('hidden', t.dataset.tab !== 'surahs');
    $('#list-juz').classList.toggle('hidden', t.dataset.tab !== 'juz');
  });

  // النقر على عنصر في أي قائمة
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    closeScreens();
    if (row.dataset.surah) goToSurah(+row.dataset.surah);
    else if (row.dataset.page) goToPage(+row.dataset.page, row.dataset.i ? +row.dataset.i : null);
  });

  // البحث أثناء الكتابة (مع تأخير بسيط حتى لا يبطئ الجهاز)
  let timer;
  $('#q').oninput = (e) => {
    clearTimeout(timer);
    const val = e.target.value;
    timer = setTimeout(() => runSearch(val), 250);
  };

  // الإعدادات
  $$('#theme-seg button').forEach(b => b.onclick = () => applyTheme(b.dataset.theme));
  $('#fs').oninput = (e) => applyFontSize(+e.target.value);
  $('#awake').onchange = (e) => setAwake(e.target.checked);

  // لوحة المفاتيح (للحاسوب)
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('.screen.sheet.open') || $('#goto').classList.contains('open')) {
      if (e.key === 'Escape') closeScreens();
      return;
    }
    if (e.key === 'ArrowLeft') renderPage(currentPage + 1);
    if (e.key === 'ArrowRight') renderPage(currentPage - 1);
  });

  // السحب بالإصبع لتقليب الصفحات
  let x0 = null, y0 = null;
  const wrap = $('#page-wrap');
  wrap.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      renderPage(currentPage + (dx > 0 ? 1 : -1)); // السحب لليمين = الصفحة التالية
    }
    x0 = null;
  }, { passive: true });

  // النقر على فراغ الصفحة يخفي/يظهر الأشرطة
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('.ayah') || e.target.closest('.row')) return;
    document.body.classList.toggle('immersive');
  });

  // إعادة طلب إبقاء الشاشة مضاءة عند العودة للتطبيق
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && store.get('awake', false)) setAwake(true);
  });
}

// ==================================================================
// 9) بدء التشغيل
// ==================================================================
async function start() {
  // نطبّق الإعدادات المحفوظة أولاً حتى لا تظهر الشاشة بلون خاطئ
  applyTheme(store.get('theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'sepia'));
  applyFontSize(store.get('fontSize', 30));

  try {
    const res = await fetch('data/quran.json');
    DB = await res.json();
  } catch (e) {
    $('#splash').innerHTML = '<div class="splash-text">تعذّر تحميل بيانات المصحف.<br>تأكد من الاتصال ثم أعد فتح التطبيق.</div>';
    return;
  }

  buildIndex();
  wireEvents();
  renderPage(store.get('lastPage', 1));

  $('#awake').checked = store.get('awake', false);
  if ($('#awake').checked) setAwake(true);
  $('#ver').textContent = 'الإصدار ' + APP_VERSION;

  $('#splash').classList.add('gone');
  setTimeout(() => $('#splash').remove(), 400);

  // تسجيل الـ Service Worker ليعمل التطبيق بدون إنترنت
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
