// Arabic OCR — Cloudflare Worker
// Serves: Android, iOS, Mac, Windows, Web
// Routes: Groq LLM, Google Cloud Vision OCR, Paddle webhooks,
//         reCAPTCHA, iOS/Mac/Windows purchase analytics + sale notifications,
//         Android purchase verification (Google Play), Brevo event tracking

export default {
  async fetch(req, env) {
    const headers = corsHeaders();
    if (req.method === "OPTIONS") return new Response(null, { headers });

    const url = new URL(req.url);

    // ── Health check ────────────────────────────────────────────
    if (req.method === "GET") {
      return new Response(JSON.stringify({
        status: "ok",
        message: "Worker operational",
        path: url.pathname,
      }), { status: 200, headers });
    }

   // ── Paddle webhook (Windows / Web purchases) ────────────────
    if (url.pathname === "/paddle/webhook" && req.method === "POST") {
      return handlePaddleWebhook(req, env, headers);
    }

    // ── Route Signups to Brevo ──────────────────────────────────
    if (url.pathname === "/sync-user-brevo" && req.method === "POST") {
      const token = req.headers.get("X-App-Token");
      if (token !== "ocr_app_2026_kanzati" && token !== env.WINDOWS_APP_TOKEN)
        return new Response("Unauthorized", { status: 403, headers });

      try {
        const body = await req.json();
        const { email, firstName, lastName, platform } = body;

        if (!email || !email.includes("@")) {
          return new Response(JSON.stringify({ error: "Valid email is required" }), { status: 400, headers });
        }

        if (!env.BREVO_API_KEY) {
          return new Response(JSON.stringify({ error: "BREVO_API_KEY not configured" }), { status: 500, headers });
        }

        const brevoRes = await fetch("https://api.brevo.com/v3/contacts", {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "api-key": env.BREVO_API_KEY,
          },
        body: JSON.stringify({
  email: email.trim().toLowerCase(),
  attributes: {
    FIRSTNAME: firstName || "",
    LASTNAME: lastName || "",
    SIGNUP_PLATFORM: platform || "unknown",
    SIGNUP_DATE: new Date().toISOString().split("T")[0],
  },
  listIds: getListIdsForPlatform(platform),
  updateEnabled: true,
}),
        });

        const brevoData = await brevoRes.json();
        if (!brevoRes.ok) {
          return new Response(JSON.stringify({ error: "Brevo API error", detail: brevoData }), { status: brevoRes.status, headers });
        }

        return new Response(JSON.stringify({ success: true, message: "User synced to Brevo" }), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: `sync-user-brevo failed: ${e.message}` }), { status: 500, headers });
      }
    }

    // ── Brevo debug: test attribute update and return full response ──
    if (url.pathname === "/brevo/debug-update" && req.method === "POST") {
      const token = req.headers.get("X-App-Token");
      if (token !== "ocr_app_2026_kanzati" && token !== env.WINDOWS_APP_TOKEN)
        return new Response("Unauthorized", { status: 403, headers });
      try {
        const body = await req.json();
        const { email, attributes } = body;
        if (!env.BREVO_API_KEY) return new Response(JSON.stringify({ error: "No BREVO_API_KEY" }), { status: 500, headers });
        const brevoRes = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
          method: "PUT",
          headers: { "Accept": "application/json", "Content-Type": "application/json", "api-key": env.BREVO_API_KEY },
          body: JSON.stringify({ attributes }),
        });
        const status = brevoRes.status;
        let resBody;
        try { resBody = await brevoRes.json(); } catch { resBody = await brevoRes.text(); }
        // Also GET the contact to see current state
        const getRes = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
          headers: { "Accept": "application/json", "api-key": env.BREVO_API_KEY },
        });
        const contact = await getRes.json();
        return new Response(JSON.stringify({ putStatus: status, putResponse: resBody, contact: contact.attributes }, null, 2), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // ── Brevo event debug: test Track Event API directly ────────
    if (url.pathname === "/brevo/debug-event" && req.method === "POST") {
      const token = req.headers.get("X-App-Token");
      if (token !== "ocr_app_2026_kanzati" && token !== env.WINDOWS_APP_TOKEN)
        return new Response("Unauthorized", { status: 403, headers });
      try {
        const body = await req.json();
        const { email, event } = body;
        const apiKey = env.BREVO_API_KEY;
        if (!apiKey) return new Response(JSON.stringify({ error: "BREVO_API_KEY not set" }), { status: 500, headers });
        const payload = {
          event_name: event || "test_event",
          identifiers: { email_id: (email || "").trim().toLowerCase() },
          properties: { test: true },
        };
        const res = await fetch("https://api.brevo.com/v3/events", {
          method: "POST",
          headers: { "Accept": "application/json", "Content-Type": "application/json", "api-key": apiKey },
          body: JSON.stringify(payload),
        });
        let resBody;
        try { resBody = await res.json(); } catch { resBody = await res.text(); }
        return new Response(JSON.stringify({
          status: res.status,
          response: resBody,
          payload,
        }, null, 2), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // ── Brevo event tracking (all platforms) ────────────────────
    if (url.pathname === "/brevo/track" && req.method === "POST") {
      return handleBrevoTrack(req, env, headers);
    }

    // ── iOS / Mac / Windows Store purchase reporting ────────────
    if (
      (url.pathname === "/ios/purchase-event" || url.pathname === "/windows/purchase-event") &&
      req.method === "POST"
    ) {
      const token = req.headers.get("X-App-Token");
      if (token !== "ocr_app_2026_kanzati" && token !== env.WINDOWS_APP_TOKEN)
        return new Response("Unauthorized", { status: 403, headers });
      try {
        const body = await req.json();
        const { uid, productId, price, currency, platform, displayName, category } = body;
        if (!uid || !productId) {
          return new Response(JSON.stringify({ error: "missing uid or productId" }), { status: 400, headers });
        }

        const value   = parseFloat(price) || 0;
        const cur     = currency || "USD";
        const cat     = category || "unknown";
        const plat    = platform || (url.pathname.startsWith("/windows/") ? "windows" : "ios");
        const name    = displayName || productId;
        // isTrial: explicitly set by new app versions, or inferred for old versions (price=0 + subscription)
        const isTrial = body.isTrial === true || (value === 0 && cat === "subscription");
        const txId    = `${plat}_${uid}_${productId}_${Date.now()}`;

        if (isTrial) {
          // Trial start — notify Discord/Telegram but skip GA4 purchase event (no revenue)
          await sendTrialNotification(env, {
            platform: plat,
            product: name,
            productId,
            uid,
          });
          // Update Brevo: trial started
          await brevoTrackEvent(env, uid, "trial_start", { TRIAL_PRODUCT: name, TRIAL_DATE: todayISO() });
        } else {
          await logGA4Purchase(env, uid, txId, value, cur, productId, name, cat);

          await sendSaleNotification(env, {
            platform: plat,
            product: name,
            productId,
            category: cat,
            price: value,
            currency: cur,
            uid,
          });
          // Update Brevo: purchase completed
          await brevoTrackEvent(env, uid, "purchase", {
            LAST_PURCHASE_DATE: todayISO(),
            LAST_PURCHASE_PRODUCT: name,
            LAST_PURCHASE_AMOUNT: value,
            PURCHASE_PLATFORM: plat,
          });
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: `purchase-event failed: ${e.message}` }), { status: 500, headers });
      }
    }

    // ── Android: Verify Purchase (subscription or consumable) ───
    if (url.pathname === "/verify-purchase" && req.method === "POST") {
      return handleAndroidVerifyPurchase(req, env, headers);
    }

    // ── Android: Check Subscription Status ──────────────────────
    if (url.pathname === "/check-subscription" && req.method === "POST") {
      return handleAndroidCheckSubscription(req, env, headers);
    }

    // ── Windows chat (Groq) ─────────────────────────────────────
    if (url.pathname === "/windows/chat") {
      const token = req.headers.get("X-App-Token");
      if (token !== env.WINDOWS_APP_TOKEN)
        return new Response("Unauthorized", { status: 403, headers });
      try {
        const body = await req.json();
        if (!body.messages)
          return new Response(JSON.stringify({ error: "missing messages" }), { status: 400, headers });
        const text = await geminiChat(body.messages, 8192, env.GEMINI_API_KEY);
        return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: `windows/chat failed: ${e.message}` }), { status: 500, headers });
      }
    }

    // ── Windows OCR (Google Cloud Vision) ───────────────────────
    if (url.pathname === "/windows/ocr") {
      const token = req.headers.get("X-App-Token");
      if (token !== env.WINDOWS_APP_TOKEN)
        return new Response("Unauthorized", { status: 403, headers });

      try {
        const body = await req.json();
        if (!body.image) {
          return new Response(JSON.stringify({ error: "missing image" }), { status: 400, headers });
        }

        const result = await ocrWithGCV(body.image, env.GCV_API_KEY);
        if (result.error) {
          return new Response(JSON.stringify(result), { status: 502, headers });
        }

        return new Response(JSON.stringify({ text: result.text }), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: `windows/ocr failed: ${e.message}` }), { status: 500, headers });
      }
    }

    // ── GCV proxy (iOS / Mac / Android) ─────────────────────────
    if (url.pathname === "/gcv") {
      const token = req.headers.get("X-App-Token");
      if (token !== "ocr_app_2026_kanzati")
        return new Response("Unauthorized", { status: 403, headers });
      try {
        const upstream = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${env.GCV_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: await req.text(),
        });
        const data = await upstream.json();
        return new Response(JSON.stringify(data), { status: upstream.status, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: `gcv failed: ${e.message}` }), { status: 500, headers });
      }
    }

    // ── Public bilingual chatbot (Arabic / English) ─────────────
    if (url.pathname === "/web/chat" && req.method === "POST") {
      return handleWebChat(req, env, headers);
    }

    // ── Admin: Create Paddle discount code ──────────────────────
    if (url.pathname === "/admin/create-discount" && req.method === "POST") {
      return handleCreateDiscount(req, env, headers);
    }

    // ── Suggest subscription upgrade to page-pack buyers ────────
    if (url.pathname === "/suggest-upgrade" && req.method === "POST") {
      return handleSuggestUpgrade(req, env, headers);
    }

    // ── reCAPTCHA Enterprise assessment ─────────────────────────
    if (url.pathname === "/contact/recaptcha") {
      try {
        const body = await req.json();
        const { token, siteKey, projectId, action } = body;
        if (!token || !siteKey || !projectId || !action) {
          return new Response(JSON.stringify({ error: "missing required fields" }), { status: 400, headers });
        }
        const upstream = await fetch(
          `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${env.RECAPTCHA_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: { token, siteKey, expectedAction: action } }),
          }
        );
        const data = await upstream.json();
        if (!upstream.ok) {
          return new Response(JSON.stringify({ error: "reCAPTCHA API error", detail: data }), { status: upstream.status, headers });
        }
        return new Response(JSON.stringify(data), { status: 200, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: `recaptcha failed: ${e.message}` }), { status: 500, headers });
      }
    }

    // ── Default: Gemini-style (contents) or OpenAI-style (messages) ─
    {
      try {
        const body = await req.json();

        if (body.contents) {
          const token = req.headers.get("X-App-Token");
          if (token !== "ocr_app_2026_kanzati")
            return new Response("Unauthorized", { status: 403, headers });

          const allParts = body.contents.flatMap((c) => c.parts || []);
          const imageData = allParts.find((p) => p.inlineData);

          if (imageData) {
            let base64 = imageData.inlineData.data || "";
            if (base64.includes(",")) base64 = base64.split(",")[1];
            const gcvRes = await ocrWithGCV(base64, env.GCV_API_KEY);
            if (gcvRes.error)
              return new Response(JSON.stringify(gcvRes), { status: 502, headers });
            return new Response(JSON.stringify({
              candidates: [{ content: { parts: [{ text: gcvRes.text }], role: "model" } }],
            }), { status: 200, headers });
          }

          const messages = contentsToMessages(body.contents);
          return await callGroq(messages, body.generationConfig, env.GEMINI_API_KEY, "gemini", headers);
        }

        if (body.messages) {
          const imageUrl = extractImageFromMessages(body.messages);
          if (imageUrl) {
            let base64 = imageUrl;
            if (base64.includes(",")) base64 = base64.split(",")[1];
            const gcvRes = await ocrWithGCV(base64, env.GCV_API_KEY);
            if (gcvRes.error)
              return new Response(JSON.stringify(gcvRes), { status: 502, headers });
            return new Response(JSON.stringify({
              choices: [{ message: { content: gcvRes.text, role: "assistant" } }],
            }), { status: 200, headers });
          }
          return await callGroq(body.messages, null, env.GEMINI_API_KEY, "openai", headers);
        }

        return new Response(JSON.stringify({ error: "Invalid request: missing contents or messages" }), { status: 400, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: `Worker exception: ${e.message}` }), { status: 500, headers });
      }
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      syncNewUsersToBrevo(env),
      brevoCheckInactiveUsers(env),
      // brevoCheckLowBalance and brevoCheckFreeLimitUsers removed —
      // now triggered in real-time by apps via /brevo/track + brevoSendEvent
    ]));
  },
};

// ═══════════════════════════════════════════════════════════════════
// BREVO EVENT TRACKING — works across all platforms, no app changes
// ═══════════════════════════════════════════════════════════════════
//
// Brevo contact attributes to create in Dashboard → Contacts → Settings → Attributes:
//   SIGNUP_DATE        (date)    — set on user sync
//   SIGNUP_PLATFORM    (text)    — web, ios, android, windows, mac
//   LAST_SCAN_DATE     (date)    — updated on scan events
//   TOTAL_SCANS        (number)  — incremented on scan events
//   LAST_LOGIN_DATE    (date)    — updated on login events
//   LAST_PURCHASE_DATE (date)    — updated on purchase
//   LAST_PURCHASE_PRODUCT (text) — name of last purchased product
//   LAST_PURCHASE_AMOUNT (number)— amount of last purchase
//   PURCHASE_PLATFORM  (text)    — platform of last purchase
//   PLAN_TYPE          (text)    — free, pro, pages
//   PAGES_BALANCE      (number)  — current page balance
//   LOW_BALANCE        (boolean) — true when balance < 5
//   FREE_LIMIT_HIT     (boolean) — true when user exhausted trial scans
//   INACTIVE_14D       (boolean) — true when no scan in 14 days
//   INACTIVE_30D       (boolean) — true when no scan in 30 days
//   TRIAL_PRODUCT      (text)    — product name if trial started
//   TRIAL_DATE         (date)    — date trial started
//
// Brevo automations — use Custom Event triggers (not attribute filters):
//   1. Welcome:           trigger = Custom Event "signup"
//   2. Low balance:       trigger = Custom Event "low_balance"
//   3. Free limit hit:    trigger = Custom Event "free_limit_hit"
//   4. Re-engagement 14d: trigger = Custom Event "inactive_14d" (auto via cron)
//   5. Re-engagement 30d: trigger = Custom Event "inactive_30d" (auto via cron)
//   6. Post-purchase:     trigger = Custom Event "purchase"
// Events sent via brevoSendEvent() using Brevo Track Event API (ma-key auth)

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

/**
 * Update Brevo contact attributes for a user (looked up by UID from Firestore).
 * This is the core function — all event tracking flows through here.
 */
async function brevoUpdateContact(env, email, attributes) {
  if (!env.BREVO_API_KEY || !email) return;

  try {
    await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
      method: "PUT",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "api-key": env.BREVO_API_KEY,
      },
      body: JSON.stringify({ attributes }),
    });
  } catch (e) {
    console.error(`[brevo] Failed to update ${email}:`, e.message);
  }
}

/**
 * Send a Brevo Custom Event — triggers automations immediately via Custom Event triggers.
 * Uses the Brevo API /v3/events endpoint with the same BREVO_API_KEY.
 */
async function brevoSendEvent(env, email, eventName, properties = {}) {
  if (!env.BREVO_API_KEY || !email) return;
  try {
    const res = await fetch("https://api.brevo.com/v3/events", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "api-key": env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        event_name: eventName,
        identifiers: { email_id: email.trim().toLowerCase() },
        properties: properties,
      }),
    });
    console.log(`[brevo-event] Sent ${eventName} for ${email} (${res.status})`);
  } catch (e) {
    console.error(`[brevo-event] Failed ${eventName} for ${email}:`, e.message);
  }
}

/**
 * Track an event for a user by UID — looks up email from Firestore, then updates Brevo.
 */
async function brevoTrackEvent(env, uid, eventType, extraAttributes) {
  if (!env.BREVO_API_KEY || !uid || uid === "guest") return;

  try {
    const accessToken = await getFirestoreAccessToken(env);
    const userDoc = await firestoreGetUser(uid, accessToken);
    const email = userDoc?.fields?.email?.stringValue;
    if (!email) {
      console.warn(`[brevo] No email found for uid ${uid}`);
      return;
    }

    const attributes = { ...extraAttributes };

    // Add event-specific defaults
    switch (eventType) {
      case "scan_complete":
        attributes.LAST_SCAN_DATE = todayISO();
        attributes.NEW_PURCHASE = false; // reset so next purchase triggers email
        // Increment total scans
        const currentScans = parseInt(userDoc?.fields?.totalScans?.integerValue || "0");
        attributes.TOTAL_SCANS = currentScans + 1;
        // Check balance while we have the data
        const balance = parseInt(userDoc?.fields?.ocrPagesBalance?.integerValue || "0");
        const plan = userDoc?.fields?.plan?.stringValue || "free";
        attributes.PAGES_BALANCE = balance;
        attributes.PLAN_TYPE = plan;
        if (plan !== "pro" && balance < 5 && balance >= 0) {
          attributes.LOW_BALANCE = true;
        }
        break;

      case "login":
        attributes.LAST_LOGIN_DATE = todayISO();
        break;

      case "purchase":
        // attributes already set by caller
        attributes.LOW_BALANCE = false; // reset after purchase
        attributes.NEW_PURCHASE = true;
        break;

      case "subscription_activated":
        attributes.PLAN_TYPE = "pro";
        attributes.LOW_BALANCE = false;
        attributes.FREE_LIMIT_HIT = false;
        attributes.NEW_PURCHASE = true;
        break;

      case "subscription_canceled":
        attributes.PLAN_TYPE = "free";
        break;

      case "free_limit_hit":
        attributes.FREE_LIMIT_HIT = true;
        break;

      case "trial_start":
        // attributes already set by caller
        break;
    }

    await brevoUpdateContact(env, email, attributes);

    // Send real Brevo track events to trigger automations immediately
    const automationEvents = ["purchase", "subscription_activated", "free_limit_hit", "scan_complete"];
    if (automationEvents.includes(eventType)) {
      await brevoSendEvent(env, email, eventType, attributes);
    }
    // If low balance detected during scan_complete, also fire low_balance event
    if (attributes.LOW_BALANCE === true && eventType === "scan_complete") {
      await brevoSendEvent(env, email, "low_balance", { balance: attributes.PAGES_BALANCE, plan: attributes.PLAN_TYPE });
    }

    console.log(`[brevo] Tracked ${eventType} for ${email}`);
  } catch (e) {
    console.error(`[brevo] Track event failed for ${uid}:`, e.message);
  }
}

/**
 * /brevo/track endpoint — optional, any platform can call this
 * Body: { uid, event, email?, attributes? }
 * Events: scan_complete, login, low_balance, free_limit_hit
 */
async function handleBrevoTrack(req, env, headers) {
  const token = req.headers.get("X-App-Token");
  if (token !== "ocr_app_2026_kanzati" && token !== env.WINDOWS_APP_TOKEN)
    return new Response("Unauthorized", { status: 403, headers });

  if (!env.BREVO_API_KEY) {
    return new Response(JSON.stringify({ error: "BREVO_API_KEY not configured" }), { status: 500, headers });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
  }

  const { uid, event, email, attributes } = body;

  if (!event) {
    return new Response(JSON.stringify({ error: "event is required" }), { status: 400, headers });
  }

  // If email is provided directly (e.g., from web where UID lookup isn't needed)
  if (email && !uid) {
    const mergedAttrs = {
      ...(attributes || {}),
      ...(event === "scan_complete" ? { LAST_SCAN_DATE: todayISO() } : {}),
      ...(event === "login" ? { LAST_LOGIN_DATE: todayISO() } : {}),
      ...(event === "free_limit_hit" ? { FREE_LIMIT_HIT: true } : {}),
    };
    await brevoUpdateContact(env, email, mergedAttrs);
    // Send track event to trigger automations
    await brevoSendEvent(env, email, event, mergedAttrs);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (!uid) {
    return new Response(JSON.stringify({ error: "uid or email is required" }), { status: 400, headers });
  }

  await brevoTrackEvent(env, uid, event, attributes || {});
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ═══════════════════════════════════════════════════════════════════
// BREVO CRON JOBS — check Firestore and update Brevo attributes
// No app changes needed — runs every 15 minutes via Cron Trigger
// ═══════════════════════════════════════════════════════════════════

/**
 * Check for users with low page balance (< 5) and update Brevo
 */
async function brevoCheckLowBalance(env) {
  if (!env.BREVO_API_KEY) return;

  try {
    const accessToken = await getFirestoreAccessToken(env);
    // Query users with plan != "pro" and ocrPagesBalance < 5 and ocrPagesBalance > 0
    // (They have pages but running low)
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery`;

    const res = await fetch(queryUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "users" }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                {
                  fieldFilter: {
                    field: { fieldPath: "ocrPagesBalance" },
                    op: "LESS_THAN",
                    value: { integerValue: "5" },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "ocrPagesBalance" },
                    op: "GREATER_THAN",
                    value: { integerValue: "0" },
                  },
                },
                {
                  fieldFilter: {
                    field: { fieldPath: "brevoLowBalanceNotified" },
                    op: "EQUAL",
                    value: { booleanValue: false },
                  },
                },
              ],
            },
          },
          limit: 50,
        },
      }),
    });

    if (!res.ok) {
      // Firestore composite queries may need an index — fall back to simpler query
      console.warn("[brevo-cron-lowbalance] Complex query failed, trying simple query");
      return await brevoCheckLowBalanceSimple(env, accessToken);
    }

    const rows = await res.json();
    let count = 0;

    for (const row of rows) {
      const doc = row.document;
      if (!doc || !doc.fields) continue;

      const email = (doc.fields.email?.stringValue || "").trim().toLowerCase();
      if (!email || !email.includes("@")) continue;

      const balance = parseInt(doc.fields.ocrPagesBalance?.integerValue || "0");
      const plan = doc.fields.plan?.stringValue || "free";
      if (plan === "pro") continue; // Pro users have unlimited

      await brevoUpdateContact(env, email, {
        LOW_BALANCE: true,
        PAGES_BALANCE: balance,
        PLAN_TYPE: plan,
      });

      // Mark as notified so we don't spam
      const uid = doc.name.split("/").pop();
      await firestorePatchUser(uid, {
        brevoLowBalanceNotified: { booleanValue: true },
      }, accessToken);

      count++;
    }

    if (count > 0) console.log(`[brevo-cron] Low balance: updated ${count} contact(s)`);
  } catch (e) {
    console.error("[brevo-cron-lowbalance] Error:", e.message);
  }
}

