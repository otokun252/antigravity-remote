$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

Write-Host 'Installing dependencies...'
npm install

Write-Host ''
Write-Host 'Setup complete.'
Write-Host 'Start the remote bridge with: npm run mobile'
Write-Host 'For local-only testing: npm run mobile:local'
