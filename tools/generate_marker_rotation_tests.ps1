param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,

  [double[]]$Angles = @(-45, -30, -15, 15, 30, 45)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
if (-not (Test-Path -LiteralPath $OutputDirectory)) {
  New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$source = [System.Drawing.Bitmap]::new($resolvedInput)

try {
  foreach ($angle in $Angles) {
    $radians = $angle * [Math]::PI / 180.0
    $cosine = [Math]::Abs([Math]::Cos($radians))
    $sine = [Math]::Abs([Math]::Sin($radians))
    $width = [Math]::Ceiling($source.Width * $cosine + $source.Height * $sine)
    $height = [Math]::Ceiling($source.Width * $sine + $source.Height * $cosine)
    $result = [System.Drawing.Bitmap]::new(
      $width,
      $height,
      [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    )

    try {
      $graphics = [System.Drawing.Graphics]::FromImage($result)
      try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.TranslateTransform($width / 2.0, $height / 2.0)
        $graphics.RotateTransform($angle)
        $graphics.TranslateTransform(-$source.Width / 2.0, -$source.Height / 2.0)
        $graphics.DrawImage($source, 0, 0, $source.Width, $source.Height)
      }
      finally {
        $graphics.Dispose()
      }

      $angleLabel = if ($angle -lt 0) {
        "neg$([Math]::Abs($angle))"
      }
      else {
        "pos$angle"
      }
      $outputPath = Join-Path $resolvedOutput "part_0001_rotation_$angleLabel.png"
      $result.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      [pscustomobject]@{
        Angle = $angle
        Size = "${width}x${height}"
        Output = $outputPath
      }
    }
    finally {
      $result.Dispose()
    }
  }
}
finally {
  $source.Dispose()
}
