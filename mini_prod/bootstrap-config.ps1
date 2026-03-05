param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Copy-TemplateIfNeeded {
  param(
    [Parameter(Mandatory = $true)][string]$TemplatePath,
    [Parameter(Mandatory = $true)][string]$TargetPath
  )

  if (-not (Test-Path $TemplatePath)) {
    Write-Host "[skip] template not found: $TemplatePath" -ForegroundColor Yellow
    return
  }

  if ((Test-Path $TargetPath) -and -not $Force) {
    Write-Host "[skip] exists: $TargetPath (use -Force to overwrite)" -ForegroundColor Yellow
    return
  }

  Copy-Item -Path $TemplatePath -Destination $TargetPath -Force
  Write-Host "[ok] created: $TargetPath" -ForegroundColor Green
}

Copy-TemplateIfNeeded -TemplatePath ".env.example" -TargetPath ".env"
Copy-TemplateIfNeeded -TemplatePath ".notification_config.example.json" -TargetPath ".notification_config.json"

Write-Host ""
Write-Host "Next step: edit .env and .notification_config.json with real secrets." -ForegroundColor Cyan
