/* ============================================================
   FOCYL — LIBRARY PICKER
   Renders any library from focyl-libraries.js into a panel.
   Adding a tenth library requires zero changes to this file.

   Mount:
     FocylPicker.mount('#panelPapers', 'papers', {
       tier: session.tier,
       onPick: item => addTile({ ... })
     });
   ============================================================ */
(() => {
  const CSS = `
  .fp-chips { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0 12px; }
  .fp-chip {
    background:var(--ink-2,#121a34); border:1px solid var(--line,rgba(237,239,247,.09));
    color:var(--mist,#9AA4C7); border-radius:999px; padding:5px 11px;
    font-size:.72rem; font-family:inherit; cursor:pointer; white-space:nowrap;
  }
  .fp-chip.active { background:var(--violet,#8B7CF6); color:#070914; border-color:transparent; }
  .fp-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-top:4px; }
  .fp-item {
    position:relative; aspect-ratio:1; border-radius:10px; cursor:pointer;
    border:1px solid var(--line,rgba(237,239,247,.09));
    background:var(--ink,#0d1224) center/cover no-repeat;
    display:flex; align-items:flex-end; padding:6px; overflow:hidden;
  }
  .fp-item:hover { border-color:var(--violet,#8B7CF6); }
  .fp-item span {
    font-size:.62rem; color:#EDEFF7; line-height:1.2;
    text-shadow:0 1px 4px rgba(0,0,0,.9);
  }
  .fp-item.locked { opacity:.45; cursor:not-allowed; }
  .fp-item.locked::after {
    content:"⬥"; position:absolute; top:6px; right:7px;
    font-size:.7rem; color:var(--cyan,#35D8F0);
  }
  .fp-empty {
    grid-column:1/-1; padding:22px 14px; text-align:center;
    color:var(--mist,#9AA4C7); font-size:.75rem; line-height:1.5;
    border:1px dashed var(--line,rgba(237,239,247,.14)); border-radius:12px;
  }
  .fp-empty code { font-size:.7rem; opacity:.85; }
  `;

  let injected = false;
  function injectCSS() {
    if (injected) return;
    const s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
    injected = true;
  }

  async function mount(target, libraryId, opts = {}) {
    injectCSS();
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) return;

    const lib = await FocylLibraries.load(libraryId);
    const tier = opts.tier || 'free';
    let category = null;

    const chips = document.createElement('div');
    chips.className = 'fp-chips';
    const grid = document.createElement('div');
    grid.className = 'fp-grid';

    const makeChip = (label, value) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fp-chip' + (value === category ? ' active' : '');
      b.textContent = label;
      b.onclick = () => { category = value; draw(); };
      return b;
    };

    async function draw() {
      chips.innerHTML = '';
      chips.appendChild(makeChip('All', null));
      lib.categories.forEach(c =>
        chips.appendChild(makeChip(c.replace(/-/g, ' '), c)));

      grid.innerHTML = '';
      const items = await FocylLibraries.items(libraryId, { category });

      if (!items.length) {
        const e = document.createElement('div');
        e.className = 'fp-empty';
        e.innerHTML = `Nothing in <b>${lib.label}</b> yet.<br>` +
          `<code>libraries/${libraryId}/index.json</code>`;
        grid.appendChild(e);
        return;
      }

      items.forEach(item => {
        const d = document.createElement('div');
        const unlocked = FocylLibraries.canUse(item, tier);
        d.className = 'fp-item' + (unlocked ? '' : ' locked');
        if (item.thumb) {
          d.style.backgroundImage = `url('${FocylLibraries.assetUrl(libraryId, item.thumb)}')`;
        } else if (item.fill) {
          d.style.background = item.fill;
        }
        d.innerHTML = `<span>${item.name || item.id}</span>`;
        d.onclick = () => {
          if (!unlocked) return opts.onLocked?.(item);
          opts.onPick?.({ ...item, library_id: libraryId, asset_id: item.id });
        };
        grid.appendChild(d);
      });
    }

    host.appendChild(chips);
    host.appendChild(grid);
    await draw();
    return { refresh: draw };
  }

  window.FocylPicker = { mount };
})();
