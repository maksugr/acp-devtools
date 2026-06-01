#!/usr/bin/env node
// Records a tour of the ACP Devtools inspector using Playwright.
// Output: assets/demo.webm (native resolution, raw recording).
//
// Prereqs:
//   - dev:ui running on http://127.0.0.1:5173 with ACP_DEVTOOLS_HOME pointing
//     at a seeded captures.db (see fixtures/seed.mjs).
//   - npm i -D playwright + npx playwright install chromium.

import { chromium } from 'playwright';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const assetsDir = join(repoRoot, 'assets');
const videoDir = join(assetsDir, '.tmp-video');
const outPath = join(assetsDir, 'demo.webm');

mkdirSync(videoDir, { recursive: true });

const VIEWPORT = { width: 1280, height: 800 };

// Smooth mouse glide so the cursor doesn't teleport between clicks.
async function glide(page, x, y, steps = 18) {
    await page.mouse.move(x, y, { steps });
}

// Move-then-click with a brief settle pause.
async function click(page, locator, settleMs = 350) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('locator has no bounding box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await glide(page, cx, cy);
    await page.waitForTimeout(120);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(settleMs);
}

async function pause(page, ms) {
    await page.waitForTimeout(ms);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    recordVideo: { dir: videoDir, size: VIEWPORT },
});
const page = await context.newPage();

try {
    await page.goto('http://127.0.0.1:5173/');
    await pause(page, 1200); // intro frame

    // -------- 1. open Picker, switch to a session --------
    const pickerTrigger = page.getByTitle('Select a live capture or saved session');
    await click(page, pickerTrigger, 500);

    // pick the streaming-heavy session — gives us a busy timeline with STR clusters.
    const streamingItem = page.getByRole('button', { name: /streaming-heavy/i }).first();
    await click(page, streamingItem, 1100);

    // -------- 2. click a row, cycle tabs --------
    // Click somewhere in the timeline content area. The first MessageRow sits
    // near the top of the left split. Coordinates: x ~250 (left half), y ~210.
    await glide(page, 250, 210);
    await pause(page, 200);
    await page.mouse.down();
    await page.mouse.up();
    await pause(page, 900);

    // Cycle detail tabs : Raw → Meta → Spec → Tree.
    for (const label of ['Raw', 'Meta', 'Spec', 'Tree']) {
        const tab = page.getByRole('button', { name: label, exact: true }).first();
        if (await tab.count()) {
            await click(page, tab, 650);
        }
    }

    // -------- 3. open ⋯ actions menu (don't actually export) --------
    const actions = page.getByLabel('session actions');
    await click(page, actions, 800);
    // close by pressing Escape
    await page.keyboard.press('Escape');
    await pause(page, 500);

    // -------- 4. Info drawer --------
    const infoBtn = page.getByLabel('Open session info panel');
    await click(page, infoBtn, 1400);
    await glide(page, 1100, 500); // hover content
    await pause(page, 800);
    await page.keyboard.press('Escape');
    await pause(page, 500);

    // -------- 5. Perf dashboard --------
    const perfBtn = page.getByLabel('Open performance dashboard');
    await click(page, perfBtn, 1500);

    // Pan the waterfall canvas (bottom section) — drag from one point to another.
    await glide(page, 900, 650);
    await pause(page, 300);
    await page.mouse.down();
    await glide(page, 500, 650, 28);
    await page.mouse.up();
    await pause(page, 700);

    // Zoom in (cmd+wheel emulated through the button).
    const zoomIn = page.getByLabel('Zoom in');
    if (await zoomIn.count()) {
        await click(page, zoomIn, 500);
        await click(page, zoomIn, 700);
    }

    await page.keyboard.press('Escape');
    await pause(page, 500);

    // -------- 6. Diff panel --------
    const diffBtn = page.getByLabel('Open session diff');
    await click(page, diffBtn, 1100);

    // Pick a comparison session
    const compDropdown = page.getByLabel('Comparison session');
    await click(page, compDropdown, 600);
    const compChoice = page.getByRole('button', { name: /fat-session/i }).first();
    await click(page, compChoice, 1600);

    await page.keyboard.press('Escape');
    await pause(page, 500);

    // -------- 7. Theme toggle (switch to dark) --------
    const themeTrigger = page.locator('button[title^="theme"]').first();
    await click(page, themeTrigger, 500);
    const darkOpt = page.locator('[role="menuitemradio"][title*="dark"]').first();
    await click(page, darkOpt, 1200);

    // outro
    await glide(page, VIEWPORT.width - 50, VIEWPORT.height - 30);
    await pause(page, 600);
} finally {
    await context.close();
    await browser.close();

    // Playwright writes one webm per page to videoDir with a random name.
    // Move it to assets/demo.webm.
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
    if (files.length) {
        const src = join(videoDir, files[0]);
        renameSync(src, outPath);
        process.stdout.write(`wrote ${outPath}\n`);
    } else {
        process.stderr.write('no video file produced\n');
        process.exit(1);
    }
    rmSync(videoDir, { recursive: true, force: true });
}
