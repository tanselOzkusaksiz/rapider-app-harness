const fs = require('fs');
const path = require('path');

function getEnvConfig() {
  const envPath = path.join(__dirname, '../.env');
  const config = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        config[match[1].trim()] = match[2].trim().replace(/^['"](.*)['"]$/, '$1');
      }
    });
  }
  return config;
}

module.exports = { getEnvConfig };
