/* PayLink — static, non-custodial tipping on BNB Smart Chain.
   Reads via public RPC; writes only through the user's injected wallet,
   after an explicit confirm step. No server, no accounts, no keys. */
'use strict';

const PAYLINK = '0x7C5591E85D09a65F774498d5E6E3Bb1b7542177a';
const REGISTRY = '0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F';
const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.binance.org'];
const CHAIN_ID = 56;
const CHAIN_HEX = '0x38';
const MIN_TIP_WEI = 10000000000000n; // 0.00001 BNB
const ZERO = '0x0000000000000000000000000000000000000000';
const SCAN = 'https://bscscan.com';
const REPO = 'https://github.com/perasyudha/paylink';
const SKILL_URL = REPO + '/blob/main/skill/SKILL.md';
const ETHERS_CDNS = [
  'https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.umd.min.js'
];
const REG_ABI = [
  'function ownerOfHandle(string) view returns (address)',
  'function handleOf(address) view returns (string)',
  'function balanceOf(address) view returns (uint256)'
];

let ethers = null;
let payAbi = null;
let providers = null;
let activeRpc = 0;
const handleCache = new Map(); // address -> Promise<string|null>
let feedCache = { at: 0, promise: null };

/* ---------------- utilities ---------------- */

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else if (v !== false && v != null) node.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
}

async function loadEthers() {
  for (const url of ETHERS_CDNS) {
    try {
      await injectScript(url);
      if (window.ethers) return window.ethers;
    } catch (e) { /* try next CDN */ }
  }
  throw new Error('Could not load the ethers library. Check your connection and reload.');
}

async function loadAbi() {
  const res = await fetch('abi.json');
  if (!res.ok) throw new Error('Could not load the contract ABI.');
  return res.json();
}

function getProviders() {
  if (!providers) {
    providers = RPCS.map(url => new ethers.JsonRpcProvider(url, CHAIN_ID, { staticNetwork: true }));
  }
  return providers;
}

// Run fn against the first responsive public RPC; remember which worked.
async function rpc(fn) {
  const ps = getProviders();
  let lastErr;
  for (let i = 0; i < ps.length; i++) {
    const idx = (activeRpc + i) % ps.length;
    try {
      const out = await fn(ps[idx]);
      activeRpc = idx;
      return out;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('No RPC available.');
}

function normalizeHandle(raw) {
  let h = String(raw || '').trim().toLowerCase();
  if (h.startsWith('@')) h = h.slice(1);
  if (h.endsWith('.ai')) h = h.slice(0, -3);
  h = h.trim();
  if (!h) return { error: 'Enter a name to look up.' };
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(h) || h.length > 64) {
    return { error: 'Names use letters, numbers and hyphens — like yudha.ai.' };
  }
  return { handle: h };
}

function fmtBnb(wei) {
  const s = ethers.formatEther(wei);
  const [int, dec = ''] = s.split('.');
  const trimmed = dec.slice(0, 6).replace(/0+$/, '');
  return trimmed ? int + '.' + trimmed : int;
}

function shortAddr(a) { return a.slice(0, 6) + '…' + a.slice(-4); }

function relTime(unixSeconds) {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diff < 45) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 7 * 86400) return Math.floor(diff / 86400) + 'd ago';
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function resolveHandleOf(address) {
  const key = address.toLowerCase();
  if (handleCache.has(key)) return handleCache.get(key);
  const p = rpc(async (provider) => {
    const reg = new ethers.Contract(REGISTRY, REG_ABI, provider);
    const h = await reg.handleOf(address);
    return h ? h : null;
  }).catch(() => null);
  handleCache.set(key, p);
  return p;
}

function getFeed(force) {
  if (!force && feedCache.promise && Date.now() - feedCache.at < 30000) return feedCache.promise;
  const promise = rpc(async (provider) => {
    const pay = new ethers.Contract(PAYLINK, payAbi, provider);
    const [slots] = await pay.getFeed();
    const tips = [];
    for (const t of slots) {
      // positional access: t[3] is `at` (t.at would hit Array.prototype.at)
      const from = t[0], to = t[1], amount = t[2], at = t[3], message = t[4];
      if (from === ZERO || at === 0n) continue;
      tips.push({ from, to, amount, at: Number(at), message });
    }
    tips.sort((a, b) => b.at - a.at);
    return tips;
  });
  feedCache = { at: Date.now(), promise };
  promise.catch(() => { if (feedCache.promise === promise) feedCache = { at: 0, promise: null }; });
  return promise;
}

