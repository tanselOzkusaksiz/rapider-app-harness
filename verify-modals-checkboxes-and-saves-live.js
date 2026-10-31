const { chromium } = require('playwright');

const TARGETS = [
  { app: 'rapider-app-re-a-rapider-employees', route: 'profile', openModal: '#btn-add-emergency-contact', dialog: '#modal-emergency-contact' },
  { app: 'rapider-app-hra-a-rapider-hr-attendance', route: 'overview', openModal: '[data-modal-open]', dialog: 'dialog' },
  { app: 'rapider-app-hrp-a-rapider-hr-payroll', route: 'payslips', openModal: '[data-modal-open]', dialog: 'dialog' },
  { app: 'rapider-app-hrr-a-rapider-hr-recruiting', route: 'overview', openModal: '[data-modal-open]', dialog: 'dialog' },
  { app: 'rapider-app-hrs-a-hr-services', route: 'overview', openModal: '[data-modal-open]', dialog: 'dialog' },
  { app: 'rapider-app-hrto-a1-hr-time-off', route: 'ledger', openModal: '[data-modal-open]', dialog: 'dialog' },
  { app: 'rapider-app-bom-rapider-bom-management', route: 'overview', openModal: '[data-action="confirm"]', dialog: 'dialog#confirm' },
  { app: 'rapider-app-ecommerce-rapider-ecommerce', route: 'overview', openModal: '[data-action="confirm"]', dialog: 'dialog#confirm' },
  { app: 'rapider-app-personal-wellness-rapider-personal-wellness', route: 'home', openModal: '[data-modal-open]', dialog: 'dialog' },
  { app: 'rapider-app-workspace-rapider-project-workspace', route: 'customer', openModal: '[data-open-dialog]', dialog: 'dialog' },
  { app: 'rapider-app-scp-a-support-and-customer-portal', route: 'agent-workspace', openModal: '[data-modal-open]', dialog: 'dialog' }
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();

  let httpErrors = 0;
  let consoleErrors = 0;

  page.on('response', (res) => {
    if (res.url().includes('/api/proxy/') && res.status() >= 400) {
      console.error(`[HTTP ${res.status()}] ${res.request().method()} ${res.url()}`);
      httpErrors++;
    }
  });
  page.on('pageerror', (err) => {
    console.error(`[PageError] ${err.message}`);
    consoleErrors++;
  });

  for (const t of TARGETS) {
    const url = `http://localhost:3300/?app=${encodeURIComponent(t.app)}&route=${encodeURIComponent(t.route)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#sandbox-iframe', { timeout: 10000 });
    await page.waitForTimeout(1500);

    const iframeHandle = await page.$('#sandbox-iframe');
    const frame = iframeHandle ? await iframeHandle.contentFrame() : null;
    if (!frame) {
      console.error(`No app frame for ${t.app}/${t.route}`);
      continue;
    }

    const checkResult = await frame.evaluate(({ openModal, dialogSel }) => {
      const btn = document.querySelector(openModal);
      if (btn) btn.click();
      else {
        const d = document.querySelector(dialogSel);
        if (d && typeof d.showModal === 'function' && !d.open) d.showModal();
      }
      const dlg = document.querySelector('dialog[open]') || document.querySelector(dialogSel);
      let centered = true;
      let dialogCenterOffset = 0;
      if (dlg && dlg.open) {
        const rect = dlg.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        dialogCenterOffset = Math.abs(cx - window.innerWidth / 2);
        centered = dialogCenterOffset <= 4;
      }
      const cb = document.querySelector('.field input[type="checkbox"]');
      let cbSize = null;
      if (cb) {
        const r = cb.getBoundingClientRect();
        cbSize = { w: Math.round(r.width), h: Math.round(r.height) };
      }
      return {
        dialogOpen: Boolean(dlg && dlg.open),
        centered,
        dialogCenterOffset: Math.round(dialogCenterOffset),
        cbSize
      };
    }, { openModal: t.openModal, dialogSel: t.dialog });

    console.log(`✅ ${t.app} / ${t.route} ->`, JSON.stringify(checkResult));
  }

  await browser.close();
  console.log(`Summary: httpErrors=${httpErrors}, consoleErrors=${consoleErrors}`);
  process.exit(httpErrors > 0 || consoleErrors > 0 ? 1 : 0);
})();
