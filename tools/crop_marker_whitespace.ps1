param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [ValidateRange(0.0, 0.2)]
  [double]$PaddingRatio = 0.04,

  [ValidateRange(0, 255)]
  [int]$WhiteThreshold = 245
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$source = [System.Drawing.Bitmap]::new($resolvedInput)

try {
  $minX = $source.Width
  $minY = $source.Height
  $maxX = -1
  $maxY = -1

  for ($y = 0; $y -lt $source.Height; $y++) {
    for ($x = 0; $x -lt $source.Width; $x++) {
      $pixel = $source.GetPixel($x, $y)
      if (
        $pixel.R -lt $WhiteThreshold -or
        $pixel.G -lt $WhiteThreshold -or
        $pixel.B -lt $WhiteThreshold
      ) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }

  if ($maxX -lt 0 -or $maxY -lt 0) {
    throw "输入图片没有检测到非白色内容：$resolvedInput"
  }

  $contentWidth = $maxX - $minX + 1
  $contentHeight = $maxY - $minY + 1
  $padX = [Math]::Ceiling($contentWidth * $PaddingRatio)
  $padY = [Math]::Ceiling($contentHeight * $PaddingRatio)

  $left = [Math]::Max(0, $minX - $padX)
  $top = [Math]::Max(0, $minY - $padY)
  $right = [Math]::Min($source.Width - 1, $maxX + $padX)
  $bottom = [Math]::Min($source.Height - 1, $maxY + $padY)
  $crop = [System.Drawing.Rectangle]::new(
    $left,
    $top,
    $right - $left + 1,
    $bottom - $top + 1
  )

  $outputDirectory = Split-Path -Parent $OutputPath
  if ($outputDirectory -and -not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory | Out-Null
  }

  $result = $source.Clone($crop, $source.PixelFormat)
  try {
    $result.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $result.Dispose()
  }

  [pscustomobject]@{
    Input = $resolvedInput
    Output = [System.IO.Path]::GetFullPath($OutputPath)
    OriginalSize = "$($source.Width)x$($source.Height)"
    CroppedSize = "$($crop.Width)x$($crop.Height)"
    Offset = "$($crop.X),$($crop.Y)"
    PaddingRatio = $PaddingRatio
  }
}
finally {
  $source.Dispose()
}