/**
 * Simpler fallback for low balance check (no composite index needed)
 */
async function brevoCheckLowBalanceSimple(env, accessToken) {
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery`;

  const res = await fetch(queryUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "users" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "ocrPagesBalance" },
            op: "LESS_THAN",
            value: { integerValue: "5" },
          },
        },
        limit: 100,
      },
    }),
  });

  if (!res.ok) return;
  const rows = await res.json();
  let count = 0;

  for (const row of rows) {
    const doc = row.document;
    if (!doc || !doc.fields) continue;
    if (doc.fields.brevoLowBalanceNotified?.booleanValue === true) continue;

    const email = (doc.fields.email?.stringValue || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    const balance = parseInt(doc.fields.ocrPagesBalance?.integerValue || "0");
    if (balance <= 0) continue; // Already at zero — that's a different trigger
    const plan = doc.fields.plan?.stringValue || "free";
    if (plan === "pro") continue;

    await brevoUpdateContact(env, email, {
      LOW_BALANCE: true,
      PAGES_BALANCE: balance,
      PLAN_TYPE: plan,
    });

    const uid = doc.name.split("/").pop();
    await firestorePatchUser(uid, {
      brevoLowBalanceNotified: { booleanValue: true },
    }, accessToken);
    count++;
  }

  if (count > 0) console.log(`[brevo-cron] Low balance (simple): updated ${count} contact(s)`);
}

/**
 * Check for inactive users (no scan in 14 or 30 days) and update Brevo
 */
async function brevoCheckInactiveUsers(env) {
  if (!env.BREVO_API_KEY) return;

  try {
    const accessToken = await getFirestoreAccessToken(env);
    const now = Date.now();
    const days14ago = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
    const days30ago = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery`;

    // Query users who have used the service (have lastScanDate) but not recently
    const res = await fetch(queryUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "users" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "lastScanDate" },
              op: "LESS_THAN",
              value: { stringValue: days14ago },
            },
          },
          limit: 100,
        },
      }),
    });

    if (!res.ok) {
      console.warn("[brevo-cron-inactive] Query failed:", res.status);
      return;
    }

    const rows = await res.json();
    let count14 = 0, count30 = 0;

    for (const row of rows) {
      const doc = row.document;
      if (!doc || !doc.fields) continue;

      const email = (doc.fields.email?.stringValue || "").trim().toLowerCase();
      if (!email || !email.includes("@")) continue;

      const lastScan = doc.fields.lastScanDate?.stringValue || "";
      if (!lastScan) continue;

      const lastScanTime = new Date(lastScan).getTime();
      const uid = doc.name.split("/").pop();

      const attrs = {};
      const is14 = lastScanTime < new Date(days14ago).getTime();
      const is30 = lastScanTime < new Date(days30ago).getTime();

      // Only notify once per threshold
      if (is30 && doc.fields.brevoInactive30Notified?.booleanValue !== true) {
        attrs.INACTIVE_30D = true;
        attrs.INACTIVE_14D = true;
        await firestorePatchUser(uid, {
          brevoInactive30Notified: { booleanValue: true },
          brevoInactive14Notified: { booleanValue: true },
        }, accessToken);
        count30++;
        await brevoSendEvent(env, email, "inactive_30d", { last_scan: lastScan });
      } else if (is14 && doc.fields.brevoInactive14Notified?.booleanValue !== true) {
        attrs.INACTIVE_14D = true;
        await firestorePatchUser(uid, {
          brevoInactive14Notified: { booleanValue: true },
        }, accessToken);
        count14++;
        await brevoSendEvent(env, email, "inactive_14d", { last_scan: lastScan });
      } else {
        continue; // Already notified
      }

      await brevoUpdateContact(env, email, attrs);
    }

    if (count14 + count30 > 0) {
      console.log(`[brevo-cron] Inactive: 14d=${count14}, 30d=${count30}`);
    }
  } catch (e) {
    console.error("[brevo-cron-inactive] Error:", e.message);
  }
}

