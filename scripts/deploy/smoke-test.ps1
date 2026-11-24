<#
.SYNOPSIS  Quick check after every deployment: app up, Supabase reachable, login page served, security headers present.
.EXAMPLE   .\scripts\deploy\smoke-test.ps1 -Url https://app.medstarpharma.in
#>
param([Parameter(Mandatory)] [string] $Url)
$ErrorActionPreference = "Stop"
$base = $Url.TrimEnd("/")
$h = Invoke-RestMethod "$base/api/health"
Write-Host ("Health: ok={0} auth={1} rest={2} {3} ms, version {4}" -f $h.ok, $h.auth, $h.rest, $h.ms, $h.version)
$r = Invoke-WebRequest "$base/login" -UseBasicParsing
Write-Host ("Login page: HTTP {0}" -f $r.StatusCode)
foreach ($k in "Strict-Transport-Security", "X-Frame-Options", "X-Content-Type-Options") {
  Write-Host ("{0}: {1}" -f $k, ($(if ($r.Headers[$k]) { $r.Headers[$k] } else { "MISSING" })))
}
if (-not $h.ok -or $r.StatusCode -ne 200) { Write-Error "Smoke test failed" } else { Write-Host "Smoke test passed" }
