param(
    [Parameter(Mandatory = $true)]
    [string]$Source
)

$ErrorActionPreference = 'Stop'
$process = Get-CimInstance Win32_Process |
    Where-Object Name -eq 'XtItClient.exe' |
    Select-Object -First 1
if (-not $process) {
    throw 'XtItClient.exe is not running'
}

$qmtRoot = Split-Path (Split-Path $process.ExecutablePath -Parent) -Parent
$destination = Join-Path $qmtRoot 'python'
if (-not (Test-Path -LiteralPath $Source)) {
    throw 'macOS shared bundle is not reachable'
}
if (-not (Test-Path -LiteralPath $destination)) {
    throw 'QMT python directory was not found'
}

$files = @(
    'BIGQMT_ZMQ_DRYRUN.py',
    'BIGQMT_REDIS_DRYRUN.py',
    'bigqmt_signal_trader_strategy.py',
    'bigqmt_signal_trader_redis_rpc_runtime.py',
    'bigqmt_signal_trader_local_config.py',
    'finance-bigqmt-manifest.json'
)

# Verify the prepared bundle before touching the installed deployment.
$manifest = Get-Content -LiteralPath (Join-Path $Source 'finance-bigqmt-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.orders_enabled -ne $false) {
    throw 'the finance deployment must keep remote orders disabled'
}
foreach ($entry in $manifest.files.PSObject.Properties) {
    $relative = $entry.Name.Replace('/', '\')
    $hash = (Get-FileHash -LiteralPath (Join-Path $Source $relative) -Algorithm SHA256).Hash
    if ($hash -ne $entry.Value.sha256) {
        throw ('source checksum mismatch: ' + $entry.Name)
    }
}

# Keep backups outside python so QMT does not discover them as strategies.
$backup = Join-Path $qmtRoot ('_finance_bigqmt_backup_' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup -ErrorAction Stop | Out-Null
foreach ($file in $files) {
    $installed = Join-Path $destination $file
    if (Test-Path -LiteralPath $installed) {
        Copy-Item -LiteralPath $installed -Destination $backup -Force
    }
}
$installedPackage = Join-Path $destination 'bigqmt_signal_trader'
if (Test-Path -LiteralPath $installedPackage) {
    Copy-Item -LiteralPath $installedPackage -Destination $backup -Recurse -Force
}

foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path $Source $file) -Destination $destination -Force
}
Copy-Item -LiteralPath (Join-Path $Source 'bigqmt_signal_trader') `
    -Destination $destination -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $destination 'bigqmt_signal_trader') -Directory -Recurse -Filter '__pycache__' |
    Remove-Item -Recurse -Force
foreach ($entry in $manifest.files.PSObject.Properties) {
    $relative = $entry.Name.Replace('/', '\')
    $hash = (Get-FileHash -LiteralPath (Join-Path $destination $relative) -Algorithm SHA256).Hash
    if ($hash -ne $entry.Value.sha256) {
        throw ('installed checksum mismatch: ' + $entry.Name)
    }
}

$required = @(
    'BIGQMT_ZMQ_DRYRUN.py',
    'BIGQMT_REDIS_DRYRUN.py',
    'bigqmt_signal_trader_local_config.py',
    'bigqmt_signal_trader'
)
$missing = @($required | Where-Object {
    -not (Test-Path -LiteralPath (Join-Path $destination $_))
})
if ($missing.Count -gt 0) {
    throw ('deployment is incomplete: ' + ($missing -join ','))
}

Write-Output 'BIGQMT_DEPLOY_OK'
Write-Output ('BIGQMT_DEPLOY_VERSION=' + $manifest.version)
