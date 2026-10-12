const { chromium } = require('playwright');

async function testContactAccountValidation() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('Navigating to CRM contacts page...');
  await page.goto('http://localhost:3300/?app=rapider-app-crm-sys-comprehensive-crm-system#/contacts', { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  const cntFrame = page.frames().find(f => f.url().includes('contacts.html')) || page;

  // Open Add Contact modal
  console.log('Opening Add New Contact modal...');
  const newBtn = await cntFrame.$('#btnNewContact');
  if (!newBtn) {
    console.error('Could not find #btnNewContact');
    process.exit(1);
  }
  await newBtn.click();
  await page.waitForTimeout(500);

  // Inspect the select options
  const selectInfo = await cntFrame.evaluate(() => {
    const sel = document.getElementById('cntAccountSelect');
    if (!sel) return null;
    const options = Array.from(sel.options).map(o => ({ value: o.value, text: o.text, disabled: o.disabled }));
    return {
      required: sel.hasAttribute('required'),
      options
    };
  });

  console.log('Select field properties:', JSON.stringify(selectInfo, null, 2));

  // Verify "None / Independent" does NOT exist
  const hasNoneOption = selectInfo.options.some(o => o.text.toLowerCase().includes('none') || o.text.toLowerCase().includes('independent'));
  if (hasNoneOption) {
    console.error('FAIL: Found None/Independent option in account select!');
    process.exit(1);
  } else {
    console.log('PASS: None/Independent option is absent.');
  }

  // Verify select is required
  if (!selectInfo.required) {
    console.error('FAIL: cntAccountSelect is missing required attribute!');
    process.exit(1);
  } else {
    console.log('PASS: cntAccountSelect has required attribute.');
  }

  // Verify default placeholder is disabled
  const firstOption = selectInfo.options[0];
  if (!firstOption || !firstOption.disabled) {
    console.error('FAIL: First placeholder option is not disabled!');
    process.exit(1);
  } else {
    console.log('PASS: First placeholder option is properly disabled.');
  }

  await browser.close();
  console.log('ALL CONTACT ACCOUNT VALIDATION CHECKS PASSED!');
}

testContactAccountValidation().catch(err => {
  console.error(err);
  process.exit(1);
});