/**
 * Check for free users who have exhausted their 10 trial scans
 */
async function brevoCheckFreeLimitUsers(env) {
  if (!env.BREVO_API_KEY) return;

  try {
    const accessToken = await getFirestoreAccessToken(env);
    const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery`;

    // Query free users who have used all 10 trial scans
    const res = await fetch(queryUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "users" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "trialScansUsed" },
              op: "GREATER_THAN_OR_EQUAL",
              value: { integerValue: "10" },
            },
          },
          limit: 100,
        },
      }),
    });

    if (!res.ok) {
      console.warn("[brevo-cron-freelimit] Query failed:", res.status);
      return;
    }

    const rows = await res.json();
    let count = 0;

    for (const row of rows) {
      const doc = row.document;
      if (!doc || !doc.fields) continue;
      if (doc.fields.brevoFreeLimitNotified?.booleanValue === true) continue;

      const email = (doc.fields.email?.stringValue || "").trim().toLowerCase();
      if (!email || !email.includes("@")) continue;

      const plan = doc.fields.plan?.stringValue || "free";
      if (plan === "pro") continue; // Pro users don't have limits

      await brevoUpdateContact(env, email, {
        FREE_LIMIT_HIT: true,
        PLAN_TYPE: plan,
      });

      const uid = doc.name.split("/").pop();
      await firestorePatchUser(uid, {
        brevoFreeLimitNotified: { booleanValue: true },
      }, accessToken);
      count++;
    }

    if (count > 0) console.log(`[brevo-cron] Free limit hit: updated ${count} contact(s)`);
  } catch (e) {
    console.error("[brevo-cron-freelimit] Error:", e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Brevo user sync cron (existing — enhanced with SIGNUP_DATE)
// ═══════════════════════════════════════════════════════════════════

const NEW_USERS_LIST_ID = 2;

const PLATFORM_LIST_MAP = {
  web: 10,
  ios: 11,
  android: 12,
  mac: 13,
  macos: 13,
  windows: 14,
};

function getListIdsForPlatform(platform) {
  const normalized = (platform || "").trim().toLowerCase();

  let platformListId = PLATFORM_LIST_MAP[normalized];
  if (!platformListId) {
    if (normalized.startsWith("web")) platformListId = PLATFORM_LIST_MAP.web;
    else if (normalized.startsWith("ios")) platformListId = PLATFORM_LIST_MAP.ios;
    else if (normalized.startsWith("android")) platformListId = PLATFORM_LIST_MAP.android;
    else if (normalized.startsWith("mac")) platformListId = PLATFORM_LIST_MAP.mac;
    else if (normalized.startsWith("win")) platformListId = PLATFORM_LIST_MAP.windows;
  }

  return platformListId ? [NEW_USERS_LIST_ID, platformListId] : [NEW_USERS_LIST_ID];
}

async function syncNewUsersToBrevo(env) {
  if (!env.BREVO_API_KEY) {
    console.warn("[brevo-cron] BREVO_API_KEY not configured");
    return;
  }

  let accessToken;
  try {
    accessToken = await getFirestoreAccessToken(env);
  } catch (e) {
    console.error("[brevo-cron] Failed to get Firestore token:", e.message);
    return;
  }

  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents:runQuery`;
  const cutoffIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const res = await fetch(queryUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "users" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "createdAt" },
            op: "GREATER_THAN_OR_EQUAL",
            value: { timestampValue: cutoffIso },
          },
        },
        limit: 50,
      },
    }),
  });

  if (!res.ok) {
    console.error("[brevo-cron] Firestore query failed:", res.status, await res.text());
    return;
  }

  const rows = await res.json();
  let syncedCount = 0;

  for (const row of rows) {
    const doc = row.document;
    if (!doc || !doc.fields) continue;
    if (doc.fields.brevoSynced?.booleanValue === true) continue;

    const email = (doc.fields.email?.stringValue || "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;

    const rawFirst = (doc.fields.firstName?.stringValue || "").trim();
    const rawLast = (doc.fields.lastName?.stringValue || "").trim();
    const fullName = (doc.fields.displayName?.stringValue || doc.fields.name?.stringValue || "").trim();
    const [splitFirst = "", ...splitRest] = fullName ? fullName.split(/\s+/) : ["", ""];

    const firstName = rawFirst || splitFirst;
    const lastName = rawLast || splitRest.join(" ");
    const platform =
      doc.fields.platform?.stringValue ||
      doc.fields.signupPlatform?.stringValue ||
      doc.fields.source?.stringValue ||
      "unknown";
    const uid = doc.name.split("/").pop();

    const brevoRes = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "api-key": env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        email,
        attributes: {
          FIRSTNAME: firstName,
          LASTNAME: lastName,
          SIGNUP_PLATFORM: platform,
          SIGNUP_DATE: todayISO(),
          PLAN_TYPE: doc.fields.plan?.stringValue || "free",
        },
        listIds: getListIdsForPlatform(platform),
        updateEnabled: true,
      }),
    });

    if (brevoRes.ok) {
      await firestorePatchUser(
        uid,
        {
          brevoSynced: { booleanValue: true },
          brevoSyncedAt: { stringValue: new Date().toISOString() },
        },
        accessToken
      );
      syncedCount++;
      // Send signup event to trigger Welcome automation
      await brevoSendEvent(env, email, "signup", { platform, signup_date: todayISO() });
      console.log(`[brevo-cron] Synced ${email} (${uid}) from ${platform}`);
    } else {
      const errText = await brevoRes.text();
      console.error(`[brevo-cron] Brevo error for ${email} (${brevoRes.status}):`, errText);
    }
  }

  console.log(`[brevo-cron] Run complete. Synced ${syncedCount} new contact(s).`);
}

