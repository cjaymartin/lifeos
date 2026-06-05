// ── Account registry — the five logins LifeOS depends on ────────────────────
//
// Hardcoded by design (per CJ). Adding a sixth account = add an entry here;
// the verify runner + UI pick it up from the `kind`.

import type { AccountId, AccountKind, LoginStep } from './settings-types';

export interface AccountDef {
  id: AccountId;
  label: string;
  icon: string; // lucide icon name
  kind: AccountKind;
  description: string;
  repairUrl?: string;
  repairLabel?: string;

  // mcp-probe: spawned-claude verification
  probeTool?: string;
  probePrompt?: string;

  // browser-session: Playwright config
  /** page whose final URL/DOM tells us whether we're signed in */
  accountUrl?: string;
  /** substring of the URL we get redirected to when signed OUT */
  signedOutUrlMarker?: string;
  /** page-content markers that mean signed OUT even without a redirect
   *  (e.g. Amazon serves the account hub logged-out with "Hello, sign in") */
  signedOutTextMarkers?: string[];
  loginUrl?: string;
  loginFlow?: LoginStep[];
  /** text/selector markers that mean a bot-check or 2FA wall — escalate, never push through */
  challengeMarkers?: string[];
}

export const ACCOUNTS: AccountDef[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    icon: 'Mail',
    kind: 'mcp-probe',
    description: 'Delivery + purchase scanning via the claude.ai Gmail connector',
    repairUrl: 'https://claude.ai/settings/connectors',
    repairLabel: 'Reconnect on claude.ai',
    probeTool: 'mcp__claude_ai_Gmail__search_threads',
    probePrompt:
      'Verify Gmail MCP access: call mcp__claude_ai_Gmail__search_threads with query "in:inbox" requesting a single result. ' +
      'If the tool call succeeds (even with zero threads), reply with exactly PROBE_OK. ' +
      'If it errors, reply with PROBE_FAIL: followed by a one-line reason.',
  },
  {
    id: 'gcal',
    label: 'Google Calendar',
    icon: 'Calendar',
    kind: 'mcp-probe',
    description: 'Morning briefing events via the claude.ai Google Calendar connector',
    repairUrl: 'https://claude.ai/settings/connectors',
    repairLabel: 'Reconnect on claude.ai',
    probeTool: 'mcp__claude_ai_Google_Calendar__list_calendars',
    probePrompt:
      'Verify Google Calendar MCP access: call mcp__claude_ai_Google_Calendar__list_calendars. ' +
      'If the tool call succeeds, reply with exactly PROBE_OK. ' +
      'If it errors, reply with PROBE_FAIL: followed by a one-line reason.',
  },
  {
    id: 'todoist',
    label: 'Todoist',
    icon: 'ListChecks',
    kind: 'api-token',
    description: 'Task sync via the Todoist REST API token',
    repairUrl: 'https://app.todoist.com/app/settings/integrations/developer',
    repairLabel: 'Get a new API token',
  },
  {
    id: 'walmart',
    label: 'Walmart',
    icon: 'ShoppingCart',
    kind: 'browser-session',
    description: 'Grocery cart automation via a persistent Chrome session',
    accountUrl: 'https://www.walmart.com/account',
    signedOutUrlMarker: '/account/login',
    signedOutTextMarkers: ['Sign in or create account'],
    loginUrl: 'https://www.walmart.com/account/login',
    loginFlow: [
      { fill: 'input#loginId, input[name="loginId"], input[type="email"]', secret: 'username' },
      { click: 'button[type="submit"]' },
      { fill: 'input#password, input[type="password"]', secret: 'password' },
      { click: 'button[type="submit"]' },
    ],
    challengeMarkers: ['Robot or human', 'px-captcha', 'Verify your identity', 'one-time code'],
  },
  {
    id: 'amazon',
    label: 'Amazon',
    icon: 'Package',
    kind: 'browser-session',
    description: 'Cart + order automation via a persistent Chrome session',
    accountUrl: 'https://www.amazon.com/gp/css/homepage.html',
    signedOutUrlMarker: '/ap/signin',
    // Amazon serves the account hub even when signed out — the nav greeting is the tell
    signedOutTextMarkers: ['Hello, sign in'],
    loginUrl:
      'https://www.amazon.com/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.com%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.mode=checkid_setup&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0',
    loginFlow: [
      { fill: 'input#ap_email, input[name="email"]', secret: 'username' },
      { click: 'input#continue, #continue input[type="submit"]' },
      { fill: 'input#ap_password', secret: 'password' },
      { click: 'input#signInSubmit' },
    ],
    challengeMarkers: [
      '#auth-mfa-otpcode',
      '#auth-captcha-image',
      'Enter the characters you see',
      'Two-Step Verification',
      '#cvf-input-code',
    ],
  },
];

export function getAccount(id: string): AccountDef | undefined {
  return ACCOUNTS.find((a) => a.id === id);
}
