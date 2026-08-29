/* ============================================================
   FOCYL — BRAND MARK
   One definition. Every page. Zero duplicated markup.

   Usage anywhere in HTML:
     <focyl-mark></focyl-mark>                  32px, static
     <focyl-mark size="150"></focyl-mark>       any pixel size
     <focyl-mark size="30" link></focyl-mark>   clickable → index.html
     <focyl-mark size="220" animate></focyl-mark>  blades converge on load
     <focyl-mark variant="press"></focyl-mark>  square core (Press tier)
     <focyl-mark variant="film"></focyl-mark>   pulsing core (Film tier)

   Replaces:
     - the 22,020-character base64 <img> in index.html and board.html
     - the 18-line inline <svg> in auth.html
     - the three 14-line tier icons in index.html
   ============================================================ */
(() => {
  const BLADE = 'M 66,44 C 80,40 90,46 90,50 C 90,54 80,60 66,56 C 60,53 60,47 66,44 Z';
  const OFFSETS = [-10, 50, 110, 170, 230, 290];

  // Inline <style> rather than adoptedStyleSheets: same result, but works
  // on Safari 10+ instead of Safari 16.4+. Matters for older iPhones
  // installing this as a PWA.
  const STYLE = `
    :host { display:inline-block; line-height:0; }
    :host([link]) { cursor:pointer; }
    svg { width:100%; height:100%; display:block; overflow:visible; }
    .blade { transform-origin:50px 50px; }
    :host([animate]) .blade {
      animation: converge 1.1s cubic-bezier(.22,1,.36,1) both;
    }
    :host([animate]) .core {
      animation: bloom .7s .5s cubic-bezier(.22,1,.36,1) both;
    }
    :host([variant="film"]) .core {
      animation: pulse 2.6s ease-in-out infinite;
    }
    @keyframes converge {
      from { transform: rotate(var(--from)) translateX(38px); opacity:0; }
      to   { transform: rotate(var(--to))   translateX(0);    opacity:1; }
    }
    @keyframes bloom { from { transform:scale(0); } to { transform:scale(1); } }
    @keyframes pulse { 0%,100% { opacity:.55; } 50% { opacity:1; } }
    @media (prefers-reduced-motion: reduce) {
      .blade, .core { animation:none !important; }
    }
  `;

  class FocylMark extends HTMLElement {
    static observedAttributes = ['size', 'variant'];

    connectedCallback() {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.render();
      if (this.hasAttribute('link') && !this._wired) {
        this._wired = true;
        this.setAttribute('role', 'link');
        this.setAttribute('tabindex', '0');
        const go = () => (window.location.href = this.getAttribute('href') || 'index.html');
        this.addEventListener('click', go);
        this.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      }
    }

    attributeChangedCallback() { if (this.shadowRoot) this.render(); }

    render() {
      const size = this.getAttribute('size') || 32;
      const variant = this.getAttribute('variant') || 'board';
      const spin = variant === 'press' ? 25 : variant === 'film' ? 0 : 0;
      const gid = 'g' + Math.random().toString(36).slice(2, 8);

      const blades = OFFSETS.map(deg => {
        const to = deg + spin;
        return `<g class="blade" style="--from:${to - 60}deg;--to:${to}deg;transform:rotate(${to}deg)">
                  <path d="${BLADE}"/>
                </g>`;
      }).join('');

      const core = variant === 'press'
        ? `<rect class="core" x="44" y="44" width="12" height="12" rx="2" fill="url(#${gid})" style="transform-origin:50px 50px"/>`
        : `<circle class="core" cx="50" cy="50" r="6" fill="url(#${gid})" style="transform-origin:50px 50px"/>`;

      this.style.width = `${size}px`;
      this.style.height = `${size}px`;

      this.shadowRoot.innerHTML = `
        <style>${STYLE}</style>
        <svg viewBox="0 0 100 100" aria-label="Focyl" role="img">
          <defs>
            <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stop-color="var(--focyl-c1, #35D8F0)"/>
              <stop offset="55%"  stop-color="var(--focyl-c2, #8B7CF6)"/>
              <stop offset="100%" stop-color="var(--focyl-c3, #EA4FC9)"/>
            </linearGradient>
          </defs>
          <g fill="url(#${gid})">${blades}</g>
          ${core}
        </svg>`;
    }
  }

  if (!customElements.get('focyl-mark')) customElements.define('focyl-mark', FocylMark);
})();
