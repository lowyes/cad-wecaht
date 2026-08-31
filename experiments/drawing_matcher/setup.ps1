param(
  [string]$CondaEnvironment = "math"
)

$ErrorActionPreference = "Stop"
$moduleRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dependencyRoot = Join-Path $moduleRoot ".deps"
$sourceRoot = Join-Path $dependencyRoot "_source"
$lightGlueRevision = "eb42fee2d71449efb0aa5c10549752b5d75384d8"
$lightGlueRepository = "https://github.com/cvg/LightGlue.git"

New-Item -ItemType Directory -Force -Path $dependencyRoot | Out-Null

conda run -n $CondaEnvironment python -m pip install `
  --disable-pip-version-check `
  --no-deps `
  --upgrade `
  --target $dependencyRoot `
  "kornia==0.7.4" `
  "kornia-rs==0.1.14"

if ($LASTEXITCODE -ne 0) {
  throw "Kornia installation failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path (Join-Path $sourceRoot ".git"))) {
  New-Item -ItemType Directory -Force -Path $sourceRoot | Out-Null
  git -C $sourceRoot init
  git -C $sourceRoot remote add origin $lightGlueRepository
}

git -C $sourceRoot fetch --depth 1 origin $lightGlueRevision
if ($LASTEXITCODE -ne 0) {
  throw "LightGlue source download failed with exit code $LASTEXITCODE"
}

git -C $sourceRoot checkout --detach FETCH_HEAD
if ($LASTEXITCODE -ne 0) {
  throw "LightGlue checkout failed with exit code $LASTEXITCODE"
}

$resolvedRevision = (git -C $sourceRoot rev-parse HEAD).Trim()
if ($resolvedRevision -ne $lightGlueRevision) {
  throw "Unexpected LightGlue revision: $resolvedRevision"
}

conda run -n $CondaEnvironment python -m pip install `
  --disable-pip-version-check `
  --no-deps `
  --upgrade `
  --target $dependencyRoot `
  $sourceRoot

if ($LASTEXITCODE -ne 0) {
  throw "LightGlue installation failed with exit code $LASTEXITCODE"
}

Write-Host "LightGlue $resolvedRevision installed into $dependencyRoot"