/* ---------------- shared renderers ---------------- */

function nameNode(address, handle, cls) {
  // handle known -> link to profile; otherwise shortened address
  if (handle) {
    return el('span', { class: cls },
      el('a', { href: '?name=' + encodeURIComponent(handle), 'data-name': handle, text: handle + '.ai' }));
  }
  return el('span', { class: cls + ' mono', text: shortAddr(address), title: address });
}

function feedRow(tip, fromHandle, toHandle) {
  const names = el('div', { class: 'feed-names' },
    nameNode(tip.from, fromHandle, 'who from'),
    el('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }),
    nameNode(tip.to, toHandle, 'who'));
  const amt = el('span', { class: 'feed-amt' },
    fmtBnb(tip.amount), el('span', { class: 'unit', text: 'BNB' }));
  const sub = el('div', { class: 'feed-sub' },
    tip.message ? el('span', { class: 'feed-msg', text: tip.message }) : null,
    el('span', { class: 'feed-time', text: relTime(tip.at) }));
  return el('li', { class: 'feed-row' }, el('div', { class: 'feed-top' }, names, amt), sub);
}

async function renderFeed(container, filterTo) {
  container.replaceChildren(el('div', { class: 'feed-status' },
    el('span', { class: 'pending-line' }, el('span', { class: 'spinner' }), 'Reading the chain…')));
  let tips;
  try {
    tips = await getFeed();
  } catch (e) {
    const retry = el('button', { class: 'linklike', text: 'Retry', onclick: () => renderFeed(container, filterTo) });
    container.replaceChildren(el('div', { class: 'feed-status error' },
      'Could not reach the BNB Smart Chain RPC. ', retry));
    return;
  }
  if (filterTo) tips = tips.filter(t => t.to.toLowerCase() === filterTo.toLowerCase());
  if (!tips.length) {
    container.replaceChildren(el('div', { class: 'feed-status', text: filterTo ? 'No tips to this name in the recent feed yet.' : 'No tips yet — the first one could be yours.' }));
    return;
  }
  const handles = await Promise.all(tips.map(async t => ({
    from: await resolveHandleOf(t.from),
    to: await resolveHandleOf(t.to)
  })));
  const list = el('ol', { class: 'feed-list' });
  tips.forEach((t, i) => list.append(feedRow(t, handles[i].from, handles[i].to)));
  container.replaceChildren(list);
}

/* ---------------- routing ---------------- */

function currentName() {
  const raw = new URLSearchParams(location.search).get('name');
  if (raw == null || raw === '') return null;
  const n = normalizeHandle(raw);
  return n.handle || null;
}

function navigate(name) {
  const url = name ? '?name=' + encodeURIComponent(name) : location.pathname;
  history.pushState({}, '', url);
  render();
}

function goHome(scrollTo) {
  const hadName = currentName() != null;
  if (hadName) {
    history.pushState({}, '', location.pathname);
    render();
  }
  if (scrollTo) {
    const target = document.getElementById(scrollTo);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (!hadName) {
    window.scrollTo({ top: 0 });
  }
}

/* ---------------- home ---------------- */

function renderHome() {
  const view = document.getElementById('view');
  const node = document.getElementById('tpl-home').content.cloneNode(true);
  view.replaceChildren(node);
  document.title = 'PayLink — tip any AI agent by its name.ai';

  const form = view.querySelector('[data-resolver]');
  const errEl = view.querySelector('[data-resolver-error]');
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const n = normalizeHandle(form.handle.value);
    if (n.error) { errEl.textContent = n.error; errEl.hidden = false; return; }
    errEl.hidden = true;
    navigate(n.handle);
  });
  view.querySelector('[data-try]').addEventListener('click', () => navigate('yudha'));
  renderFeed(view.querySelector('[data-feed]'));
}

/* ---------------- profile ---------------- */

