/*! PlumbVoice website chat widget. Usage:
 *  <script src="https://YOUR_APP/plumbvoice-widget.js" data-org="YOUR_ORGANIZATION_ID" async></script>
 *  The site's domain must be allow-listed in PlumbVoice (extras.chatWidget.allowedDomains). */
(function () {
  var s = document.currentScript;
  if (!s || window.__plumbvoiceChat) return;
  window.__plumbvoiceChat = true;
  var org = s.getAttribute('data-org');
  if (!org) return;
  var base = new URL(s.src).origin;
  var api = base + '/api/public/chat/' + encodeURIComponent(org);
  var sid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  var turns = [];
  var busy = false;

  fetch(api).then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
    if (cfg) mount(cfg);
  }).catch(function () {});

  function el(tag, css, text) {
    var e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text) e.textContent = text;
    return e;
  }

  function mount(cfg) {
    var accent = '#C8672B';
    var font = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';
    var btn = el('button', 'position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;border-radius:50%;border:0;background:' + accent + ';color:#fff;font:600 24px ' + font + ';cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)', '\u{1F4AC}');
    btn.setAttribute('aria-label', 'Chat with ' + cfg.businessName);
    var panel = el('div', 'position:fixed;right:20px;bottom:88px;z-index:2147483000;width:340px;max-width:calc(100vw - 24px);height:460px;max-height:calc(100vh - 110px);display:none;flex-direction:column;background:#fff;border:1px solid #ECE6DC;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);overflow:hidden;font-family:' + font);
    var head = el('div', 'padding:12px 14px;background:#1C1F22;color:#fff;font:600 14px ' + font, cfg.businessName);
    var sub = el('div', 'font-weight:400;font-size:11px;opacity:.7;margin-top:2px', 'Automated AI assistant');
    head.appendChild(sub);
    var list = el('div', 'flex:1;overflow-y:auto;padding:12px;background:#FAF7F2;display:flex;flex-direction:column;gap:8px');
    var form = el('div', 'display:flex;gap:8px;padding:10px;border-top:1px solid #ECE6DC;background:#fff');
    var input = el('input', 'flex:1;border:1px solid #D9D2C6;border-radius:8px;padding:9px 10px;font:14px ' + font + ';outline:none');
    input.setAttribute('placeholder', 'Type your message\u2026');
    input.setAttribute('maxlength', '600');
    var send = el('button', 'border:0;border-radius:8px;background:' + accent + ';color:#fff;padding:0 14px;font:600 14px ' + font + ';cursor:pointer', 'Send');
    form.appendChild(input);
    form.appendChild(send);
    panel.appendChild(head);
    panel.appendChild(list);
    panel.appendChild(form);
    document.body.appendChild(btn);
    document.body.appendChild(panel);

    function bubble(text, mine) {
      var b = el('div', 'max-width:85%;padding:8px 11px;border-radius:12px;font:14px/1.35 ' + font + ';white-space:pre-wrap;' +
        (mine ? 'align-self:flex-end;background:' + accent + ';color:#fff' : 'align-self:flex-start;background:#fff;border:1px solid #ECE6DC;color:#1C1F22'), text);
      list.appendChild(b);
      list.scrollTop = list.scrollHeight;
      return b;
    }
    bubble(cfg.welcome, false);

    function submit() {
      var text = input.value.trim();
      if (!text || busy) return;
      input.value = '';
      busy = true;
      bubble(text, true);
      turns.push({ speaker: 'caller', text: text });
      var wait = bubble('\u2026', false);
      fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, messages: turns.slice(-40) })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          wait.textContent = res.ok ? res.j.replyText : (res.j.error || 'Sorry, something went wrong.');
          if (res.ok) turns.push({ speaker: 'agent', text: res.j.replyText });
        })
        .catch(function () { wait.textContent = 'Sorry, we could not send that. Please call us instead.'; })
        .then(function () { busy = false; list.scrollTop = list.scrollHeight; });
    }
    send.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    btn.addEventListener('click', function () {
      var open = panel.style.display === 'flex';
      panel.style.display = open ? 'none' : 'flex';
      if (!open) input.focus();
    });
  }
})();
