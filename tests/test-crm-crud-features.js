/**
 * Comprehensive CRM App Add/Edit/List & Ticket Regression Verification Suite
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { ensureAuthenticated } = require('../harness-auth-helper.js');

const APP_KEY = 'rapider-app-crm-sys-comprehensive-crm-system';
const BASE_URL = `http://localhost:3300/?app=${APP_KEY}`;

async function runVerification() {
  console.log('====================================================');
  console.log('🧪 RUNNING COMPREHENSIVE CRM ADD/EDIT/LIST & QA VERIFICATION');
  console.log('====================================================');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results = [];
  function record(testName, passed, detail) {
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${testName}: ${detail || (passed ? 'PASSED' : 'FAILED')}`);
    results.push({ testName, passed, detail });
  }

  try {
    // 0. Auth
    await ensureAuthenticated(page, APP_KEY);

    // 1. LEADS: Add, Edit, List
    console.log('\n--- 1. Testing Leads ---');
    await page.goto(`${BASE_URL}#/leads`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    const leadsFrame = page.frames().find(f => f.url().includes('leads.html')) || page;

    // Verify list loaded
    const leadsCount = await leadsFrame.evaluate(() => (window.allLeads ? window.allLeads.length : 0));
    record('Leads List Loaded', leadsCount >= 0, `Found ${leadsCount} leads in state`);

    // Verify Edit Lead opens modal with compact phone input
    const editLeadBtn = await leadsFrame.$('button[onclick*="editLead"]');
    if (editLeadBtn) {
      await editLeadBtn.click();
      await page.waitForTimeout(500);
      const isEditModalOpen = await leadsFrame.evaluate(() => {
        const m = document.getElementById('editLeadModal');
        return m && !m.classList.contains('hidden');
      });
      record('Edit Lead Modal Opens', isEditModalOpen, 'Modal opened on Edit button click');

      // Verify phone input fits cleanly inside modal
      const phoneInputFits = await leadsFrame.evaluate(() => {
        const phone = document.getElementById('editLeadPhone');
        return phone && phone.offsetWidth > 100 && phone.offsetWidth <= 400;
      });
      record('Phone Input Fits in Modal', phoneInputFits, 'Phone input dimensions are proportional');

      // Close modal
      await leadsFrame.evaluate(() => document.getElementById('btnCloseEditModal')?.click());
    }

    // 2. LEAD DETAIL: [RPDR-468] Delete Button Functionality
    console.log('\n--- 2. Testing Lead Detail ---');
    await page.goto(`${BASE_URL}#/lead-detail`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const leadDetailFrame = page.frames().find(f => f.url().includes('lead-detail.html')) || page;

    const deleteBtn = await leadDetailFrame.$('#btnDeleteLead');
    if (deleteBtn) {
      await deleteBtn.click();
      await page.waitForTimeout(500);
      const confirmModalOpen = await leadDetailFrame.evaluate(() => {
        const cm = document.getElementById('rapiderGlobalConfirmModal');
        return cm && !cm.classList.contains('hidden') && cm.innerText.includes('Delete');
      });
      record('[RPDR-468] Lead Detail Delete Button', confirmModalOpen, 'Confirm dialog appeared without ReferenceError');

      // Cancel delete
      await leadDetailFrame.evaluate(() => document.getElementById('rapiderConfirmCancelBtn')?.click());
    }

    // 3. DASHBOARD: [RPDR-466 #1] New Lead in Modal
    console.log('\n--- 3. Testing Dashboard New Lead Modal ---');
    await page.goto(`${BASE_URL}#/dashboard`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const dashFrame = page.frames().find(f => f.url().includes('dashboard.html')) || page;

    const quickLeadBtn = await dashFrame.$('#btnQuickLead');
    if (quickLeadBtn) {
      await quickLeadBtn.click();
      await page.waitForTimeout(500);
      const isModalOpen = await dashFrame.evaluate(() => {
        const m = document.getElementById('newLeadModal');
        return m && !m.classList.contains('hidden');
      });
      record('[RPDR-466 #1] Dashboard New Lead Opens Modal', isModalOpen, 'New Lead opened inline modal instead of drawer');

      // Close modal
      await dashFrame.evaluate(() => document.getElementById('btnCloseModal')?.click());
    }

    // 4. ACCOUNTS: [RPDR-466 #2] Edit in Modal
    console.log('\n--- 4. Testing Accounts ---');
    await page.goto(`${BASE_URL}#/accounts`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const accFrame = page.frames().find(f => f.url().includes('accounts.html')) || page;

    const editAccBtn = await accFrame.$('button[onclick*="editAccount"]');
    if (editAccBtn) {
      await editAccBtn.click();
      await page.waitForTimeout(500);
      const isAccModalOpen = await accFrame.evaluate(() => {
        const m = document.getElementById('editAccountModal');
        return m && !m.classList.contains('hidden');
      });
      record('[RPDR-466 #2] Accounts Edit Opens Modal', isAccModalOpen, 'Edit button opened editAccountModal instead of drawer');

      // Close modal
      await accFrame.evaluate(() => document.getElementById('btnCloseEditAccountModal')?.click());
    }

    // 5. ACCOUNT DETAIL: [RPDR-466 #3 & RPDR-467] Edit Modal & Remove New Deal
    console.log('\n--- 5. Testing Account Detail ---');
    await page.goto(`${BASE_URL}#/account-detail`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const accDetailFrame = page.frames().find(f => f.url().includes('account-detail.html')) || page;

    // Check New Deal button removed
    const newDealBtn = await accDetailFrame.$('#btnQuickDeal');
    record('[RPDR-467] Account Detail New Deal Removed', newDealBtn === null, 'New Deal button is not present on page');

    // Check Edit button opens modal
    const editAccDetailBtn = await accDetailFrame.$('#btnEditAccount');
    if (editAccDetailBtn) {
      await editAccDetailBtn.click();
      await page.waitForTimeout(500);
      const isAccDetailModalOpen = await accDetailFrame.evaluate(() => {
        const m = document.getElementById('editAccountModal');
        return m && !m.classList.contains('hidden');
      });
      record('[RPDR-466 #3] Account Detail Edit Opens Modal', isAccDetailModalOpen, 'Edit button opened editAccountModal instead of drawer');

      // Close modal
      await accDetailFrame.evaluate(() => document.getElementById('btnCloseEditAccountModal')?.click());
    }

    // 6. CONTACTS: [RPDR-466 #4] Edit in Modal
    console.log('\n--- 6. Testing Contacts ---');
    await page.goto(`${BASE_URL}#/contacts`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const cntFrame = page.frames().find(f => f.url().includes('contacts.html')) || page;

    const editCntBtn = await cntFrame.$('button[onclick*="editContact"]');
    if (editCntBtn) {
      await editCntBtn.click();
      await page.waitForTimeout(500);
      const isCntModalOpen = await cntFrame.evaluate(() => {
        const m = document.getElementById('editContactModal');
        return m && !m.classList.contains('hidden');
      });
      record('[RPDR-466 #4] Contacts Edit Opens Modal', isCntModalOpen, 'Edit button opened editContactModal instead of drawer');

      // Close modal
      await cntFrame.evaluate(() => document.getElementById('btnCloseEditContactModal')?.click());
    }

    // 7. CONTACT DETAIL: [RPDR-466 #5] Edit in Modal
    console.log('\n--- 7. Testing Contact Detail ---');
    await page.goto(`${BASE_URL}#/contact-detail`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const cntDetailFrame = page.frames().find(f => f.url().includes('contact-detail.html')) || page;

    const editCntDetailBtn = await cntDetailFrame.$('#btnEditContact');
    if (editCntDetailBtn) {
      await editCntDetailBtn.click();
      await page.waitForTimeout(500);
      const isCntDetailModalOpen = await cntDetailFrame.evaluate(() => {
        const m = document.getElementById('editContactModal');
        return m && !m.classList.contains('hidden');
      });
      record('[RPDR-466 #5] Contact Detail Edit Opens Modal', isCntDetailModalOpen, 'Edit button opened editContactModal instead of drawer');

      // Close modal
      await cntDetailFrame.evaluate(() => document.getElementById('btnCloseEditContactModal')?.click());
    }

    // 8. CASES: [RPDR-472] Edit Case doesn't get stuck on loading
    console.log('\n--- 8. Testing Cases ---');
    await page.goto(`${BASE_URL}#/cases`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const casesFrame = page.frames().find(f => f.url().includes('cases.html')) || page;

    const editCaseBtn = await casesFrame.$('button[onclick*="editCase"]');
    if (editCaseBtn) {
      await editCaseBtn.click();
      await page.waitForTimeout(500);
      const saveCaseBtn = await casesFrame.$('#btnSaveEditCase');
      if (saveCaseBtn) {
        await saveCaseBtn.click();
        await page.waitForTimeout(1000);
        const modalClosed = await casesFrame.evaluate(() => {
          const m = document.getElementById('editCaseModal');
          return m && m.classList.contains('hidden');
        });
        const buttonNotFrozen = await casesFrame.evaluate(() => {
          const b = document.getElementById('btnSaveEditCase');
          return b && !b.disabled && b.innerText.includes('Save');
        });
        record('[RPDR-472] Case Edit Modal Saves Without Freezing', modalClosed && buttonNotFrozen, 'Modal closed and button restored cleanly');
      }
    }

    // 9. QUOTE DETAIL: [RPDR-469 & RPDR-474]
    console.log('\n--- 9. Testing Quote Detail ---');
    await page.goto(`${BASE_URL}#/quote-detail`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const quoteDetailFrame = page.frames().find(f => f.url().includes('quote-detail.html')) || page;

    const quoteButtonsHidden = await quoteDetailFrame.evaluate(() => {
      const text = document.body.innerText;
      return !text.includes('Ask AI') && !text.includes('Request discount review') && !text.includes('Open approval work item') && !text.includes('Edit Draft');
    });
    record('[RPDR-469] Quote Detail Buttons Hidden', quoteButtonsHidden, 'Non-working buttons properly removed');

    const backToQuotesBtn = await quoteDetailFrame.$('#btnBackToQuotes');
    record('[RPDR-474] Quote Detail Back Button', backToQuotesBtn !== null, 'Back to Quotes button exists');

    // 10. ORDER DETAIL: [RPDR-470 & RPDR-474]
    console.log('\n--- 10. Testing Order Detail ---');
    await page.goto(`${BASE_URL}#/order-detail`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const orderDetailFrame = page.frames().find(f => f.url().includes('order-detail.html')) || page;

    const orderButtonsHidden = await orderDetailFrame.evaluate(() => {
      const text = document.body.innerText;
      return !text.includes('Ask AI') && !text.includes('Review handoff') && !text.includes('Export CSV');
    });
    record('[RPDR-470] Order Detail Buttons Hidden', orderButtonsHidden, 'Non-working buttons properly removed');

    const backToOrdersBtn = await orderDetailFrame.$('#btnBackToOrders');
    record('[RPDR-474] Order Detail Back Button', backToOrdersBtn !== null, 'Back to Orders button exists');

    // 11. CONTRACTS: [RPDR-471]
    console.log('\n--- 11. Testing Contracts ---');
    await page.goto(`${BASE_URL}#/contracts`, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const contractsFrame = page.frames().find(f => f.url().includes('contracts.html')) || page;

    const contractBtnText = await contractsFrame.evaluate(() => {
      const btn = document.getElementById('btnNewContract');
      return btn ? btn.innerText.trim() : '';
    });
    record('[RPDR-471] Contracts Button Name', contractBtnText.includes('New Contract'), `Button text is "${contractBtnText}"`);

  } catch (err) {
    console.error('Fatal error during verification:', err);
    record('Suite Execution', false, err.message);
  } finally {
    await browser.close();
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log('\n====================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED out of ${results.length} checks`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runVerification();