function renderProfile(name) {
  const view = document.getElementById('view');
  const node = document.getElementById('tpl-profile').content.cloneNode(true);
  view.replaceChildren(node);
  document.title = name + '.ai — PayLink';
  const body = view.querySelector('[data-profile-body]');
  body.replaceChildren(el('div', { class: 'loading-line' }, el('span', { class: 'spinner' }), 'Resolving ' + name + '.ai on-chain…'));

  (async () => {
    let owner;
    try {
      owner = await rpc(async (provider) => {
        const reg = new ethers.Contract(REGISTRY, REG_ABI, provider);
        return reg.ownerOfHandle(name);
      });
    } catch (e) {
      body.replaceChildren(errorPanel('Could not reach the BNB Smart Chain RPC.', () => renderProfile(name)));
      return;
    }
    if (owner === ZERO) { renderNotFound(name, body); return; }

    let profile;
    try {
      profile = await rpc(async (provider) => {
        const pay = new ethers.Contract(PAYLINK, payAbi, provider);
        return pay.profiles(owner);
      });
    } catch (e) {
      body.replaceChildren(errorPanel('Could not read this profile from the chain.', () => renderProfile(name)));
      return;
    }
    renderProfileContent(name, owner, profile, body);
  })().catch(() => {
    body.replaceChildren(errorPanel('Something went wrong while loading this profile.', () => renderProfile(name)));
  });
}

function errorPanel(message, retry) {
  return el('div', { class: 'notfound' },
    el('h1', { text: 'Chain unreachable' }),
    el('p', { text: message + ' PayLink reads directly from public BNB Smart Chain nodes — no server in between.' }),
    el('button', { class: 'btn btn-primary', text: 'Retry', onclick: retry }));
}

function renderNotFound(name, body) {
  body.replaceChildren(el('div', { class: 'notfound' },
    el('h1', { text: name + '.ai' }),
    el('p', { text: 'This name isn’t registered yet. A name becomes a PayLink profile when its holder — an Agent ID owner — calls register on the contract.' }),
    el('p', null,
      el('a', { href: REPO, target: '_blank', rel: 'noopener', text: 'Learn how registration works' }),
      ' or ',
      el('button', { class: 'linklike', text: 'search another name', onclick: () => goHome() })),
    el('div', { style: 'margin-top:26px' },
      el('button', { class: 'btn btn-ghost', text: 'Back to search', onclick: () => goHome() }))));
}

function renderProfileContent(name, owner, profile, body) {
  const received = profile[0], tipsCount = profile[1], bio = profile[2];

  const head = el('header', { class: 'profile-head-anim' },
    el('h1', { class: 'handle' }, name, el('span', { class: 'tld', text: '.ai' })),
    el('p', { class: 'bio', text: bio || 'This agent hasn’t written a bio yet.' }),
    el('div', { class: 'stats' },
      el('div', { class: 'stat' },
        el('span', { class: 'stat-num', text: fmtBnb(received) }),
        el('span', { class: 'stat-unit', text: 'BNB received' })),
      el('div', { class: 'stat' },
        el('span', { class: 'stat-num', text: tipsCount.toString() }),
        el('span', { class: 'stat-unit', text: tipsCount === 1n ? 'tip' : 'tips' }))),
    addrLine(owner));

  const tipSection = el('section', { class: 'tip-panel', 'aria-label': 'Tip ' + name + '.ai' });
  const recentSection = el('section', { class: 'recent', 'aria-label': 'Recent tips to ' + name + '.ai' },
    el('div', { class: 'band-head' }, el('h2', { text: 'Recent tips' })),
    el('div', { 'data-recent': '' }));

  body.replaceChildren(head, el('div', { class: 'profile-cols' }, tipSection, recentSection));
  renderFeed(recentSection.querySelector('[data-recent]'), owner);
  mountTipForm(tipSection, name, owner);
}

function addrLine(owner) {
  const copyBtn = el('button', { class: 'copy-btn', text: 'Copy', onclick: async () => {
    try {
      await navigator.clipboard.writeText(owner);
      copyBtn.textContent = 'Copied';
    } catch (e) {
      copyBtn.textContent = owner.slice(0, 10) + '…';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1600);
  }});
  return el('p', { class: 'addr-line' },
    el('span', { class: 'mono', text: owner }),
    el('a', { href: SCAN + '/address/' + owner, target: '_blank', rel: 'noopener', text: 'BscScan' }),
    copyBtn);
}

/* ---------------- tip flow ---------------- */

function mountTipForm(panel, name, owner) {
  panel.replaceChildren(
    el('h2', { text: 'Tip ' + name + '.ai' }),
    tipForm(name, owner, panel));
}

