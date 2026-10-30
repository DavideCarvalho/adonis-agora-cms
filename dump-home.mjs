import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto('http://127.0.0.1:3333/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const data = await page.evaluate(() => {
  const pick = (el) => el ? getComputedStyle(el) : null;
  const body = pick(document.body);
  const h1 = document.querySelector('h1');
  const sections = Array.from(document.querySelectorAll('section, header, footer')).slice(0, 14).map((s) => ({
    tag: s.tagName,
    cls: (s.className || '').toString().slice(0, 60),
    text: s.innerText.replace(/\s+/g, ' ').slice(0, 300),
  }));
  return {
    bg: body.backgroundColor,
    color: body.color,
    font: body.fontFamily,
    h1font: h1 ? getComputedStyle(h1).fontFamily : null,
    h1size: h1 ? getComputedStyle(h1).fontSize : null,
    sections,
  };
});
console.log(JSON.stringify(data, null, 1).slice(0, 4000));
await browser.close();
