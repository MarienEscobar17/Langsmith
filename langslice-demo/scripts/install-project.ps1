$ErrorActionPreference = 'Stop'
$taskSource = Split-Path -Parent $PSScriptRoot
$taskDestination = 'C:\projects\langslice-demo'
if (Test-Path -LiteralPath $taskDestination) { throw 'Destination already exists. No files were overwritten.' }
New-Item -ItemType Directory -Path $taskDestination | Out-Null
Get-ChildItem -LiteralPath $taskSource -Force | Where-Object { $_.Name -ne 'node_modules' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $taskDestination -Recurse }
if (Test-Path -LiteralPath 'C:\projects\langsmith_demo\.env') {
    Copy-Item -LiteralPath 'C:\projects\langsmith_demo\.env' -Destination (Join-Path $taskDestination '.env')
    Add-Content -LiteralPath (Join-Path $taskDestination '.env') -Value "`nLANGSMITH_PROJECT=LangSlice-Demo`nLANGSMITH_DATASET=LangSlice-Ingredient-Availability"
}
Push-Location -LiteralPath $taskDestination
try {
    & 'C:\Program Files\nodejs\npm.cmd' install --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & 'C:\Program Files\nodejs\node.exe' --test 'tests/*.test.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'Project tests failed.' }
    & 'C:\Program Files\nodejs\node.exe' --env-file-if-exists=.env 'scripts/preflight.mjs'
    if ($LASTEXITCODE -ne 0) { throw 'LangSmith connection failed. Project and dataset files are available locally.' }
    & 'C:\Program Files\nodejs\node.exe' --env-file-if-exists=.env 'src/cli.mjs' evaluate
    if ($LASTEXITCODE -ne 0) { throw 'Cloud dataset or experiment creation failed.' }
    & 'C:\Program Files\nodejs\node.exe' --env-file-if-exists=.env 'src/cli.mjs' demo
    if ($LASTEXITCODE -ne 0) { throw 'Trace demo failed.' }
} finally { Pop-Location }