// ═══════════════════════════════════════════════════════════════════
// Android Purchase Verification (Google Play)
// ═══════════════════════════════════════════════════════════════════

const ANDROID_PACKAGE = "com.kanzati.arabicocr";
const ANDROID_PAGES_PER_PRODUCT = {
  p_100: 100,
  pages_1000: 1000,
};
const ANDROID_SUBSCRIPTION_SKUS = ["monthlysb", "yearlysb"];

async function extractFirebaseUid(req, env) {
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) throw new Error("Missing Authorization header");
  const idToken = auth.slice(7);
  return await verifyFirebaseToken(idToken, FIREBASE_PROJECT);
}

async function handleAndroidVerifyPurchase(req, env, headers) {
  try {
    const uid = await extractFirebaseUid(req, env);
    const body = await req.json();
    const { purchaseToken, productId } = body;

    if (!purchaseToken || !productId) {
      return new Response(JSON.stringify({ error: "missing purchaseToken or productId" }), { status: 400, headers });
    }

    const accessToken = await getGoogleAccessToken(
      env,
      "https://www.googleapis.com/auth/androidpublisher https://www.googleapis.com/auth/datastore"
    );

    const CONSUMABLE_MAP = {
      p_100: { pages: 100, price: 4.99 },
      pages_500: { pages: 500, price: 12.99 },
      pages_1000: { pages: 1000, price: 19.99 },
      pages_10000: { pages: 10000, price: 99.99 },
    };

    const SUBSCRIPTION_MAP = {
      monthlysb: { name: "Pro Monthly Subscription", plan: "monthly", price: 9.99 },
      yearlysb: { name: "Pro Yearly Subscription", plan: "yearly", price: 49.99 },
    };

    const subInfo = SUBSCRIPTION_MAP[productId];

    if (subInfo) {
      // ── Handle Subscriptions ──
      const sub = await playVerifySubscription(ANDROID_PACKAGE, productId, purchaseToken, accessToken);
      const isActive = sub.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE"
        || sub.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";

      let expiryMs = 0;
      if (sub.lineItems && sub.lineItems.length > 0) {
        const expiry = sub.lineItems[0].expiryTime;
        if (expiry) expiryMs = new Date(expiry).getTime();
      }

      await firestorePatchUser(uid, {
        isProUser: { booleanValue: isActive },
        plan: { stringValue: isActive ? "pro" : "free" },
        subscriptionStatus: { stringValue: isActive ? "active" : sub.subscriptionState },
        subscriptionPlan: { stringValue: subInfo.plan },
        subscriptionId: { stringValue: productId },
        subscriptionExpiry: { integerValue: String(expiryMs) },
        purchaseToken: { stringValue: purchaseToken },
        lastVerified: { integerValue: String(Date.now()) },
      }, accessToken);

      if (isActive) {
        await sendSaleNotification(env, {
          platform: "android",
          product: subInfo.name,
          productId,
          category: "subscription",
          price: subInfo.price,
          currency: "USD",
          uid,
        });
        // Brevo: subscription activated
        await brevoTrackEvent(env, uid, "subscription_activated", {
          LAST_PURCHASE_DATE: todayISO(),
          LAST_PURCHASE_PRODUCT: subInfo.name,
          LAST_PURCHASE_AMOUNT: subInfo.price,
          PURCHASE_PLATFORM: "android",
        });
      }

      return new Response(JSON.stringify({
        valid: true,
        isActive,
        expiryTime: expiryMs,
        subscriptionState: sub.subscriptionState,
      }), { status: 200, headers });

    } else {
      // ── Handle Consumables ──
      const consumable = CONSUMABLE_MAP[productId] || { pages: ANDROID_PAGES_PER_PRODUCT[productId] || 0, price: 0 };
      const pagesToAdd = consumable.pages;

      if (pagesToAdd === 0) {
        return new Response(JSON.stringify({ valid: false, error: `Unknown product ID: ${productId}` }), { status: 400, headers });
      }

      const purchase = await playVerifyProduct(ANDROID_PACKAGE, productId, purchaseToken, accessToken);

      if (purchase.purchaseState !== 0) {
        return new Response(JSON.stringify({ valid: false, error: "Purchase not completed", purchaseState: purchase.purchaseState }), { status: 400, headers });
      }

      if (purchase.consumptionState === 1) {
        console.log(`[consumable] Note: Purchase ${purchaseToken} was already consumed, proceeding with notification/verification.`);
      }

      const userDoc = await firestoreGetUser(uid, accessToken);
      const currentBalance = userDoc?.fields?.ocrPagesBalance?.integerValue
        ? parseInt(userDoc.fields.ocrPagesBalance.integerValue) : 0;
      const currentTotal = userDoc?.fields?.ocrPagesTotal?.integerValue
        ? parseInt(userDoc.fields.ocrPagesTotal.integerValue) : 0;

      await firestorePatchUser(uid, {
        ocrPagesBalance: { integerValue: String(currentBalance + pagesToAdd) },
        ocrPagesTotal: { integerValue: String(currentTotal + pagesToAdd) },
        lastPurchase: { stringValue: new Date().toISOString() },
        lastPurchaseSource: { stringValue: "google_play" },
        brevoLowBalanceNotified: { booleanValue: false }, // Reset low balance flag
      }, accessToken);

      await playAcknowledgeProduct(ANDROID_PACKAGE, productId, purchaseToken, accessToken);

      await sendSaleNotification(env, {
        platform: "android",
        product: `${pagesToAdd} Pages Pack`,
        productId,
        category: "pages",
        price: consumable.price,
        currency: "USD",
        uid,
      });

      // Brevo: purchase completed
      await brevoTrackEvent(env, uid, "purchase", {
        LAST_PURCHASE_DATE: todayISO(),
        LAST_PURCHASE_PRODUCT: `${pagesToAdd} Pages Pack`,
        LAST_PURCHASE_AMOUNT: consumable.price,
        PURCHASE_PLATFORM: "android",
      });

      return new Response(JSON.stringify({
        valid: true,
        pagesAdded: pagesToAdd,
        newBalance: currentBalance + pagesToAdd,
      }), { status: 200, headers });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: `verify-purchase failed: ${e.message}` }), { status: 500, headers });
  }
}

