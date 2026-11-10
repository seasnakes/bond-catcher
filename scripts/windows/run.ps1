param([ValidateSet('start','stop','status','check','monitor','monitor-smoke')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$python = Join-Path $root '.venv\Scripts\python.exe'
if (!(Test-Path $python)) { throw 'Run 01-install.cmd first.' }
$env:PYTHONUTF8 = '1'
& $python (Join-Path $PSScriptRoot 'manage.py') $Action
$result = $LASTEXITCODE
if ($result -eq 0 -and $Action -eq 'start') {
    $settings = Get-Content (Join-Path $root 'windows.local.json') -Raw | ConvertFrom-Json
    Start-Process ('http://localhost:' + $settings.web_port)
}
exit $result