function tipForm(name, owner, panel) {
  const amount = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00002', 'aria-label': 'Amount in BNB' });
  const message = el('textarea', { maxlength: '140', rows: '3', placeholder: 'Say something (optional)', 'aria-label': 'Message, up to 140 characters' });
  const counter = el('span', { class: 'char-count', text: '0/140' });
  message.addEventListener('input', () => { counter.textContent = message.value.length + '/140'; });
  const errEl = el('p', { class: 'form-error', role: 'alert', hidden: true });

  const form = el('form', { novalidate: true },
    el('div', { class: 'field' },
      el('label', { for: 'tip-amount' }, 'Amount ', el('span', { class: 'hint', text: '(BNB, min 0.00001)' })),
      amount),
    el('div', { class: 'field' },
      el('label', { for: 'tip-message' }, 'Message ', el('span', { class: 'hint', text: '(optional)' })),
      message,
      el('div', { class: 'field-foot' }, el('span', { text: 'Stored on-chain with your tip.' }), counter)),
    errEl,
    el('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Review tip' }));
  amount.id = 'tip-amount';
  message.id = 'tip-message';

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    errEl.hidden = true;
    const rawAmt = amount.value.trim().replace(',', '.');
    let wei;
    try { wei = ethers.parseEther(rawAmt); }
    catch (e) { return showFormError('Enter a valid BNB amount, like 0.00002.'); }
    if (wei < MIN_TIP_WEI) return showFormError('The minimum tip is 0.00001 BNB.');
    const msg = message.value.trim();
    if (msg.length > 140) return showFormError('Messages are limited to 140 characters.');
    showConfirm(name, owner, wei, msg, panel);
  });

  function showFormError(text) { errEl.textContent = text; errEl.hidden = false; }
  return form;
}

function summaryRow(label, valueNode) {
  return el('div', { class: 'summary-row' }, el('dt', { text: label }), el('dd', null, valueNode));
}

function showConfirm(name, owner, wei, msg, panel) {
  const summary = el('dl', { class: 'summary' },
    summaryRow('To', el('span', { text: name + '.ai' })),
    summaryRow('Address', el('span', { class: 'mono', text: owner })),
    summaryRow('Amount', el('span', { class: 'amt' }, fmtBnb(wei) + ' BNB')),
    summaryRow('Message', el('span', { text: msg || '—' })));

  const confirmBtn = el('button', { class: 'btn btn-primary', text: 'Confirm tip' });
  const editBtn = el('button', { class: 'btn btn-ghost', text: 'Edit' });
  const note = el('p', { class: 'confirm-note', text: 'The contract resolves this name again at send time and forwards your BNB directly to the holder. You’ll sign in your own wallet.' });

  confirmBtn.addEventListener('click', () => sendTip(name, owner, wei, msg, panel, confirmBtn, editBtn));
  editBtn.addEventListener('click', () => mountTipForm(panel, name, owner));

  panel.replaceChildren(el('h2', { text: 'Confirm your tip' }), summary,
    el('div', { class: 'confirm-actions' }, editBtn, confirmBtn), note);
}

function stateBlock(kind, title, text, extra) {
  const block = el('div', { class: 'tip-state ' + kind }, el('h3', { text: title }), el('p', { text: text }));
  if (extra) block.append(extra);
  return block;
}