async function handleAndroidCheckSubscription(req, env, headers) {
  try {
    const uid = await extractFirebaseUid(req, env);
    const body = await req.json();
    const { purchaseToken, productId } = body;
    if (!purchaseToken || !productId) {
      return new Response(JSON.stringify({ error: "missing purchaseToken or productId" }), { status: 400, headers });
    }

    const accessToken = await getGoogleAccessToken(env, "https://www.googleapis.com/auth/androidpublisher https://www.googleapis.com/auth/datastore");
    const sub = await playVerifySubscription(ANDROID_PACKAGE, productId, purchaseToken, accessToken);

    const isActive = sub.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE"
      || sub.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";

    let expiryMs = 0;
    if (sub.lineItems && sub.lineItems.length > 0) {
      const expiry = sub.lineItems[0].expiryTime;
      if (expiry) expiryMs = new Date(expiry).getTime();
    }

    await firestorePatchUser(uid, {
      isProUser: { booleanValue: isActive },
      plan: { stringValue: isActive ? "pro" : "free" },
      subscriptionStatus: { stringValue: isActive ? "active" : sub.subscriptionState },
      subscriptionExpiry: { integerValue: String(expiryMs) },
      lastVerified: { integerValue: String(Date.now()) },
    }, accessToken);

    return new Response(JSON.stringify({
      valid: true,
      isActive,
      expiryTime: expiryMs,
      subscriptionState: sub.subscriptionState,
    }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: `check-subscription failed: ${e.message}` }), { status: 500, headers });
  }
}

// ── Google Play Developer API helpers ───────────────────────────

