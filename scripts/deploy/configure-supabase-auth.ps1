<#
.SYNOPSIS
  One-time production settings for the hosted Supabase project: site URL, allowed redirect URLs, password rules and custom SMTP.

.DESCRIPTION
  Uses the Supabase Management API with your personal access token (Dashboard → Account → Access tokens).
  The token and SMTP password are asked for interactively and never written to disk.

.EXAMPLE
  .\scripts\deploy\configure-supabase-auth.ps1 -ProjectRef abcdefghijklmnop -SiteUrl https://app.medstarpharma.in `
     -SmtpHost smtp.zeptomail.in -SmtpPort 587 -SmtpUser emailapikey -SenderEmail no-reply@medstarpharma.in -SenderName "MedStar Pharmacy"
#>
param(
  [Parameter(Mandatory)] [string] $ProjectRef,
  [Parameter(Mandatory)] [string] $SiteUrl,
  [Parameter(Mandatory)] [string] $SmtpHost,
  [int] $SmtpPort = 587,
  [Parameter(Mandatory)] [string] $SmtpUser,
  [Parameter(Mandatory)] [string] $SenderEmail,
  [string] $SenderName = "MedStar Pharma Suite",
  [string[]] $ExtraRedirects = @()
)
$ErrorActionPreference = "Stop"

function Read-Secret([string] $prompt) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$token = Read-Secret "Supabase personal access token"
$smtpPass = Read-Secret "SMTP password / API key"

$site = $SiteUrl.TrimEnd("/")
$redirects = @("$site/**") + $ExtraRedirects
$body = @{
  site_url                 = $site
  uri_allow_list           = ($redirects -join ",")
  password_min_length      = 10
  smtp_admin_email         = $SenderEmail
  smtp_sender_name         = $SenderName
  smtp_host                = $SmtpHost
  smtp_port                = "$SmtpPort"
  smtp_user                = $SmtpUser
  smtp_pass                = $smtpPass
  rate_limit_email_sent    = 60
} | ConvertTo-Json

$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
Invoke-RestMethod -Method Patch -Uri "https://api.supabase.com/v1/projects/$ProjectRef/config/auth" -Headers $headers -Body $body | Out-Null

$check = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects/$ProjectRef/config/auth" -Headers $headers
Write-Host "Site URL:        $($check.site_url)"
Write-Host "Redirect URLs:   $($check.uri_allow_list)"
Write-Host "SMTP host:       $($check.smtp_host):$($check.smtp_port)  sender $($check.smtp_admin_email)"
Write-Host "Min password:    $($check.password_min_length)"
Write-Host "Done. On the login page use Email link with your own address to confirm mail delivery."
