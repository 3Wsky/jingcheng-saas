# Sync monorepo sources into jingcheng-saas
# Usage: .\scripts\sync-from-monorepo.ps1

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$dst = Split-Path $PSScriptRoot -Parent

Write-Host "=== Sync monorepo -> jingcheng-saas ===" -ForegroundColor Cyan

# --- fzlsaas-admin ---
$adminSrc = Join-Path $repoRoot "fzlsaas-admin"
$adminDst = Join-Path $dst "fzlsaas-admin"
if (-not (Test-Path $adminSrc)) { Write-Error "Missing $adminSrc" }

$exclude = @('node_modules', 'dist', 'dist-upload.zip', '.env.local')
Get-ChildItem $adminSrc -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
    $target = Join-Path $adminDst $_.Name
    if ($_.PSIsContainer) {
        if (Test-Path $target) { Remove-Item $target -Recurse -Force }
        Copy-Item $_.FullName $target -Recurse -Force
    } else {
        Copy-Item $_.FullName $target -Force
    }
    Write-Host "  admin: $($_.Name)"
}

# --- shunwei-api ---
$apiSrc = Join-Path $repoRoot "CMB\shunwei-api"
$apiDst = Join-Path $dst "shunwei-api"
if (-not (Test-Path $apiSrc)) { Write-Error "Missing $apiSrc" }

if (Test-Path $apiDst) { Remove-Item $apiDst -Recurse -Force }
robocopy $apiSrc $apiDst /E /XD node_modules data .git /XF .env *.log /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Error "robocopy failed" }
Write-Host "  api: synced shunwei-api"

Write-Host "Done. jingcheng-saas monorepo updated." -ForegroundColor Green