async function playVerifySubscription(packageName, subscriptionId, token, accessToken) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/subscriptionsv2/tokens/${token}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Play subscriptionsv2 error ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function playVerifyProduct(packageName, productId, token, accessToken) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${token}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Play products error ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function playAcknowledgeProduct(packageName, productId, token, accessToken) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${productId}/tokens/${token}:acknowledge`;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

// ── Firebase Auth (verify ID token) ─────────────────────────────

let _googleJwkCache = null;
let _googleJwkExpiry = 0;

async function getGooglePublicKey(kid) {
  if (_googleJwkCache && Date.now() < _googleJwkExpiry) {
    const cached = _googleJwkCache[kid];
    if (cached) return cached;
  }

  const res = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  );
  if (!res.ok) throw new Error(`Failed to fetch Google JWKs: ${res.status}`);
  const { keys } = await res.json();

  const keyMap = {};
  for (const jwk of keys) {
    keyMap[jwk.kid] = await crypto.subtle.importKey(
      "jwk", jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, ["verify"]
    );
  }
  _googleJwkCache = keyMap;
  _googleJwkExpiry = Date.now() + 3600_000;

  if (!keyMap[kid]) throw new Error(`Unknown signing key: ${kid}`);
  return keyMap[kid];
}

async function verifyFirebaseToken(idToken, projectId) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");

  const header  = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
  const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));

  if (payload.aud !== projectId) throw new Error("Token audience mismatch");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("Token issuer mismatch");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error("Token expired");
  if (!payload.sub || !payload.user_id) throw new Error("Missing subject");

  const key = await getGooglePublicKey(header.kid);

  const sigBuf  = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const dataBuf = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid   = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sigBuf, dataBuf);
  if (!valid) throw new Error("Invalid signature");

  return payload.user_id || payload.sub;
}

// ═══════════════════════════════════════════════════════════════════
// Paddle Webhook
// ═══════════════════════════════════════════════════════════════════

const PAGES_PRICES = {
  "pri_01kzkf3facgaxhht2t856vts11": 100,
  "pri_01kxqmfvpbe73srtt97bvsafer": 1000,
};

const SUBSCRIPTION_PRICES = {
  "pri_01m1kg1q6x5tvajs5xap2ms0xe": "monthly",
  "pri_01kg5bx13n3m7ts4e47fz7xm62": "monthly",
  "pri_01kg5by6qyxm19wb79rhrjmgt8": "yearly",
};

const FIREBASE_PROJECT   = "arabic-ocr-a89ec";
const GA4_MEASUREMENT_ID = "G-YJ3SGJZ4BH";

async function handlePaddleWebhook(req, env, headers) {
  const rawBody   = await req.text();
  const signature = req.headers.get("paddle-signature");

  if (!signature || !env.PADDLE_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: "Missing signature or secret" }), { status: 401, headers });
  }
  const isValid = await verifyPaddleSignature(rawBody, signature, env.PADDLE_WEBHOOK_SECRET);
  if (!isValid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401, headers });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
  }

  const eventType = event.event_type;
  const data      = event.data;
  console.log(`Paddle webhook: ${eventType}`, JSON.stringify({ id: data?.id, custom_data: data?.custom_data }));

  try {
    const accessToken = await getFirestoreAccessToken(env);

    switch (eventType) {
      case "transaction.completed": {
        const uid      = data.custom_data?.uid;
        const isGuest  = !uid || uid === "guest";
        const email    = data.customer?.email || "unknown";
        const items    = data.items || [];

        for (const item of items) {
          const priceId = item.price?.id || item.price_id;
          const pages   = PAGES_PRICES[priceId];
          const subPlan = SUBSCRIPTION_PRICES[priceId];

          if (pages) {
            const amount = parseFloat(data.details?.totals?.total ?? (pages === 100 ? 499 : 1999)) / 100;
            if (!isGuest) {
              await firestoreIncrementPages(uid, pages, accessToken);
              console.log(`Credited ${pages} pages to user ${uid}`);
              await logGA4Purchase(env, uid, data.id, amount, data.currency_code || "USD", priceId, `${pages} Pages Pack`, "pages");

              // Reset low balance flag after page purchase
              await firestorePatchUser(uid, {
                brevoLowBalanceNotified: { booleanValue: false },
              }, accessToken);
            }
            await sendSaleNotification(env, {
              platform: "web", product: `${pages} Pages Pack`, productId: priceId,
              category: "pages", price: amount, currency: data.currency_code || "USD",
              uid: isGuest ? `guest (${email})` : uid,
            });

            // Brevo: post-purchase
            const brevoEmail = isGuest ? email : null;
            if (!isGuest) {
              await brevoTrackEvent(env, uid, "purchase", {
                LAST_PURCHASE_DATE: todayISO(),
                LAST_PURCHASE_PRODUCT: `${pages} Pages Pack`,
                LAST_PURCHASE_AMOUNT: amount,
                PURCHASE_PLATFORM: "web",
              });
            } else if (brevoEmail && brevoEmail !== "unknown") {
              await brevoUpdateContact(env, brevoEmail, {
                LAST_PURCHASE_DATE: todayISO(),
                LAST_PURCHASE_PRODUCT: `${pages} Pages Pack`,
                LAST_PURCHASE_AMOUNT: amount,
                PURCHASE_PLATFORM: "web",
                LOW_BALANCE: false,
              });
            }
          } else if (subPlan) {
            const amount = parseFloat(data.details?.totals?.total ?? (subPlan === "yearly" ? 4999 : 999)) / 100;
            if (!isGuest) {
              await firestoreSetPro(uid, subPlan, accessToken);
              console.log(`Set Pro (${subPlan}) for user ${uid}`);
              await logGA4Purchase(env, uid, data.id, amount, data.currency_code || "USD", priceId, `Pro ${subPlan} Subscription`, "subscription");
            }
            await sendSaleNotification(env, {
              platform: "web", product: `Pro ${subPlan} Subscription`, productId: priceId,
              category: "subscription", price: amount, currency: data.currency_code || "USD",
              uid: isGuest ? `guest (${email})` : uid,
            });

            // Brevo: subscription purchased
            if (!isGuest) {
              await brevoTrackEvent(env, uid, "subscription_activated", {
                LAST_PURCHASE_DATE: todayISO(),
                LAST_PURCHASE_PRODUCT: `Pro ${subPlan} Subscription`,
                LAST_PURCHASE_AMOUNT: amount,
                PURCHASE_PLATFORM: "web",
              });
            } else if (email && email !== "unknown") {
              await brevoUpdateContact(env, email, {
                LAST_PURCHASE_DATE: todayISO(),
                LAST_PURCHASE_PRODUCT: `Pro ${subPlan} Subscription`,
                LAST_PURCHASE_AMOUNT: amount,
                PLAN_TYPE: "pro",
                PURCHASE_PLATFORM: "web",
              });
            }
          }
        }
        break;
      }

      case "subscription.activated":
      case "subscription.created": {
        const uid = data.custom_data?.uid;
        if (!uid || uid === "guest") break;
        const priceId = data.items?.[0]?.price?.id;
        const plan    = SUBSCRIPTION_PRICES[priceId] || "monthly";
        await firestoreSetPro(uid, plan, accessToken);
        console.log(`Subscription ${eventType}: Pro (${plan}) for user ${uid}`);

        // Brevo: subscription activated
        await brevoTrackEvent(env, uid, "subscription_activated", {
          PLAN_TYPE: "pro",
        });
        break;
      }

      case "subscription.updated": {
        const uid = data.custom_data?.uid;
        if (!uid || uid === "guest") break;
        const status = data.status;
        if (status === "active") {
          const priceId = data.items?.[0]?.price?.id;
          const plan    = SUBSCRIPTION_PRICES[priceId] || "monthly";
          await firestoreSetPro(uid, plan, accessToken);
        } else if (status === "canceled" || status === "past_due") {
          await firestoreRemovePro(uid, status, accessToken);
          console.log(`Subscription ${status} for user ${uid}`);

          // Brevo: subscription canceled
          await brevoTrackEvent(env, uid, "subscription_canceled", {
            PLAN_TYPE: "free",
          });
        }
        break;
      }

      case "subscription.canceled": {
        const uid = data.custom_data?.uid;
        if (!uid || uid === "guest") break;
        await firestoreRemovePro(uid, "canceled", accessToken);
        console.log(`Subscription canceled for user ${uid}`);

        // Brevo: subscription canceled
        await brevoTrackEvent(env, uid, "subscription_canceled", {
          PLAN_TYPE: "free",
        });
        break;
      }

      default:
        console.log(`Unhandled Paddle event: ${eventType}`);
    }
  } catch (e) {
    console.error(`Webhook processing error: ${e.message}`);
    return new Response(JSON.stringify({ received: true, error: e.message }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers });
}

// ═══════════════════════════════════════════════════════════════════
// Paddle Signature Verification
// ═══════════════════════════════════════════════════════════════════

async function verifyPaddleSignature(rawBody, signatureHeader, secret) {
  try {
    const parts = {};
    for (const part of signatureHeader.split(";")) {
      const [key, val] = part.split("=");
      parts[key] = val;
    }
    const ts = parts.ts;
    const h1 = parts.h1;
    if (!ts || !h1) return false;

    const age = Math.abs(Date.now() / 1000 - parseInt(ts, 10));
    if (age > 300) return false;

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signed   = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${rawBody}`));
    const computed = Array.from(new Uint8Array(signed)).map((b) => b.toString(16).padStart(2, "0")).join("");

    if (computed.length !== h1.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ h1.charCodeAt(i);
    }
    return diff === 0;
  } catch (e) {
    console.error("Signature verification error:", e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════
// GA4 Analytics
// ═══════════════════════════════════════════════════════════════════

async function logGA4Purchase(env, uid, transactionId, value, currency, itemId, itemName, itemCategory) {
  if (!env.GA4_API_SECRET) {
    console.log("GA4_API_SECRET not set, skipping analytics");
    return;
  }
  try {
    const res = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: uid,
          user_id: uid,
          events: [{
            name: "purchase",
            params: {
              transaction_id: transactionId,
              value,
              currency,
              source: "worker",
              items: [{
                item_id: itemId,
                item_name: itemName,
                item_category: itemCategory,
                price: value,
                quantity: 1,
              }],
            },
          }],
        }),
      }
    );
    console.log(`GA4 purchase event sent for ${uid}: ${res.status}`);
  } catch (e) {
    console.error(`GA4 event failed: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Sales Notifications (Telegram + Discord webhook)
// ═══════════════════════════════════════════════════════════════════

async function postToDiscordWebhook(env, message) {
  if (!env.SALES_WEBHOOK_URL) {
    console.error("[sales-webhook] SALES_WEBHOOK_URL is missing");
    return;
  }
  try {
    const webhookUrl = new URL(env.SALES_WEBHOOK_URL);

    if (
      !["discord.com", "discordapp.com"].includes(webhookUrl.hostname) ||
      !webhookUrl.pathname.includes("/api/webhooks/")
    ) {
      console.error("[sales-webhook] Invalid Discord webhook URL format");
      return;
    }

    webhookUrl.searchParams.set("wait", "true");

    const response = await fetch(webhookUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });

    const responseBody = await response.text();

    if (response.ok) {
      console.log(`[sales-webhook] Discord delivered successfully: HTTP ${response.status}`);
    } else {
      console.error(
        `[sales-webhook] Discord rejected message: HTTP ${response.status}`,
        responseBody.slice(0, 500)
      );
    }
  } catch (e) {
    console.error(`[sales-webhook] Discord request failed: ${e.message}`);
  }
}

async function sendSaleNotification(env, sale) {
  const emoji = sale.category === "subscription" ? "\u{1F451}" : "\u{1F4C4}";
  const message = [
    `${emoji} New Sale!`,
    `Platform: ${sale.platform}`,
    `Product: ${sale.product} (${sale.productId})`,
    `Type: ${sale.category}`,
    `Amount: ${sale.price} ${sale.currency}`,
    `User: ${sale.uid}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }),
      });
    } catch (e) {
      console.error(`Telegram notification failed: ${e.message}`);
    }
  }

  await postToDiscordWebhook(env, message);
}

async function sendTrialNotification(env, sale) {
  const message = [
    `🎯 New Trial Started!`,
    `Platform: ${sale.platform}`,
    `Product: ${sale.product} (${sale.productId})`,
    `User: ${sale.uid}`,
    `Time: ${new Date().toISOString()}`,
    `→ 3-day free trial — 10 trial scans`,
  ].join("\n");

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message }),
      });
    } catch (e) {
      console.error(`Telegram trial notification failed: ${e.message}`);
    }
  }

  await postToDiscordWebhook(env, message);
}

// ═══════════════════════════════════════════════════════════════════
// Google OAuth2 (Service Account)
// ═══════════════════════════════════════════════════════════════════

