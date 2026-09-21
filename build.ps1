$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$archiveDir = Join-Path $root 'archive'
New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null

$manifestPath = Join-Path $root 'manifest.webmanifest'
$manifestText = [System.IO.File]::ReadAllText($manifestPath)

$versionMatch = [regex]::Match($manifestText, '"version":\s*"(\d+)\.(\d+)\.(\d+)"')
if (-not $versionMatch.Success) { throw "version field not found in $manifestPath" }
$major = [int]$versionMatch.Groups[1].Value
$minor = [int]$versionMatch.Groups[2].Value
$patch = [int]$versionMatch.Groups[3].Value + 1
$newVersion = "$major.$minor.$patch"

$pattern = '"version":\s*"\d+\.\d+\.\d+"'
$replacement = "`"version`": `"$newVersion`""
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, ($manifestText -replace $pattern, $replacement), $utf8NoBom)
Write-Host "Version bumped to $newVersion"

$zipPath = Join-Path $archiveDir "my-tv-$newVersion.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$includeFiles = @(
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/settings.js',
  'js/app.js',
  'js/buffer.js',
  'js/channels.js',
  'js/player.js',
  'js/schedule.js',
  'js/notifications.js',
  'js/recorder.js',
  'js/ads.js',
  'js/menu.js',
  'js/vendor/hls.min.js',
  'icons/icon-56.png',
  'icons/icon-112.png'
)
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
foreach ($item in $includeFiles) {
  $fullItem = Join-Path $root $item
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fullItem, $item) | Out-Null
}
$zip.Dispose()

Write-Host "Built $zipPath"
$zipPath
