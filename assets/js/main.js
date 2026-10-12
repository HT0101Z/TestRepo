/* =========================================================
   Faunira: site scripts
   ========================================================= */

/* Contact details used by the enquiry form and WhatsApp links.
   SRP: these are sample values and must be replaced with the real ones. */
const CONFIG = {
  whatsapp: '919000000000',      // country code + number, digits only
  email: 'info@faunira.com',
};

/* ---------- Theme toggle ---------- */
(function themeToggle() {
  const root = document.documentElement;
  const btn = document.getElementById('themeToggle');
  if (!btn) return;

  const label = () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    btn.setAttribute('aria-label', `Switch to ${next} theme`);
  };
  label();

  btn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('faunira-theme', next); } catch (e) { /* storage unavailable */ }
    label();
  });
})();

/* ---------- Navigation: shadow on scroll + mobile menu ---------- */
(function navigation() {
  const nav = document.getElementById('nav');
  const burger = document.getElementById('navBurger');
  const links = document.getElementById('navLinks');

  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  const setOpen = (open) => {
    links.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };
  burger.addEventListener('click', () => setOpen(!links.classList.contains('is-open')));
  links.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
})();

/* ---------- Toast ---------- */
const toast = (() => {
  const el = document.getElementById('toast');
  let timer;
  return (msg) => {
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  };
})();

/* Pages that are not built yet show a friendly notice instead of a 404 */
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-soon]');
  if (!link) return;
  e.preventDefault();
  toast(`The ${link.textContent.trim()} page is coming soon.`);
});

/* ---------- Scroll reveal ---------- */
(function reveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  // Stagger siblings inside the same grid; anything already on screen shows at once
  items.forEach((el) => {
    if (el.getBoundingClientRect().top < window.innerHeight) { el.classList.add('is-in'); return; }
    const siblings = [...el.parentElement.children].filter((c) => c.classList.contains('reveal'));
    el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 5) * 80}ms`;
    io.observe(el);
  });
})();

/* ---------- Animated counters ---------- */
(function counters() {
  const nums = document.querySelectorAll('[data-count]');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const run = (el) => {
    const target = Number(el.dataset.count);
    if (reduce) { el.textContent = target; return; }
    const start = performance.now();
    const dur = 1600;
    const step = (now) => {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  if (!('IntersectionObserver' in window)) { nums.forEach(run); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      run(entry.target);
      io.unobserve(entry.target);
    });
  }, { threshold: 0.5 });
  nums.forEach((n) => io.observe(n));
})();

/* ---------- WhatsApp links use the configured number ---------- */
document.querySelectorAll('a[data-wa]').forEach((a) => {
  const text = encodeURIComponent('Hello Faunira, I would like to know more about your products.');
  a.href = `https://wa.me/${CONFIG.whatsapp}?text=${text}`;
});

/* ---------- Enquiry form ---------- */
(function enquiryForm() {
  const form = document.getElementById('enquiryForm');
  if (!form) return;
  const message = form.querySelector('#fMessage');

  // "Enquire" on a product card pre-fills the message
  document.querySelectorAll('[data-product]').forEach((btn) => {
    btn.addEventListener('click', () => {
      message.value = `I'm interested in ${btn.dataset.product}. Quantity: `;
      setTimeout(() => form.querySelector('#fName').focus({ preventScroll: true }), 600);
    });
  });

  const validate = () => {
    let ok = true;
    form.querySelectorAll('input[required]').forEach((input) => {
      const valid = input.value.trim() !== '' && input.checkValidity();
      input.closest('.field').classList.toggle('is-invalid', !valid);
      if (!valid && ok) { input.focus(); ok = false; }
    });
    return ok;
  };

  form.querySelectorAll('input[required]').forEach((input) => {
    input.addEventListener('input', () => input.closest('.field').classList.remove('is-invalid'));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validate()) return;

    const d = Object.fromEntries(new FormData(form));
    const body = [
      'New enquiry from the Faunira website',
      '',
      `Name: ${d.name}`,
      `Phone: ${d.phone}`,
      `I am a: ${d.role}`,
      `Interested in: ${d.category}`,
      d.message ? `Message: ${d.message}` : '',
    ].filter((line, i) => line !== '' || i === 1).join('\n');

    const via = e.submitter?.dataset.send || 'whatsapp';
    if (via === 'email') {
      const subject = encodeURIComponent(`Enquiry: ${d.category} (${d.name})`);
      window.location.href = `mailto:${CONFIG.email}?subject=${subject}&body=${encodeURIComponent(body)}`;
    } else {
      window.open(`https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(body)}`, '_blank', 'noopener');
    }
    toast('Thank you! Your enquiry is ready to send.');
  });
})();

/* ---------- Footer year ---------- */
const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();
