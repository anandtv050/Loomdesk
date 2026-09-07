/* ===================== Loomdesk — MVP UI logic ===================== */
/* Pure front-end. No backend. All data comes from data.json and is held
   in memory only — changes (sent messages, assignment, resolve, notes)
   do not persist across a page reload except who is logged in. */

(function () {
  "use strict";

  let DATA = null;
  let currentAgent = null;
  let selectedConvId = null;
  let convFilter = "all";
  let convSearch = "";
  let invSearch = "";
  let invCategory = "All";
  let ordSearch = "";
  let ordStatus = "All";
  let composerBotDraft = null; // { doubt: bool } while the composer holds an untouched bot-generated draft
  const notesStore = {}; // convId -> notes text (in-memory only)

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const AVATAR_COLORS = ["#5b4fe9", "#2aa876", "#e0894f", "#3e6be0", "#c0447c", "#3fa1a9", "#d19b2b", "#7c5cd6"];

  function initialsOf(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  }
  function colorFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function formatINR(n) {
    return "₹" + Number(n).toLocaleString("en-IN");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function agentById(id) {
    return DATA.agents.find(a => a.id === id) || null;
  }
  function ordersForPhone(phone) {
    return DATA.orders.filter(o => o.phone === phone).sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  function convForPhone(phone) {
    return DATA.conversations.find(c => c.phone === phone) || null;
  }

  /* ---------------------------------------------------------------- */
  /* Boot                                                              */
  /* ---------------------------------------------------------------- */

  function boot() {
    fetch("data.json")
      .then(r => {
        if (!r.ok) throw new Error("bad response");
        return r.json();
      })
      .then(data => {
        DATA = data;
        setupLogin();
        tryRestoreSession();
      })
      .catch(() => {
        const card = $(".login-card");
        if (card) {
          card.innerHTML =
            '<div class="login-heading">Can\'t load data.json</div>' +
            '<p class="login-tagline">This app fetches <code>data.json</code>, which most browsers block when a file is opened directly ' +
            '(<code>file://</code>). Serve this folder with a local server and reload — for example:</p>' +
            '<p class="login-tagline"><code>npx serve .</code> &nbsp;or&nbsp; VS Code "Live Server" extension.</p>';
        }
      });
  }

  function tryRestoreSession() {
    try {
      const savedId = sessionStorage.getItem("loomdesk_agent");
      if (savedId) {
        const agent = agentById(savedId);
        if (agent) {
          loginAs(agent);
          return;
        }
      }
    } catch (e) { /* storage unavailable — ignore, show login */ }
  }

  /* ---------------------------------------------------------------- */
  /* Login                                                             */
  /* ---------------------------------------------------------------- */

  function setupLogin() {
    $("#wa-number-badge") && ($("#wa-number-badge").textContent = DATA.business.whatsappNumber);

    const demoWrap = $("#demo-accounts");
    demoWrap.innerHTML = DATA.agents.map(a => `
      <div class="demo-account" data-username="${a.username}" data-password="${a.password}">
        <span class="who"><span class="dot"></span>${escapeHtml(a.name)}</span>
        <span class="cred">${a.username} / ${a.password}</span>
      </div>`).join("");

    demoWrap.addEventListener("click", e => {
      const row = e.target.closest(".demo-account");
      if (!row) return;
      $("#login-username").value = row.dataset.username;
      $("#login-password").value = row.dataset.password;
      $("#login-error").classList.remove("show");
    });

    $("#login-form").addEventListener("submit", e => {
      e.preventDefault();
      const u = $("#login-username").value.trim().toLowerCase();
      const p = $("#login-password").value;
      const agent = DATA.agents.find(a => a.username === u && a.password === p);
      if (!agent) {
        $("#login-error").classList.add("show");
        return;
      }
      try { sessionStorage.setItem("loomdesk_agent", agent.id); } catch (e) {}
      loginAs(agent);
    });
  }

  function loginAs(agent) {
    currentAgent = agent;
    $("#login-screen").hidden = true;
    $("#app-shell").hidden = false;
    initApp();
  }

  function logout() {
    currentAgent = null;
    selectedConvId = null;
    try { sessionStorage.removeItem("loomdesk_agent"); } catch (e) {}
    $("#app-shell").hidden = true;
    $("#login-screen").hidden = false;
    $("#login-form").reset();
    $("#login-error").classList.remove("show");
  }

  /* ---------------------------------------------------------------- */
  /* App shell                                                         */
  /* ---------------------------------------------------------------- */

  function initApp() {
    // topbar agent info
    $("#agent-avatar").textContent = currentAgent.initials;
    $("#agent-avatar").style.background = currentAgent.color;
    $("#agent-name").textContent = currentAgent.name;
    $("#agent-dd-name").textContent = currentAgent.name;
    $("#agent-dd-role").textContent = currentAgent.role;
    $("#wa-number-badge").textContent = DATA.business.whatsappNumber;

    $("#agent-chip").onclick = () => $("#agent-dropdown").classList.toggle("show");
    document.addEventListener("click", e => {
      if (!e.target.closest(".agent-menu")) $("#agent-dropdown").classList.remove("show");
    });
    $("#logout-btn").onclick = logout;

    $$(".topnav-item").forEach(btn => {
      btn.onclick = () => switchView(btn.dataset.view);
    });

    $("#modal-close").onclick = closeModal;
    $("#modal-overlay").onclick = e => { if (e.target.id === "modal-overlay") closeModal(); };

    renderConvList();
    renderInventoryView();
    renderOrdersView();
    renderDashboardView();

    $("#conv-search").oninput = e => { convSearch = e.target.value.toLowerCase(); renderConvList(); };
    $$(".filter-tab").forEach(btn => {
      btn.onclick = () => {
        $$(".filter-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        convFilter = btn.dataset.filter;
        renderConvList();
      };
    });

    switchView("inbox");
  }

  function switchView(name) {
    $$(".topnav-item").forEach(b => b.classList.toggle("active", b.dataset.view === name));
    $$(".view").forEach(v => v.classList.remove("active"));
    $("#view-" + name).classList.add("active");
    if (name === "dashboard") renderDashboardView();
    if (name === "inventory") renderInventoryView();
    if (name === "orders") renderOrdersView();
  }

  /* ---------------------------------------------------------------- */
  /* Inbox — conversation list                                        */
  /* ---------------------------------------------------------------- */

  function filteredConvs() {
    return DATA.conversations.filter(c => {
      if (convFilter === "unassigned" && c.assignedTo) return false;
      if (convFilter === "mine" && c.assignedTo !== currentAgent.id) return false;
      if (convFilter === "resolved" && c.status !== "resolved") return false;
      if (convSearch) {
        const hay = (c.customer + " " + c.phone).toLowerCase();
        if (!hay.includes(convSearch)) return false;
      }
      return true;
    });
  }

  function tagClass(tag) {
    const t = tag.toLowerCase();
    if (t.includes("refund")) return "refund";
    if (t.includes("stock")) return "stock";
    if (t.includes("lead")) return "lead";
    return "";
  }

  function renderConvList() {
    const list = $("#conv-list");
    const convs = filteredConvs();
    if (!convs.length) {
      list.innerHTML = `<div style="padding:30px 12px; text-align:center; color:var(--text-faint); font-size:12.5px;">No conversations match.</div>`;
      return;
    }
    list.innerHTML = convs.map(c => {
      const last = c.messages[c.messages.length - 1];
      const assignedAgent = c.assignedTo ? agentById(c.assignedTo) : null;
      return `
      <div class="conv-item ${c.unread ? "unread" : ""} ${c.id === selectedConvId ? "selected" : ""}" data-id="${c.id}">
        <div class="avatar" style="background:${colorFor(c.id)}">${c.initials}</div>
        <div class="conv-body">
          <div class="conv-top">
            <span class="conv-name">${escapeHtml(c.customer)}</span>
            <span class="conv-time">${escapeHtml(c.lastTime)}</span>
          </div>
          <div class="conv-preview">${escapeHtml(last ? last.text : "")}</div>
          <div class="conv-meta">
            <span class="status-dot ${c.status}" title="${c.status}"></span>
            ${c.tags.map(t => `<span class="tag-chip ${tagClass(t)}">${escapeHtml(t)}</span>`).join("")}
            ${assignedAgent ? `<span class="tag-chip" style="background:var(--neutral-bg); color:var(--text-soft);">${escapeHtml(assignedAgent.name.split(" ")[0])}</span>` : ""}
            ${c.unread ? `<span class="unread-badge" style="margin-left:auto;">${c.unread}</span>` : ""}
          </div>
        </div>
      </div>`;
    }).join("");

    $$(".conv-item", list).forEach(el => {
      el.onclick = () => selectConversation(el.dataset.id);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Inbox — chat pane                                                 */
  /* ---------------------------------------------------------------- */

  function dayLabelOf(time) {
    if (time.includes("Yesterday")) return "Yesterday";
    if (time.includes("ago")) return time;
    return "Today";
  }
  function bubbleTime(time) {
    if (time.includes(",")) return time.split(",")[1].trim();
    if (time.includes("ago")) return "";
    return time;
  }

  function selectConversation(id) {
    selectedConvId = id;
    const conv = DATA.conversations.find(c => c.id === id);
    if (conv) conv.unread = 0;
    renderConvList();
    renderChatPane();
    renderContactPane();
  }

  function currentConv() {
    return DATA.conversations.find(c => c.id === selectedConvId) || null;
  }

  function renderChatPane() {
    const pane = $("#chat-pane");
    const conv = currentConv();
    if (!conv) {
      pane.innerHTML = `<div class="chat-empty"><svg><use href="#i-inbox"/></svg><span>Select a conversation to start replying</span></div>`;
      return;
    }

    pane.innerHTML = `
      <div class="chat-head">
        <div class="avatar" style="background:${colorFor(conv.id)}">${conv.initials}</div>
        <div class="chat-head-info">
          <div class="chat-head-name">${escapeHtml(conv.customer)}</div>
          <div class="chat-head-sub"><svg style="width:12px;height:12px;"><use href="#i-phone"/></svg>${escapeHtml(conv.phone)}</div>
        </div>
        <div class="chat-head-actions">
          <select class="select-mini" id="assign-select">
            <option value="">Unassigned</option>
            ${DATA.agents.map(a => `<option value="${a.id}" ${conv.assignedTo === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}
          </select>
          <button class="btn-resolve ${conv.status === "resolved" ? "is-resolved" : ""}" id="resolve-btn">
            ${conv.status === "resolved" ? "Resolved" : "Mark Resolved"}
          </button>
        </div>
      </div>

      <div class="msg-thread scroll" id="msg-thread"></div>

      <div class="quick-replies" id="quick-replies"></div>

      <div class="bot-draft-hint" id="bot-draft-hint" hidden>
        <svg><use href="#i-bot"/></svg>
        <span id="bot-draft-hint-text"></span>
        <button class="dismiss" id="bot-draft-dismiss" title="Not a bot reply — clear this label"><svg><use href="#i-x"/></svg></button>
      </div>

      <div class="composer">
        <textarea id="composer-input" rows="1" placeholder="Type a reply to ${escapeHtml(conv.customer.split(" ")[0])}…"></textarea>
        <button class="btn-send" id="send-btn" title="Send"><svg><use href="#i-send"/></svg></button>
      </div>
    `;

    composerBotDraft = null;
    renderThread(conv);

    $("#quick-replies").innerHTML = DATA.quickReplies.map((q, i) => `
      <div class="qr-chip" data-idx="${i}"><svg><use href="#i-tag"/></svg>${escapeHtml(q.label)}</div>
    `).join("");
    $$(".qr-chip", pane).forEach(chip => {
      chip.onclick = () => handleQuickReply(DATA.quickReplies[Number(chip.dataset.idx)], conv);
    });

    $("#assign-select").onchange = e => {
      conv.assignedTo = e.target.value || null;
      renderConvList();
      renderContactPane();
      showToast("Conversation " + (conv.assignedTo ? "assigned to " + agentById(conv.assignedTo).name : "unassigned"));
    };
    $("#resolve-btn").onclick = () => {
      conv.status = conv.status === "resolved" ? "open" : "resolved";
      renderConvList();
      renderChatPane();
      showToast(conv.status === "resolved" ? "Marked as resolved" : "Reopened conversation");
    };

    const input = $("#composer-input");
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 110) + "px";
      // A real keystroke means the agent is now editing — the draft is no
      // longer purely bot output, so drop the bot-draft label.
      clearComposerBotDraft();
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(conv); }
    });
    $("#send-btn").onclick = () => sendMessage(conv);
    $("#bot-draft-dismiss").onclick = () => clearComposerBotDraft();
  }

  /* Marks the current composer contents as a bot-generated draft (or clears
     that state). `doubt` flags a low-confidence draft the bot itself wants
     a human to double-check before it goes out. */
  function setComposerBotDraft(doubt) {
    composerBotDraft = { doubt: !!doubt };
    const hint = $("#bot-draft-hint");
    if (!hint) return;
    hint.hidden = false;
    hint.classList.toggle("doubt", !!doubt);
    $("#bot-draft-hint-text").textContent = doubt
      ? "Bot drafted this, but isn't fully confident — double-check before sending"
      : "Bot drafted this from live inventory/order data";
  }
  function clearComposerBotDraft() {
    composerBotDraft = null;
    const hint = $("#bot-draft-hint");
    if (hint) hint.hidden = true;
  }

  function renderThread(conv) {
    const thread = $("#msg-thread");
    let lastLabel = null;
    let html = "";
    conv.messages.forEach(m => {
      const label = dayLabelOf(m.time);
      if (label !== lastLabel) {
        html += `<div class="day-divider"><span>${escapeHtml(label)}</span></div>`;
        lastLabel = label;
      }
      const isOut = m.from === "agent";
      const isBot = isOut && m.origin === "bot";
      let headerHtml = "";
      if (isBot) {
        headerHtml = `<span class="bot-tag"><svg><use href="#i-bot"/></svg>Automated reply${m.agent ? ` <span class="via">— ${escapeHtml(m.agent)}</span>` : ""}</span>`;
      } else if (isOut && m.agent) {
        headerHtml = `<span class="agent-tag">${escapeHtml(m.agent)}</span>`;
      }
      html += `
        <div class="msg-row ${isOut ? "out" : "in"}">
          <div class="bubble">
            ${headerHtml}
            ${escapeHtml(m.text)}
            <div class="bubble-meta">
              <span class="bubble-time">${escapeHtml(bubbleTime(m.time))}</span>
              ${isBot && m.doubt ? `<svg class="doubt-icon" title="Bot isn't fully confident — please verify before relying on this"><use href="#i-help-circle"/></svg>` : ""}
              ${isOut ? `<svg class="tick ${m.tick === "read" ? "read" : ""}"><use href="#${m.tick === "sent" ? "i-check" : "i-check2"}"/></svg>` : ""}
            </div>
          </div>
        </div>`;
    });
    thread.innerHTML = html;
    thread.scrollTop = thread.scrollHeight;
  }

  function sendMessage(conv) {
    const input = $("#composer-input");
    const text = input.value.trim();
    if (!text) return;
    const msg = { from: "agent", agent: currentAgent.name, text, time: "Just now", tick: "sent" };
    if (composerBotDraft) {
      msg.origin = "bot";
      msg.doubt = composerBotDraft.doubt;
    }
    conv.messages.push(msg);
    conv.lastTime = "Just now";
    input.value = "";
    input.style.height = "auto";
    clearComposerBotDraft();
    renderThread(conv);
    renderConvList();

    setTimeout(() => { msg.tick = "delivered"; if (currentConv() === conv) renderThread(conv); }, 700);
    setTimeout(() => { msg.tick = "read"; if (currentConv() === conv) renderThread(conv); }, 1700);
  }

  function handleQuickReply(q, conv) {
    const input = $("#composer-input");
    if (q.text) {
      input.value = (input.value ? input.value + " " : "") + q.text;
      setComposerBotDraft(false);
      input.focus();
      return;
    }
    if (q.type === "stock") { openStockPicker(conv); return; }
    if (q.type === "order") {
      const orders = ordersForPhone(conv.phone);
      if (!orders.length) { showToast("No orders found for this customer"); return; }
      const o = orders[0];
      input.value = `Your order ${o.id} (${formatINR(o.amount)}) is currently ${o.status}.` + (o.tracking !== "-" ? ` Tracking ID: ${o.tracking}.` : "");
      // A "Pending" order is an unsettled fact (payment/confirmation still in flux) —
      // the bot flags that as worth double-checking before it goes out.
      setComposerBotDraft(o.status === "Pending");
      input.focus();
      return;
    }
    if (q.type === "tracking") {
      const orders = ordersForPhone(conv.phone).filter(o => o.tracking && o.tracking !== "-");
      if (!orders.length) { showToast("No tracking ID available for this customer"); return; }
      const o = orders[0];
      input.value = `Your order ${o.id} tracking ID is ${o.tracking}. You can track it with your courier partner using this ID.`;
      setComposerBotDraft(false);
      input.focus();
      return;
    }
  }

  function openStockPicker(conv) {
    const body = `
      <div class="search-box" style="margin-bottom:12px;">
        <svg><use href="#i-search"/></svg>
        <input id="stock-picker-search" type="text" placeholder="Search product or SKU" autofocus>
      </div>
      <div id="stock-picker-results" class="scroll" style="max-height:320px;"></div>
    `;
    openModal("Insert stock status", body);
    const renderResults = term => {
      const t = (term || "").toLowerCase();
      const results = DATA.products.filter(p => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)).slice(0, 8);
      $("#stock-picker-results").innerHTML = results.map(p => {
        const total = p.variants.reduce((s, v) => s + v.stock, 0);
        return `
        <div class="order-mini" data-id="${p.id}" style="cursor:pointer;">
          <div class="order-mini-top"><span>${escapeHtml(p.name)}</span><span>${formatINR(p.price)}</span></div>
          <div class="order-mini-sub"><span>${escapeHtml(p.sku)}</span><span>${total} in stock</span></div>
        </div>`;
      }).join("") || `<div style="padding:20px; text-align:center; color:var(--text-faint); font-size:12.5px;">No products found.</div>`;

      $$("#stock-picker-results .order-mini").forEach(el => {
        el.onclick = () => {
          const product = DATA.products.find(p => p.id === el.dataset.id);
          insertStockMessage(product);
          closeModal();
        };
      });
    };
    renderResults("");
    $("#stock-picker-search").oninput = e => renderResults(e.target.value);
  }

  function insertStockMessage(product) {
    const parts = product.variants.map(v => `${v.size}${v.color ? " (" + v.color + ")" : ""}: ${v.stock > 0 ? v.stock + " available" : "Out of stock"}`);
    const text = `${product.name} — ${parts.join(", ")}. Price: ${formatINR(product.price)}.`;
    const input = $("#composer-input");
    if (input) {
      input.value = (input.value ? input.value + " " : "") + text;
      const total = product.variants.reduce((s, v) => s + v.stock, 0);
      // Low or out-of-stock items move fast — the bot flags those as worth a
      // quick warehouse check before promising them to the customer.
      setComposerBotDraft(stockStatus(total) !== "In Stock");
      input.focus();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Inbox — contact pane                                              */
  /* ---------------------------------------------------------------- */

  function renderContactPane() {
    const pane = $("#contact-pane");
    const conv = currentConv();
    if (!conv) { pane.innerHTML = ""; return; }

    const orders = ordersForPhone(conv.phone);
    const waDigits = conv.phone.replace(/\D/g, "");

    pane.innerHTML = `
      <div class="contact-summary">
        <div class="avatar" style="background:${colorFor(conv.id)}">${conv.initials}</div>
        <div class="cname">${escapeHtml(conv.customer)}</div>
        <div class="cphone">${escapeHtml(conv.phone)}</div>
        <a class="wa-link" href="https://wa.me/${waDigits}" target="_blank" rel="noopener">
          <svg><use href="#i-external"/></svg>Open in WhatsApp
        </a>
      </div>

      <div class="contact-section">
        <div class="contact-section-title">Tags</div>
        <div class="contact-tags">${conv.tags.map(t => `<span class="tag-chip ${tagClass(t)}">${escapeHtml(t)}</span>`).join("") || `<span class="text-faint" style="font-size:12px;">No tags</span>`}</div>
      </div>

      <div class="contact-section stock-lookup">
        <div class="contact-section-title">Quick Stock Lookup</div>
        <input id="contact-stock-search" type="text" placeholder="Search a product…">
        <div class="stock-result" id="contact-stock-results"></div>
      </div>

      <div class="contact-section">
        <div class="contact-section-title">Order History<span class="text-faint" style="font-weight:600;">${orders.length}</span></div>
        ${orders.length ? orders.map(o => `
          <div class="order-mini" data-order="${o.id}" style="cursor:pointer;">
            <div class="order-mini-top"><span>${o.id}</span><span>${formatINR(o.amount)}</span></div>
            <div class="order-mini-sub"><span>${o.date}</span>${statusBadge(o.status)}</div>
          </div>`).join("") : `<div class="text-faint" style="font-size:12px;">No past orders</div>`}
      </div>

      <div class="contact-section contact-notes">
        <div class="contact-section-title">Internal Notes</div>
        <textarea id="contact-notes" placeholder="Notes about this customer — not visible to them">${escapeHtml(notesStore[conv.id] || "")}</textarea>
      </div>
    `;

    $$("#contact-pane [data-order]").forEach(el => {
      el.onclick = () => openOrderModal(el.dataset.order);
    });
    $("#contact-notes").oninput = e => { notesStore[conv.id] = e.target.value; };
    $("#contact-stock-search").oninput = e => {
      const t = e.target.value.toLowerCase();
      const box = $("#contact-stock-results");
      if (!t) { box.innerHTML = ""; return; }
      const results = DATA.products.filter(p => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)).slice(0, 5);
      box.innerHTML = results.map(p => {
        const total = p.variants.reduce((s, v) => s + v.stock, 0);
        return `<div class="stock-result-item"><span>${escapeHtml(p.name)}</span><span class="mono">${total} left</span></div>`;
      }).join("") || `<div style="padding:6px 0;">No matches</div>`;
    };
  }

  /* ---------------------------------------------------------------- */
  /* Shared: status badge                                              */
  /* ---------------------------------------------------------------- */

  function statusBadge(status) {
    const map = {
      Paid: "success", Shipped: "info", Delivered: "success",
      Pending: "warning", Refunded: "danger",
      "In Stock": "success", "Low Stock": "warning", "Out of Stock": "danger",
    };
    return `<span class="badge badge-${map[status] || "neutral"}">${escapeHtml(status)}</span>`;
  }

  /* ---------------------------------------------------------------- */
  /* Inventory view                                                    */
  /* ---------------------------------------------------------------- */

  function stockStatus(total) {
    if (total <= 0) return "Out of Stock";
    if (total <= 10) return "Low Stock";
    return "In Stock";
  }

  function renderInventoryView() {
    const totalProducts = DATA.products.length;
    let low = 0, out = 0, value = 0;
    DATA.products.forEach(p => {
      const total = p.variants.reduce((s, v) => s + v.stock, 0);
      value += p.variants.reduce((s, v) => s + v.stock * p.price, 0);
      const st = stockStatus(total);
      if (st === "Low Stock") low++;
      if (st === "Out of Stock") out++;
    });

    $("#inventory-stats").innerHTML = `
      ${statCard("i-box", "Total Products", totalProducts, "", "flat")}
      ${statCard("i-alert", "Low Stock", low, low ? "Needs restock soon" : "All healthy", low ? "down" : "up")}
      ${statCard("i-alert", "Out of Stock", out, out ? "Unavailable to sell" : "None", out ? "down" : "up")}
      ${statCard("i-trend-up", "Stock Value", formatINR(value), "At retail price", "flat")}
    `;

    const cats = ["All", ...Array.from(new Set(DATA.products.map(p => p.category)))];
    $("#inventory-cat-filters").innerHTML = cats.map(c => `<button class="chip-filter ${c === invCategory ? "active" : ""}" data-cat="${c}">${c}</button>`).join("");
    $$("#inventory-cat-filters .chip-filter").forEach(b => {
      b.onclick = () => { invCategory = b.dataset.cat; renderInventoryView(); };
    });

    $("#inventory-search").value = invSearch;
    $("#inventory-search").oninput = e => { invSearch = e.target.value.toLowerCase(); renderInventoryTable(); };

    renderInventoryTable();
  }

  function renderInventoryTable() {
    const rows = DATA.products.filter(p => {
      if (invCategory !== "All" && p.category !== invCategory) return false;
      if (invSearch && !(p.name.toLowerCase().includes(invSearch) || p.sku.toLowerCase().includes(invSearch))) return false;
      return true;
    });

    $("#inventory-tbody").innerHTML = rows.map(p => {
      const total = p.variants.reduce((s, v) => s + v.stock, 0);
      const status = stockStatus(total);
      const variantsHtml = p.variants.map(v => {
        const cls = v.stock <= 0 ? "out" : v.stock <= 5 ? "low" : "";
        return `<span class="variant-chip ${cls}">${escapeHtml(v.size)}${v.color ? "/" + escapeHtml(v.color) : ""}: ${v.stock}</span>`;
      }).join("");
      return `
      <tr>
        <td>
          <div class="prod-cell">
            <div class="prod-swatch"><svg><use href="#i-shirt"/></svg></div>
            <div>
              <div class="prod-name">${escapeHtml(p.name)}</div>
              <div class="prod-sku">${escapeHtml(p.sku)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(p.category)}</td>
        <td><div class="variant-list">${variantsHtml}</div></td>
        <td class="mono">${total}</td>
        <td class="mono">${formatINR(p.price)}</td>
        <td>${statusBadge(status)}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-faint);">No products match your filters.</td></tr>`;
  }

  /* ---------------------------------------------------------------- */
  /* Orders view                                                       */
  /* ---------------------------------------------------------------- */

  function renderOrdersView() {
    const revenue = DATA.orders.filter(o => o.status !== "Refunded").reduce((s, o) => s + o.amount, 0);
    const pending = DATA.orders.filter(o => o.status === "Pending").length;
    const refunds = DATA.orders.filter(o => o.status === "Refunded");
    const refundAmt = refunds.reduce((s, o) => s + o.amount, 0);
    const latestDate = DATA.orders.reduce((max, o) => (o.date > max ? o.date : max), "0000-00-00");
    const today = DATA.orders.filter(o => o.date === latestDate).length;

    $("#orders-stats").innerHTML = `
      ${statCard("i-bag", "Total Revenue", formatINR(revenue), "Excludes refunds", "up")}
      ${statCard("i-truck", "Pending Orders", pending, pending ? "Awaiting payment/action" : "All clear", pending ? "down" : "up")}
      ${statCard("i-refresh", "Refunds", refunds.length, formatINR(refundAmt) + " refunded", "down")}
      ${statCard("i-chart", "Orders — " + latestDate, today, "Most recent order day", "flat")}
    `;

    const statuses = ["All", "Paid", "Shipped", "Delivered", "Pending", "Refunded"];
    $("#orders-status-filters").innerHTML = statuses.map(s => `<button class="chip-filter ${s === ordStatus ? "active" : ""}" data-status="${s}">${s}</button>`).join("");
    $$("#orders-status-filters .chip-filter").forEach(b => {
      b.onclick = () => { ordStatus = b.dataset.status; renderOrdersView(); };
    });

    $("#orders-search").value = ordSearch;
    $("#orders-search").oninput = e => { ordSearch = e.target.value.toLowerCase(); renderOrdersTable(); };

    renderOrdersTable();
  }

  function renderOrdersTable() {
    const rows = DATA.orders.filter(o => {
      if (ordStatus !== "All" && o.status !== ordStatus) return false;
      if (ordSearch) {
        const hay = (o.id + " " + o.customer + " " + o.tracking).toLowerCase();
        if (!hay.includes(ordSearch)) return false;
      }
      return true;
    }).sort((a, b) => (a.date < b.date ? 1 : -1));

    $("#orders-tbody").innerHTML = rows.map(o => {
      const itemNames = o.items.map(i => `${i.qty}× ${i.product}`).join(", ");
      return `
      <tr>
        <td class="mono" style="font-weight:700;">${o.id}</td>
        <td>
          <div style="font-weight:600;">${escapeHtml(o.customer)}</div>
          <div class="text-faint" style="font-size:11.5px;">${escapeHtml(o.phone)}</div>
        </td>
        <td class="mono">${o.date}</td>
        <td title="${escapeHtml(itemNames)}">${o.items.length} item${o.items.length > 1 ? "s" : ""}</td>
        <td class="mono">${formatINR(o.amount)}</td>
        <td>${statusBadge(o.status)}</td>
        <td class="mono text-faint">${o.tracking}</td>
        <td><button class="btn-ghost-sm" data-order="${o.id}">View</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-faint);">No orders match your filters.</td></tr>`;

    $$("#orders-tbody [data-order]").forEach(b => { b.onclick = () => openOrderModal(b.dataset.order); });
  }

  function openOrderModal(orderId) {
    const o = DATA.orders.find(x => x.id === orderId);
    if (!o) return;
    const conv = convForPhone(o.phone);
    const body = `
      <div class="modal-row">
        <span class="k">Customer</span>
        <span class="v" style="display:flex; align-items:center; gap:8px;">
          ${escapeHtml(o.customer)}
          ${conv ? `<button class="icon-btn-sm" id="modal-open-inbox" title="Open conversation in Inbox"><svg><use href="#i-inbox"/></svg></button>` : ""}
        </span>
      </div>
      <div class="modal-row"><span class="k">Phone</span><span class="v">${escapeHtml(o.phone)}</span></div>
      <div class="modal-row"><span class="k">Date</span><span class="v">${o.date}</span></div>
      <div class="modal-row"><span class="k">Status</span><span class="v">${statusBadge(o.status)}</span></div>
      <div class="modal-row"><span class="k">Tracking ID</span><span class="v mono">${o.tracking}</span></div>
      <div style="margin:14px 0 6px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--text-faint);">Items</div>
      ${o.items.map(i => `<div class="modal-row"><span class="k">${i.qty}× ${escapeHtml(i.product)}</span><span class="v">${formatINR(i.price * i.qty)}</span></div>`).join("")}
      <div class="modal-row" style="margin-top:6px; border-top:1px solid var(--border); padding-top:10px;"><span class="k" style="font-weight:700; color:var(--text);">Total</span><span class="v">${formatINR(o.amount)}</span></div>
    `;
    openModal("Order " + o.id, body);
    if (conv) {
      $("#modal-open-inbox").onclick = () => {
        closeModal();
        switchView("inbox");
        selectConversation(conv.id);
      };
    }
  }

  /* ---------------------------------------------------------------- */
  /* Dashboard view                                                    */
  /* ---------------------------------------------------------------- */

  function renderDashboardView() {
    const open = DATA.conversations.filter(c => c.status === "open").length;
    const unread = DATA.conversations.reduce((s, c) => s + (c.unread || 0), 0);
    const latestDate = DATA.orders.reduce((max, o) => (o.date > max ? o.date : max), "0000-00-00");
    const todaySales = DATA.orders.filter(o => o.date === latestDate).reduce((s, o) => s + o.amount, 0);
    const lowStock = DATA.products.filter(p => stockStatus(p.variants.reduce((s, v) => s + v.stock, 0)) !== "In Stock");

    $("#dashboard-stats").innerHTML = `
      ${statCard("i-inbox", "Open Conversations", open, "Across all agents", "flat")}
      ${statCard("i-alert", "Unread Messages", unread, unread ? "Needs a reply" : "All caught up", unread ? "down" : "up")}
      ${statCard("i-bag", "Sales — " + latestDate, formatINR(todaySales), "Most recent order day", "up")}
      ${statCard("i-box", "Stock Alerts", lowStock.length, "Low or out of stock", lowStock.length ? "down" : "up")}
    `;

    const recent = [...DATA.conversations].sort((a, b) => (b.unread || 0) - (a.unread || 0)).slice(0, 5);
    $("#dashboard-recent-convos").innerHTML = recent.map(c => {
      const last = c.messages[c.messages.length - 1];
      return `
      <div class="order-mini" data-conv="${c.id}" style="cursor:pointer;">
        <div class="order-mini-top"><span>${escapeHtml(c.customer)}</span><span>${escapeHtml(c.lastTime)}</span></div>
        <div class="order-mini-sub"><span style="max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(last ? last.text : "")}</span>${c.unread ? `<span class="badge badge-success">${c.unread} new</span>` : ""}</div>
      </div>`;
    }).join("") || `<div class="text-faint" style="font-size:12.5px;">No conversations yet.</div>`;
    $$("#dashboard-recent-convos [data-conv]").forEach(el => {
      el.onclick = () => { switchView("inbox"); selectConversation(el.dataset.conv); };
    });

    $("#dashboard-low-stock").innerHTML = lowStock.map(p => {
      const total = p.variants.reduce((s, v) => s + v.stock, 0);
      return `
      <div class="order-mini">
        <div class="order-mini-top"><span>${escapeHtml(p.name)}</span>${statusBadge(stockStatus(total))}</div>
        <div class="order-mini-sub"><span>${escapeHtml(p.sku)}</span><span>${total} left</span></div>
      </div>`;
    }).join("") || `<div class="text-faint" style="font-size:12.5px;">Everything is well stocked.</div>`;
  }

  /* ---------------------------------------------------------------- */
  /* Small shared UI helpers                                           */
  /* ---------------------------------------------------------------- */

  function statCard(icon, label, value, delta, deltaClass) {
    return `
      <div class="stat-card">
        <div class="label"><svg><use href="#${icon}"/></svg>${escapeHtml(label)}</div>
        <div class="value">${value}</div>
        <div class="delta ${deltaClass}">${escapeHtml(delta)}</div>
      </div>`;
  }

  function openModal(title, bodyHtml) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = bodyHtml;
    $("#modal-overlay").classList.add("show");
  }
  function closeModal() {
    $("#modal-overlay").classList.remove("show");
  }

  let toastTimer = null;
  function showToast(text) {
    $("#toast-text").textContent = text;
    $("#toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2200);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
