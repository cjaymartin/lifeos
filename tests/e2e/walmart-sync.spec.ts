import { test, expect } from '@playwright/test';

// End-to-end exercise of the on-demand Walmart channel (ADR 0001) against the
// REAL API routes — auth, the durable command queue, the long-poll, and the
// front-door routing/wait logic — with the browser extension SIMULATED over
// HTTP. No real walmart.com and no Playwright fallback are ever touched: every
// test keeps the "extension" present and answers fast, so the front door always
// takes the extension path. (The webServer caps the wait at 8s as a backstop.)
//
// The simulated extension is just the three HTTP moves the real background.js
// makes: GET /commands (long-poll, which also registers presence), then for
// each claimed command POST /result.

const COMMANDS = '/api/grocery/walmart/commands';
const COMMAND = '/api/grocery/walmart/command';
const RESULT = '/api/grocery/walmart/result';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test.describe('walmart on-demand channel (simulated extension)', () => {
  test('get-cart routes through a present extension and returns its cart', async ({ page }) => {
    const req = page.request;

    // 1) Extension opens its long-poll — the handler's first claimPending() marks
    //    the extension present before we hit the front door.
    const pollP = req.get(COMMANDS);
    await sleep(600); // let the poll register presence server-side

    // 2) User taps Sync → get-cart through the single front door.
    const frontP = req.post(COMMAND, { data: { op: 'get-cart' } });

    // 3) The poll returns the claimed command.
    const pollResp = await pollP;
    expect(pollResp.ok()).toBeTruthy();
    const cmd = (await pollResp.json()).commands.find((c: { op: string }) => c.op === 'get-cart');
    expect(cmd, 'extension should receive the get-cart command').toBeTruthy();

    // 4) Extension scrapes the cart in the user's tab and reports the result.
    const resultResp = await req.post(RESULT, {
      data: {
        id: cmd.id,
        ok: true,
        result: { cart: [{ productId: '43984343', product: 'fairlife 2% Milk, 52 fl oz' }] },
      },
    });
    expect(resultResp.ok()).toBeTruthy();

    // 5) The front door resolves with the extension's cart.
    const front = await frontP;
    expect(front.ok()).toBeTruthy();
    const body = await front.json();
    expect(body.ok).toBe(true);
    expect(body.executor).toBe('extension');
    expect(body.cart[0].productId).toBe('43984343');
  });

  test('add-item routes through the extension and echoes the updated cart', async ({ page }) => {
    const req = page.request;

    const pollP = req.get(COMMANDS);
    await sleep(600);
    const frontP = req.post(COMMAND, { data: { op: 'add-item', productId: '161115457', qty: 2 } });

    const cmd = (await (await pollP).json()).commands.find((c: { op: string }) => c.op === 'add-item');
    expect(cmd, 'extension should receive the add-item command').toBeTruthy();
    expect(cmd.params.productId).toBe('161115457');
    expect(cmd.params.qty).toBe(2);

    await req.post(RESULT, {
      data: { id: cmd.id, ok: true, result: { cart: [{ productId: '161115457', product: 'Fresh Blueberries' }] } },
    });

    const body = await (await frontP).json();
    expect(body.ok).toBe(true);
    expect(body.executor).toBe('extension');
    expect(body.cart.some((l: { productId: string }) => l.productId === '161115457')).toBe(true);
  });

  test('a mutating op whose extension times out returns ok:false and never double-executes', async ({ page }) => {
    const req = page.request;

    const pollP = req.get(COMMANDS);
    await sleep(600);
    // Front door will wait the capped window (8s) and get no result posted back.
    const frontP = req.post(COMMAND, { data: { op: 'add-item', productId: '999999' } });

    // Drain the poll so the command is claimed — but deliberately post NO result,
    // simulating an extension that died mid-add (outcome unknown).
    const cmd = (await (await pollP).json()).commands.find((c: { op: string }) => c.op === 'add-item');
    expect(cmd).toBeTruthy();

    const front = await frontP;
    const body = await front.json();
    // The front door must refuse rather than fall back to Playwright (which would
    // risk a duplicate add). ok:false with a 502.
    expect(front.status()).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/timed out/i);
  });
});