let _cachedToken = null;
let _cachedTokenExpiry = 0;
let _cachedTokenScope = "";

async function getGoogleAccessToken(env, scope) {
  const email = env.GCP_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GCP_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error("Missing GCP_SERVICE_ACCOUNT_EMAIL or GCP_PRIVATE_KEY");
  }

  if (
    _cachedToken &&
    _cachedTokenScope === scope &&
    Date.now() < _cachedTokenExpiry - 60000
  ) {
    return _cachedToken;
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: "RS256",
      typ: "JWT",
      kid: env.GCP_PRIVATE_KEY_ID,
    };
    const payload = {
      iss: email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };

    const pemContents = privateKey
      .replace(/\\n/g, "\n")
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/\s/g, "");

    const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryKey.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const toSign =
      base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(payload));

    const sig = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      new TextEncoder().encode(toSign)
    );

    const jwt = toSign + "." + base64urlBuffer(sig);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Google OAuth failed: ${tokenRes.status} ${err}`);
    }

    const tokenData = await tokenRes.json();

    _cachedToken = tokenData.access_token;
    _cachedTokenExpiry = Date.now() + (tokenData.expires_in || 3600) * 1000;
    _cachedTokenScope = scope;

    return _cachedToken;
  } catch (e) {
    console.error("Google OAuth diagnostic failure", { message: e.message, name: e.name });
    throw e;
  }
}

/** Convenience: Firestore-only token (used by Paddle webhook code) */
async function getFirestoreAccessToken(env) {
  return getGoogleAccessToken(env, "https://www.googleapis.com/auth/datastore");
}

function base64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlBuffer(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ═══════════════════════════════════════════════════════════════════
// Firestore REST Helpers
// ═══════════════════════════════════════════════════════════════════

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

async function firestoreGetUser(uid, accessToken) {
  const res = await fetch(`${FIRESTORE_BASE}/users/${uid}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET failed: ${res.status}`);
  return await res.json();
}

async function firestorePatchUser(uid, fields, accessToken) {
  const fieldPaths = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  const res = await fetch(`${FIRESTORE_BASE}/users/${uid}?${fieldPaths}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Firestore PATCH failed: ${res.status} ${err}`);
  }
  return await res.json();
}

async function firestoreIncrementPages(uid, pages, accessToken) {
  const existing       = await firestoreGetUser(uid, accessToken);
  const currentBalance = existing?.fields?.ocrPagesBalance?.integerValue ? parseInt(existing.fields.ocrPagesBalance.integerValue) : 0;
  const currentTotal   = existing?.fields?.ocrPagesTotal?.integerValue   ? parseInt(existing.fields.ocrPagesTotal.integerValue)   : 0;

  await firestorePatchUser(uid, {
    ocrPagesBalance:    { integerValue: String(currentBalance + pages) },
    ocrPagesTotal:      { integerValue: String(currentTotal + pages) },
    lastPurchase:       { stringValue: new Date().toISOString() },
    lastPurchaseSource: { stringValue: "paddle_webhook" },
    brevoLowBalanceNotified: { booleanValue: false }, // Reset low balance flag
  }, accessToken);
}

async function firestoreSetPro(uid, plan, accessToken) {
  const existing = await firestoreGetUser(uid, accessToken);
  const fields   = {
    plan:          { stringValue: "pro" },
    planSource:    { stringValue: "paddle" },
    planUpdatedAt: { stringValue: new Date().toISOString() },
  };
  const currentPlan = existing?.fields?.plan?.stringValue;
  if (currentPlan !== "pro") {
    fields.proSince = { stringValue: new Date().toISOString() };
  }
  await firestorePatchUser(uid, fields, accessToken);
}

async function firestoreRemovePro(uid, reason, accessToken) {
  await firestorePatchUser(uid, {
    plan:           { stringValue: "free" },
    planSource:     { stringValue: "paddle" },
    planUpdatedAt:  { stringValue: new Date().toISOString() },
    proEndedAt:     { stringValue: new Date().toISOString() },
    proEndedReason: { stringValue: reason },
  }, accessToken);
}

// ═══════════════════════════════════════════════════════════════════
// Web Chatbot — Bilingual (Arabic / English, auto-detect)
// ═══════════════════════════════════════════════════════════════════

const CHATBOT_SYSTEM_PROMPT = `
You are the official support assistant for Arabic OCR (arabic-ocr.com), an AI-powered platform for extracting Arabic text from images, handwriting, and PDFs.

LANGUAGE RULE — CRITICAL:
- DEFAULT LANGUAGE IS ARABIC. Always respond in Arabic unless the user writes to you in English.
- If the user writes in English → respond ENTIRELY in English.
- If the user writes in Arabic or any other language → respond ENTIRELY in Arabic.
- Never mix languages in a single response.

PRODUCTS & PRICING:
- 100 Pages Pack: $4.99 one-time — 100 OCR scans, pages never expire
- Pro Monthly: $9.99/month — unlimited scans, cancel anytime
- Pro Yearly: $49.99/year — unlimited scans, saves ~58% vs monthly (best value)
- Pages are shared across ALL platforms (Web, iOS, Android, Windows, Mac)
- Discount code GS7ROCLMYB gives 10% off any plan on any platform
- Free demo: 1 scan/day on the website (no account needed)
- All apps are free to download; paid plans unlock unlimited access

OCR FEATURES:
- Printed Arabic text extraction from images, scanned documents, and PDFs
- Arabic handwriting recognition — wide range of styles from student notes to manuscripts
- Mixed Arabic-English document support
- Lightning-fast results using Google Cloud Vision AI (web/Android)
- On-device AI (iOS/macOS/Windows): OCR runs fully offline, files never uploaded, 100% private
- Supports JPEG, PNG images and multi-page PDF files
- Camera capture: scan paper documents directly with your phone camera

AI FEATURES:
- AI Summarize: instantly generate a summary of any scanned Arabic text
- AI Translate: translate extracted text to any language
- Reformat OCR Results: auto-cleans and organizes extracted text (fixes OCR errors, structure, spacing)

PDF STUDIO FEATURES (web-based, no install):
- Edit PDFs: modify, annotate, and manage PDF content
- Merge PDFs: combine multiple PDF files into one
- Page tools: rotate, delete, or reorder individual pages
- Batch OCR: extract text from all pages of a multi-page PDF in one click
- Access PDF Studio at: arabic-ocr.com/pdf-studio.html

EXPORT OPTIONS:
- Copy extracted text to clipboard
- Save extracted text as a Word (.doc) file
- Export and share from the app

DOCUMENT ORGANIZATION:
- Organize scanned documents into folders inside the app
- View history of all previous scans

PRIVACY & SECURITY:
- iOS, macOS, Windows apps: fully on-device processing, nothing uploaded
- Web Portal: HTTPS only, documents are NOT stored on servers
- No data sharing with third parties

PLATFORMS:
- Web Portal: arabic-ocr.com/portal.html — no download, works in any browser
- iOS: App Store — search "Arabic OCR" (App ID: 6745792738)
- Android: Google Play — search "Arabic OCR" (package: com.kanzati.arabicocr)
- Windows: Microsoft Store — search "Arabic OCR" (ID: 9P2NRS4S8ND6)
- Mac: App Store — search "Arabic OCR"

iOS & Mac EXCLUSIVE (v3.7+):
- Powered by Apple on-device LLM Vision technology
- Fully offline OCR — no internet needed, lightning fast
- iOS Vision feature: point camera at any Arabic text for instant live translation without scanning first

WINDOWS EXCLUSIVE:
- Runs a local on-device model — documents processed entirely offline
- 100% private: files never leave your PC

WHO IT'S FOR:
- Students, researchers, professionals, journalists
- Anyone working with Arabic printed or handwritten documents

HOW PAGES WORK:
- Each OCR scan uses 1 page credit
- Pages never expire — buy once, use anytime
- Balance syncs automatically across all devices and platforms
- Top up anytime by purchasing another pack

COMMON QUESTIONS:
Q: Do pages expire? A: No, page credits never expire.
Q: Can I use my pages on multiple devices? A: Yes, one balance syncs automatically across all platforms.
Q: What languages can it translate to? A: Any language — powered by AI.
Q: Is there a free trial? A: Yes — new users get 10 free scans during a 3-day trial. The website also offers 1 free scan/day with no account.
Q: How accurate is the OCR? A: Very high for printed Arabic. Handwriting accuracy depends on clarity and style.
Q: Can I cancel my subscription? A: Yes, anytime from arabic-ocr.com/subscription.html
Q: Is there a discount? A: Yes! Use code GS7ROCLMYB for 10% off any plan on any platform.
Q: Does iOS have a live camera feature? A: Yes, the Vision feature translates Arabic text live from your camera.
Q: Does it work offline? A: Yes — iOS, macOS, and Windows apps process everything on-device with no internet.
Q: Can I organize my scanned documents? A: Yes, organize documents into folders in the app.
Q: What file formats are supported? A: JPEG, PNG, and multi-page PDFs.
Q: Can I export the text? A: Yes — copy to clipboard or save as a Word document.
Q: What is PDF Studio? A: A web-based tool to edit, merge, rotate, and batch-OCR Arabic PDFs.

