const fs = require('fs');
const path = require('path');

const branding = process.env.TAURI_BRANDING || 'kinesis';
const configPath = path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json');
const stateFile = path.join(__dirname, '..', 'scripts', '.branding-state');

console.log(`Setting icons for branding: ${branding}`);

// Read current branding state
let lastBranding = null;
try {
  if (fs.existsSync(stateFile)) {
    lastBranding = fs.readFileSync(stateFile, 'utf-8').trim();
  }
} catch (err) {
  // Ignore
}

// Check if branding changed
const brandingChanged = lastBranding !== branding;

// Save current branding
fs.writeFileSync(stateFile, branding);

if (brandingChanged) {
  console.log(`Branding changed from ${lastBranding || 'none'} to ${branding}, will rebuild...`);
}

// Read the config file
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Update the icon paths based on branding
const iconFolder = `icons-${branding}`;
config.bundle.icon = [
  `${iconFolder}/32x32.png`,
  `${iconFolder}/128x128.png`,
  `${iconFolder}/128x128@2x.png`,
  `${iconFolder}/icon.icns`,
  `${iconFolder}/icon.ico`
];

// Update productName and identifier based on branding
if (branding === 'genesis') {
  config.productName = 'Genesis';
  config.identifier = 'genesisapp';
  config.app.windows[0].title = 'Genesis v0.1.7';
} else {
  config.productName = 'Kinesis';
  config.identifier = 'kinesisapp';
  config.app.windows[0].title = 'Kinesis v0.1.7';
}

// Write back to config file
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`Updated tauri.conf.json with ${branding} icons and title`);

// Only clean target if branding changed
if (brandingChanged) {
  console.log('Cleaning target directory for fresh rebuild...');
  const targetPath = path.join(__dirname, '..', 'src-tauri', 'target');
  try {
    if (fs.existsSync(targetPath)) {
      const debugPath = path.join(targetPath, 'debug');
      if (fs.existsSync(debugPath)) {
        fs.rmSync(debugPath, { recursive: true, force: true });
        console.log('Cleaned debug directory');
      }
    }
  } catch (err) {
    console.log('Warning: Could not clean target directory:', err.message);
  }
} else {
  console.log('Branding unchanged, skipping clean (no full recompile needed)');
}
