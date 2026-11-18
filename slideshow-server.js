/**
 * slideshow-server.js
 * Dedicated entry point for TourXel Screen Guides Slideshow Harness.
 */

// If no port specified, default to 3300
if (!process.env.PORT && !process.argv.some(a => a.startsWith('--port='))) {
  process.env.PORT = '3300';
}

// Default to TourXel repository if neither --app= nor --manifest= was provided
const hasManifestFlag =
  Boolean(process.env.SCREEN_GUIDE_MANIFEST) ||
  process.argv.some(a => a.startsWith('--manifest='));
if (!hasManifestFlag && !process.env.SCREEN_GUIDE_APP_DIR && !process.argv.some(a => a.startsWith('--app='))) {
  process.argv.push('--app=../rapider-apps/APPS/TourXel');
}

console.log('================================================================');
console.log('🚀 Launching TourXel Screen Guides Slideshow Harness...');
console.log('================================================================');

require('./server.js');
