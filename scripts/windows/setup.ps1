param([string]$Python = '', [string]$Node = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $root
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:NO_PROXY = ((@('127.0.0.1','localhost','::1') + @($env:NO_PROXY -split ',')) | Where-Object { $_ } | Select-Object -Unique) -join ','
$env:no_proxy = $env:NO_PROXY

if (!$Python) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand) { $Python = $pythonCommand.Source }
}
if (!$Python) { throw 'Install Python 3.11 or newer first, then run this script with -Python C:\path\python.exe' }
& $Python -c 'import sys; assert sys.version_info >= (3,11); print(sys.version)'
if ($LASTEXITCODE -ne 0) { throw 'A working Python 3.11+ is required.' }
if (!(Test-Path '.venv\Scripts\python.exe')) {
    & $Python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
}
$pythonExe = Join-Path $root '.venv\Scripts\python.exe'
& $pythonExe -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed; retry 01-install.cmd after checking the network.' }

if (!$Node) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $Node = $nodeCommand.Source }
}
if (!$Node) {
    # Match the currently tested Mac runtime. Use portable binaries without changing PATH.
    $version = 'v22.22.1'
    $archive = "node-$version-win-x64.zip"
    $downloadDir = Join-Path $root '.runtime\downloads'
    New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
    $zipPath = Join-Path $downloadDir $archive
    $hashPath = Join-Path $downloadDir 'SHASUMS256.txt'
    if (!(Test-Path $zipPath)) { Invoke-WebRequest "https://nodejs.org/dist/$version/$archive" -OutFile $zipPath -UseBasicParsing }
    Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt" -OutFile $hashPath -UseBasicParsing
    $entry = Get-Content $hashPath | Where-Object { $_ -match ('\s+' + [regex]::Escape($archive) + '$') } | Select-Object -First 1
    if (!$entry) { throw 'Node checksum entry missing.' }
    $expected = ($entry -split '\s+')[0]
    if ((Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLower() -ne $expected.ToLower()) { throw 'Node archive checksum mismatch.' }
    $nodeDir = Join-Path $root '.runtime\node'
    if (!(Test-Path (Join-Path $nodeDir 'node.exe'))) {
        Expand-Archive -LiteralPath $zipPath -DestinationPath $downloadDir -Force
        New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
        Copy-Item -Path (Join-Path $downloadDir "node-$version-win-x64\*") -Destination $nodeDir -Recurse -Force
    }
    $Node = Join-Path $nodeDir 'node.exe'
}
& $Node --version
if ($LASTEXITCODE -ne 0) { throw 'Node failed to start.' }
& $Node -e 'if (Number(process.versions.node.split(String.fromCharCode(46))[0]) < 22) process.exit(1)'
if ($LASTEXITCODE -ne 0) { throw 'Node 22 or newer is required.' }
$settingsPath = Join-Path $root 'windows.local.json'
$settings = @{web_port=5173;api_port=18890;gateway_port=18889;relay_port=15588;relay_root='qmt';monitor_root='monitor'}
if (Test-Path $settingsPath) {
    (Get-Content $settingsPath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $settings[$_.Name] = $_.Value }
}
$settings['node'] = $Node
[IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
& $Node --check server.js
if ($LASTEXITCODE -ne 0) { throw 'JavaScript verification failed.' }
@'
import zmq, pandas, psutil
from zoneinfo import ZoneInfo
from bigqmt_signal_trader.xtquant_compat import BigQmtRpcClient
print(ZoneInfo("Asia/Shanghai"))
print("Python dependencies OK")
'@ | & $pythonExe -
if ($LASTEXITCODE -ne 0) { throw 'Python verification failed.' }
Write-Host 'Installation complete. Start QMT and its PIPE strategy, then run 02-start.cmd.'
