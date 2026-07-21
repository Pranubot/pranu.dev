// Config

const NAV_LINKS = [
  { label: 'Home',     href: './'         },
  { label: 'Projects', href: 'projects/'  },
  { label: 'Blog',     href: 'blog/'      },
  { label: 'Contact',  href: 'contact/'   },
];

// 88×31 footer badges
const BADGES = [
  { label: 'github',      href: 'https://github.com/pranavyadav', external: true  },
  { label: 'linkedin',    href: 'https://linkedin.com/in/pranavyadav', external: true },
  { label: 'coded\nby hand', href: '#', external: false },
  { label: 'dark\nmode ◆',   href: '#', external: false },
  { label: '', img: 'ucm-logo.png', href: 'https://ucmerced.edu', external: true, title: 'UC Merced' },
];

//  Helpers

function getCurrentPage() {
  const parts = window.location.pathname.split('/').filter(s => s && s !== 'index.html');
  if (parts.includes('projects')) return 'Projects';
  if (parts.includes('blog'))     return 'Blog';
  if (parts.includes('contact'))  return 'Contact';
  return 'Home';
}

// Render

function renderHeader() {
  const current = getCurrentPage();

  const isFile = location.protocol === 'file:';
  const linksHtml = NAV_LINKS.map((link, i) => {
    const href = isFile && link.href.endsWith('/') ? link.href + 'index.html' : link.href;
    const isActive = link.label === current;
    const sep = i < NAV_LINKS.length - 1 ? '<span class="nav-sep">|</span>' : '';
    return `<a href="${href}"${isActive ? ' class="active"' : ''}>${link.label}</a>${sep}`;
  }).join('');

  return `
<nav class="site-nav">
  <div class="wrapper nav-inner">
    <a href="${isFile ? 'index.html' : './'}" class="nav-brand">
      <span class="nav-logo-wrap">
        <img  class="nav-logo nav-logo-still" src="images/logo.jpg" alt="pranav yadav">
        <video class="nav-logo nav-logo-hover" src="images/logo-hover.mov" muted playsinline preload="auto" loop></video>
      </span>
    </a>
    <div class="nav-links">${linksHtml}</div>
  </div>
</nav>`;
}

function renderFooter() {
  const year = new Date().getFullYear();

  return `
<footer class="site-footer">
  <div class="wrapper footer-inner">
    <p class="footer-meta">
      Pranav Yadav // ${year}
      &nbsp;·&nbsp;
      <a href="https://github.com/pranubot" target="_blank" rel="noopener">Github ↗</a>
      &nbsp;·&nbsp;
      <a href="https://linkedin.com/in/pranavyadav99/" target="_blank" rel="noopener">Linkedin ↗</a>
    </p>
  </div>
</footer>`;
}

// Init

document.addEventListener('DOMContentLoaded', () => {
  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');
  if (header) header.innerHTML = renderHeader();
  if (footer) footer.innerHTML = renderFooter();

  const logoWrap = document.querySelector('.nav-logo-wrap');
  const logoStill = document.querySelector('.nav-logo-still');
  const logoVid   = document.querySelector('.nav-logo-hover');
  if (logoWrap && logoVid) {
    logoWrap.addEventListener('mouseenter', () => {
      logoStill.style.opacity = '0';
      logoVid.style.opacity   = '1';
      logoVid.currentTime = 0;
      logoVid.play();
    });
    logoWrap.addEventListener('mouseleave', () => {
      logoVid.pause();
      logoVid.style.opacity   = '0';
      logoStill.style.opacity = '1';
    });
  }
});