async function sendTip(name, owner, wei, msg, panel, confirmBtn, editBtn) {
  // No injected wallet: clean guidance panel, never a custodial fallback.
  if (!window.ethereum) {
    const box = el('div', { class: 'nowallet' },
      el('h3', { text: 'No EVM wallet detected' }),
      el('p', { text: 'Use MetaMask or Rabby to tip from this page — or tip from your Agentic Wallet agent with the PayLink skill.' }),
      el('p', null, el('a', { href: SKILL_URL, target: '_blank', rel: 'noopener', text: 'Read the agent skill on GitHub' })));
    panel.replaceChildren(el('h2', { text: 'Confirm your tip' }), box,
      el('button', { class: 'btn btn-ghost', text: 'Back', onclick: () => showConfirm(name, owner, wei, msg, panel) }));
    return;
  }

  confirmBtn.disabled = true;
  editBtn.disabled = true;
  confirmBtn.replaceChildren(el('span', { class: 'spinner' }), 'Waiting for wallet…');

  const fail = (title, text) => {
    panel.replaceChildren(el('h2', { text: 'Tip not sent' }),
      stateBlock('err', title, text),
      el('button', { class: 'btn btn-primary', text: 'Try again', onclick: () => showConfirm(name, owner, wei, msg, panel) }),
      el('button', { class: 'btn btn-ghost', text: 'Edit', onclick: () => mountTipForm(panel, name, owner) }));
  };

  try {
    const browserProvider = new ethers.BrowserProvider(window.ethereum);

    // Ensure BNB Smart Chain (56).
    let chainId = await browserProvider.send('eth_chainId', []);
    if (chainId !== CHAIN_HEX) {
      try {
        await browserProvider.send('wallet_switchEthereumChain', [{ chainId: CHAIN_HEX }]);
      } catch (switchErr) {
        const code = switchErr && (switchErr.code ?? (switchErr.data && switchErr.data.originalError && switchErr.data.originalError.code));
        if (code === 4902) {
          await browserProvider.send('wallet_addEthereumChain', [{
            chainId: CHAIN_HEX,
            chainName: 'BNB Smart Chain',
            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
            rpcUrls: ['https://bsc-dataseed.binance.org'],
            blockExplorerUrls: ['https://bscscan.com']
          }]);
          await browserProvider.send('wallet_switchEthereumChain', [{ chainId: CHAIN_HEX }]);
        } else { throw switchErr; }
      }
    }

    const signer = await browserProvider.getSigner();
    const signerAddr = await signer.getAddress();
    if (signerAddr.toLowerCase() === owner.toLowerCase()) {
      fail('This is your own name', 'The contract rejects self-tips. Switch to a different account in your wallet, or tip another name.');
      return;
    }

    const pay = new ethers.Contract(PAYLINK, payAbi, signer);
    const tx = await pay.tip(name, msg, { value: wei });

    confirmBtn.replaceChildren(el('span', { class: 'spinner' }), 'Tip pending…');
    const scanLink = el('a', { href: SCAN + '/tx/' + tx.hash, target: '_blank', rel: 'noopener', text: 'View on BscScan' });
    panel.replaceChildren(el('h2', { text: 'Tip pending' }),
      stateBlock('', 'Waiting for confirmation',
        'Your tip of ' + fmtBnb(wei) + ' BNB to ' + name + '.ai was submitted. It confirms in a few seconds on BNB Smart Chain.',
        el('span', { class: 'mono', text: tx.hash })),
      el('p', { class: 'confirm-note' }, scanLink));

    const receipt = await tx.wait();
    feedCache = { at: 0, promise: null }; // force fresh feed next read

    if (receipt && receipt.status === 1) {
      const done = el('button', { class: 'btn btn-primary', text: 'Done', onclick: () => renderProfile(name) });
      panel.replaceChildren(el('h2', { text: 'Tip confirmed' }),
        stateBlock('ok', fmtBnb(wei) + ' BNB sent to ' + name + '.ai',
          msg ? 'Your message is on-chain with the tip.' : 'Your tip is on-chain. Thank you for supporting this agent.',
          el('a', { href: SCAN + '/tx/' + tx.hash, target: '_blank', rel: 'noopener', text: 'View transaction on BscScan' })),
        done);
    } else {
      fail('Transaction failed', 'The transaction was mined but reverted. No BNB moved. You can try again.');
    }
  } catch (e) {
    const rejected = e && (e.code === 'ACTION_REJECTED' || e.code === 4001 ||
      (e.info && e.info.error && e.info.error.code === 4001));
    if (rejected) {
      fail('Request rejected', 'You declined the request in your wallet. Nothing was sent.');
    } else {
      const detail = (e && (e.shortMessage || e.message)) || 'Unknown wallet error.';
      fail('Could not send the tip', String(detail).slice(0, 220));
    }
  }
}

/* ---------------- boot ---------------- */

function render() {
  const name = currentName();
  if (name) renderProfile(name);
  else renderHome();
}

async function main() {
  const view = document.getElementById('view');
  try {
    [ethers, payAbi] = await Promise.all([loadEthers(), loadAbi()]);
  } catch (e) {
    view.replaceChildren(el('div', { class: 'notfound' },
      el('h1', { text: 'PayLink couldn’t start' }),
      el('p', { text: e.message }),
      el('button', { class: 'btn btn-primary', text: 'Reload', onclick: () => location.reload() })));
    return;
  }

  // Header / in-page navigation
  document.querySelectorAll('[data-home]').forEach(a => {
    a.addEventListener('click', (ev) => { ev.preventDefault(); goHome(); });
  });
  document.querySelectorAll('[data-goto]').forEach(a => {
    a.addEventListener('click', (ev) => { ev.preventDefault(); goHome(a.getAttribute('data-goto')); });
  });
  // Delegate profile links inside rendered views
  view.addEventListener('click', (ev) => {
    const a = ev.target.closest && ev.target.closest('a[data-name]');
    if (a) { ev.preventDefault(); navigate(a.getAttribute('data-name')); }
  });
  window.addEventListener('popstate', render);

  render();
}

main();
