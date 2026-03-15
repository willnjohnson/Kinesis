#!/usr/bin/env node

// This script allows running: node tauri-branding.cjs dev:kinesis
// or after npm install: npx tauri-branding dev:genesis

const { execSync } = require('child_process');
const args = process.argv.slice(2);
const command = args[0];

const scripts = {
  'dev': 'xcopy /Y /E src-tauri\icons-kinesis\* src-tauri\icons\ && cross-env VITE_BRANDING=kinesis tauri dev --features kinesis',
  'dev:kinesis': 'xcopy /Y /E src-tauri\icons-kinesis\* src-tauri\icons\ && cross-env VITE_BRANDING=kinesis tauri dev --features kinesis',
  'dev:genesis': 'xcopy /Y /E src-tauri\icons-genesis\* src-tauri\icons\ && cross-env VITE_BRANDING=genesis tauri dev --features genesis',
  'build': 'xcopy /Y /E src-tauri\\icons-kinesis\\* src-tauri\\icons\\ && cross-env VITE_BRANDING=kinesis tauri build --features kinesis',
  'build:kinesis': 'xcopy /Y /E src-tauri\\icons-kinesis\\* src-tauri\\icons\\ && cross-env VITE_BRANDING=kinesis tauri build --features kinesis',
  'build:genesis': 'xcopy /Y /E src-tauri\\icons-genesis\\* src-tauri\\icons\\ && cross-env VITE_BRANDING=genesis tauri build --features genesis',
};

if (!command || !scripts[command]) {
  console.log('Available commands:');
  console.log('  node tauri-branding.cjs dev        - Kinesis (default)');
  console.log('  node tauri-branding.cjs dev:kinesis');
  console.log('  node tauri-branding.cjs dev:genesis');
  console.log('  node tauri-branding.cjs build       - Kinesis (default)');
  console.log('  node tauri-branding.cjs build:kinesis');
  console.log('  node tauri-branding.cjs build:genesis');
  process.exit(1);
}

console.log(`Running: ${scripts[command]}`);

try {
  execSync(scripts[command], { 
    stdio: 'inherit',
    cwd: process.cwd(),
    shell: true
  });
} catch (error) {
  process.exit(error.status || 1);
}
