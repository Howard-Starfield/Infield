/**
 * Dashboard eBay OAuth UI: createElement + textContent only (V5 §7.2.1).
 * Consent URL and token exchange run in Rust; this module is DOM builders + data-ebay-action hooks.
 */
import type { EbayAccountRecord, OAuthCallbackResult, PreparedTokenExchangeView } from "./types";

export function oauthNoteSection(noteClass: string, heading: string, lines: string[]): HTMLElement {
  const div = document.createElement("div");
  div.className = noteClass;
  const strong = document.createElement("strong");
  strong.textContent = heading;
  div.appendChild(strong);
  for (const line of lines) {
    const p = document.createElement("p");
    p.textContent = line;
    div.appendChild(p);
  }
  return div;
}

export function buildOauthCallbackDetailCard(result: OAuthCallbackResult): HTMLElement {
  const card = document.createElement("div");
  card.className = "oauth-detail-card";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Latest callback";
  const h4 = document.createElement("h4");
  h4.textContent = result.accountLabel || result.accountId || "eBay account";
  const msg = document.createElement("p");
  msg.textContent = result.userMessage;
  card.append(eyebrow, h4, msg);
  return card;
}

export function buildOauthPreparedDetailCard(prepared: PreparedTokenExchangeView): HTMLElement {
  const card = document.createElement("div");
  card.className = "oauth-detail-card oauth-detail-card-ready";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Prepared exchange";
  const h4 = document.createElement("h4");
  h4.textContent = "Rust token exchange staged";
  const meta = document.createElement("div");
  meta.className = "meta-row";
  const s1 = document.createElement("span");
  s1.textContent = prepared.accountLabel || prepared.accountId;
  const s2 = document.createElement("span");
  s2.textContent = prepared.tokenExchangePreview.scope;
  meta.append(s1, s2);
  const p1 = document.createElement("p");
  p1.textContent = `Authorization code present: ${prepared.authorizationCodePresent ? "yes" : "no"}`;
  const p2 = document.createElement("p");
  p2.textContent = `Client secret present in Rust: ${
    prepared.tokenExchangePreview.hasClientSecret ? "yes" : "no"
  }`;
  card.append(eyebrow, h4, meta, p1, p2);
  return card;
}

export function buildOauthDashboardAccountCard(account: EbayAccountRecord): HTMLElement {
  const article = document.createElement("article");
  article.className = "oauth-account-card";
  const heading = document.createElement("div");
  heading.className = "section-heading";
  const titleBlock = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Encrypted account";
  const h4 = document.createElement("h4");
  h4.textContent = account.accountLabel || account.accountId;
  titleBlock.append(eyebrow, h4);
  const pill = document.createElement("span");
  pill.className = `oauth-pill ${
    account.authStatus === "connected"
      ? "oauth-pill-ready"
      : account.authStatus === "reauth_required"
        ? "oauth-pill-alert"
        : "oauth-pill-neutral"
  }`;
  pill.textContent = account.authStatus.replace(/_/g, " ");
  heading.append(titleBlock, pill);
  const meta = document.createElement("div");
  meta.className = "meta-row";
  const m1 = document.createElement("span");
  m1.textContent = `Scope: ${account.scope}`;
  const m2 = document.createElement("span");
  m2.textContent = `Access expiry: ${account.accessTokenExpiresAt || "Unknown"}`;
  const m3 = document.createElement("span");
  m3.textContent = `Refresh expiry: ${account.refreshTokenExpiresAt || "Unknown"}`;
  meta.append(m1, m2, m3);
  const blurb = document.createElement("p");
  blurb.textContent =
    account.lastError || "Credentials are stored in the encrypted vault and ready for API calls.";
  const actions = document.createElement("div");
  actions.className = "oauth-card-actions";
  const btn = document.createElement("button");
  btn.type = "button";
  const reauth = account.authStatus === "reauth_required";
  btn.className = `${reauth ? "primary-button" : "secondary-button"} oauth-card-action`;
  btn.dataset.ebayAction = reauth ? "reauth-account" : "refresh-account";
  btn.dataset.accountId = account.accountId;
  btn.dataset.accountLabel = account.accountLabel ?? "";
  btn.textContent = reauth ? "Reconnect account" : "Refresh token";
  actions.appendChild(btn);
  article.append(heading, meta, blurb, actions);
  return article;
}