CONTACT:
- For issues not covered here: arabic-ocr.com/contact.html

BEHAVIOR RULES:
- Be friendly, concise, and helpful
- Keep answers short — 2-4 sentences max unless the user asks for detail
- Never invent features, prices, or policies not listed above
- If unsure, say "I'm not sure about that — please contact us at arabic-ocr.com/contact.html"
- Do not discuss competitors
`.trim();

async function handleWebChat(req, env, headers) {
  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
  }

  const message = (body.message || "").trim();
  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers });
  }

  // Build message history (max last 10 turns to stay within token limits)
  const history = (body.history || []).slice(-10).map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || ""),
  }));

  const messages = [
    { role: "system", content: CHATBOT_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: message },
  ];

  try {
    const reply = await geminiChat(messages, 400, env.GEMINI_API_KEY);
    return new Response(JSON.stringify({ reply }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Chat failed: ${e.message}` }), { status: 500, headers });
  }
}


// ═══════════════════════════════════════════════════════════════════
// Paddle: Create Discount Code (admin-only)
// ═══════════════════════════════════════════════════════════════════

async function handleCreateDiscount(req, env, headers) {
  // Protect with a token stored in env.ADMIN_TOKEN
  const adminToken = req.headers.get("X-Admin-Token");
  if (!adminToken || !env.ADMIN_TOKEN || adminToken !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
  }

  const code    = (body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const percent = parseInt(body.percent ?? 0, 10);
  const maxUses = Math.max(1, parseInt(body.max_uses ?? 100, 10));
  const expires = body.expires_at ?? null; // ISO 8601 UTC e.g. "2026-12-31T23:59:59Z"

  if (!code)           return new Response(JSON.stringify({ error: '"code" is required' }), { status: 400, headers });
  if (percent < 1 || percent > 99)
                       return new Response(JSON.stringify({ error: '"percent" must be 1–99' }), { status: 400, headers });
  if (expires && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(expires))
                       return new Response(JSON.stringify({ error: '"expires_at" must be ISO 8601 UTC' }), { status: 400, headers });

  const payload = {
    description: code,
    type: "percentage",
    amount: String(percent),
    code,
    usage_limit: maxUses,
  };
  // maximum_recurring_intervals only applies to subscription (recurring) discounts
  if (body.recurring_intervals != null) {
    payload.maximum_recurring_intervals = parseInt(body.recurring_intervals, 10);
  }
  if (expires) payload.expires_at = expires;

  const res = await fetch("https://api.paddle.com/discounts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PADDLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), { status: res.status, headers });
}

// ═══════════════════════════════════════════════════════════════════
// Paddle: Suggest Upgrade (repeat page-pack buyer → subscription)
// ═══════════════════════════════════════════════════════════════════

const PAGE_PACK_PRICE_IDS = new Set([
  "pri_01kzkf3facgaxhht2t856vts11", // 100 pages
  "pri_01kxqmfvpbe73srtt97bvsafer", // 1,000 pages
]);

const PRO_PRICE_IDS = new Set([
  "pri_01kg5bx13n3m7ts4e47fz7xm62", // monthly legacy
  "pri_01m1kg1q6x5tvajs5xap2ms0xe", // monthly current
  "pri_01kg5by6qyxm19wb79rhrjmgt8", // yearly
]);

async function handleSuggestUpgrade(req, env, headers) {
  if (!env.PADDLE_API_KEY) {
    return new Response(JSON.stringify({ error: "PADDLE_API_KEY not configured" }), { status: 500, headers });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
  }

  const email = (body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "email is required" }), { status: 400, headers });
  }

  // 1. Find customer by email
  const customerRes = await paddleGet(`/customers?search=${encodeURIComponent(email)}`, env.PADDLE_API_KEY);
  if (!customerRes?.data?.length) {
    return new Response(JSON.stringify({ suggest: false, reason: "no_customer" }), { status: 200, headers });
  }
  const customerId = customerRes.data[0].id;

  // 2. Already a pro subscriber? → no upsell needed
  const subRes = await paddleGet(`/subscriptions?customer_id=${customerId}&status=active`, env.PADDLE_API_KEY);
  for (const sub of subRes?.data ?? []) {
    for (const item of sub.items ?? []) {
      if (PRO_PRICE_IDS.has(item.price?.id)) {
        return new Response(JSON.stringify({ suggest: false, reason: "already_pro" }), { status: 200, headers });
      }
    }
  }

  // 3. Count distinct page-pack transactions
  const txnRes = await paddleGet(
    `/transactions?customer_id=${customerId}&status=completed&per_page=50&order_by=created_at[DESC]`,
    env.PADDLE_API_KEY
  );

  let packCount  = 0;
  let totalSpent = 0; // in minor units (cents)
  for (const txn of txnRes?.data ?? []) {
    for (const item of txn.items ?? []) {
      if (PAGE_PACK_PRICE_IDS.has(item.price?.id)) {
        packCount++;
        totalSpent += parseInt(txn.details?.totals?.total ?? "0", 10);
        break; // one pack per transaction
      }
    }
  }

  if (packCount < 2) {
    return new Response(
      JSON.stringify({ suggest: false, reason: "not_enough_purchases", pack_count: packCount }),
      { status: 200, headers }
    );
  }

  const totalUSD        = totalSpent / 100;
  const suggestedPlan   = totalUSD >= 30 ? "yearly" : "monthly";
  const suggestedPriceId = suggestedPlan === "yearly"
    ? "pri_01kg5by6qyxm19wb79rhrjmgt8"
    : "pri_01m1kg1q6x5tvajs5xap2ms0xe";

  return new Response(JSON.stringify({
    suggest: true,
    pack_count: packCount,
    total_spent_usd: totalUSD.toFixed(2),
    suggested_plan: suggestedPlan,
    suggested_price_id: suggestedPriceId,
    message: `You've bought ${packCount} page packs ($${totalUSD.toFixed(2)} total). A Pro subscription gives unlimited scans for less.`,
  }), { status: 200, headers });
}

// ── Paddle REST helper ───────────────────────────────────────────

async function paddleGet(endpoint, apiKey) {
  const res = await fetch(`https://api.paddle.com${endpoint}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    console.error(`Paddle GET ${endpoint} failed: ${res.status}`);
    return null;
  }
  return await res.json();
}

// ═══════════════════════════════════════════════════════════════════
// Google Cloud Vision OCR
// ═══════════════════════════════════════════════════════════════════

async function ocrWithGCV(base64, apiKey) {
  try {
    const upstream = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [
            { type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 },
            { type: "LOGO_DETECTION", maxResults: 10 },
          ],
        }],
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) return { error: "GCV error", detail: data };
    const text = data?.responses?.[0]?.fullTextAnnotation?.text ?? "";
    return { text };
  } catch (e) {
    return { error: `GCV exception: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Gemini LLM
// ═══════════════════════════════════════════════════════════════════

// Convert OpenAI-style messages to Gemini contents + systemInstruction
function openaiToGemini(messages) {
  let systemInstruction;
  const contents = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction = { parts: [{ text: String(msg.content || "") }] };
      continue;
    }
    const role = msg.role === "assistant" ? "model" : "user";
    const text = typeof msg.content === "string"
      ? msg.content
      : (msg.content || []).map(p => p.text || "").join("");
    // Gemini requires alternating turns — merge consecutive same-role messages
    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += "\n" + text;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }
  return { systemInstruction, contents };
}

// Core Gemini call — returns plain text or throws
async function geminiChat(messages, maxTokens, apiKey) {
  const { systemInstruction, contents } = openaiToGemini(messages);
  const reqBody = {
    contents,
    generationConfig: { temperature: 1, maxOutputTokens: maxTokens },
  };
  if (systemInstruction) reqBody.systemInstruction = systemInstruction;

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reqBody) }
  );
  const data = await upstream.json();
  if (!upstream.ok) {
    const detail = data?.error?.message || JSON.stringify(data);
    throw new Error(`Gemini: ${detail}`);
  }
  return (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").replace(/\*\*/g, "");
}

// Wrapper called by the root catch-all handler (keeps same signature & response format)
async function callGroq(messages, generationConfig, apiKey, responseFormat, headers) {
  try {
    const text = await geminiChat(messages, 8192, apiKey);
    if (responseFormat === "gemini") {
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text }], role: "model" } }],
      }), { status: 200, headers });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: text, role: "assistant" } }],
    }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function extractImageFromMessages(messages) {
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "image_url" && block.image_url?.url) {
          return block.image_url.url;
        }
      }
    }
  }
  return null;
}

function contentsToMessages(contents) {
  return contents.map((c) => ({
    role: c.role === "model" ? "assistant" : "user",
    content: (c.parts || []).map((p) => p.text || "").join(""),
  }));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Token, Authorization",
    "Content-Type": "application/json",
  };
}
