#!/usr/bin/env node
/**
 * Capture performance report HTML as a screenshot
 * Usage: node capture-report.js [html-file] [output-file]
 * Example: node capture-report.js results/test-20260102-155018.html results/test-20260102-155018.png
 */

const fs = require('fs');
const path = require('path');

async function captureReport() {
  // Get arguments
  const htmlFile = process.argv[2];
  const outputFile = process.argv[3];

  if (!htmlFile) {
    console.error('❌ Usage: node capture-report.js <html-file> [output-file]');
    console.error('Example: node capture-report.js results/test-20260102-155018.html');
    process.exit(1);
  }

  // Resolve paths
  const htmlPath = path.resolve(htmlFile);
  const outPath = outputFile 
    ? path.resolve(outputFile)
    : htmlPath.replace(/\.html$/, '.png');

  // Check if HTML file exists
  if (!fs.existsSync(htmlPath)) {
    console.error(`❌ HTML file not found: ${htmlPath}`);
    process.exit(1);
  }

  try {
    // Dynamically import puppeteer
    let puppeteer;
    try {
      puppeteer = await import('puppeteer');
    } catch (e) {
      console.error('❌ Puppeteer not installed. Install with:');
      console.error('   npm install puppeteer --save-dev');
      console.error('   Or: yarn add -D puppeteer');
      process.exit(1);
    }

    console.log(`📸 Capturing HTML report: ${htmlPath}`);
    
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Set viewport to capture full width
    await page.setViewport({
      width: 1400,
      height: 900,
      deviceScaleFactor: 2  // 2x for better quality
    });

    // Load HTML file
    await page.goto(`file://${htmlPath}`, {
      waitUntil: 'networkidle0'
    });

    // Get full page height
    const fullHeight = await page.evaluate(() => {
      return document.documentElement.scrollHeight;
    });

    // Screenshot full page
    await page.screenshot({
      path: outPath,
      fullPage: true,
      type: 'png'
    });

    await browser.close();

    const fileSize = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`✅ Screenshot saved: ${outPath} (${fileSize}KB)`);
    console.log(`   Dimensions: 1400x${fullHeight}px @ 2x scale`);

  } catch (error) {
    console.error('❌ Failed to capture report:', error.message);
    process.exit(1);
  }
}

captureReport();
