/**
 * slideshow-server.js
 * Dedicated entry point for TourXel Screen Guides Slideshow Harness.
 */

// If no port specified, default to 3300
if (!process.env.PORT && !process.argv.some(a => a.startsWith('--port='))) {
  process.env.PORT = '3300';
}

console.log('================================================================');
console.log('🚀 Launching TourXel Screen Guides Slideshow Harness...');
console.log('================================================================');

require('./server.js');
