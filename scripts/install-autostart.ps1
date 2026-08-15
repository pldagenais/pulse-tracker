# Registers the "ClaudeTimeTracker" scheduled task. Design:
#  - Runs hidden at every logon (current user, no admin needed).
#  - The VBS launcher WAITS on node and propagates its exit code, so the task
#    is "Running" exactly as long as the server lives -> Task Scheduler's
#    restart-on-failure actually fires when node dies (10x, 1 min apart).
#  - A second trigger re-fires the task every 5 minutes as a watchdog; the
#    server's single-instance guard exits 0 instantly when one is already
#    healthy, and IgnoreNew skips ticks while the task is already running.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source   # bake the absolute path; tasks don't inherit PATH reliably
$serverJs = Join-Path $root 'server\index.js'
$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'

# Window style 0 = fully hidden; True = wait; exit code propagated to the task.
$vbsContent = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$root"
code = sh.Run("""$node"" --disable-warning=ExperimentalWarning ""$serverJs""", 0, True)
WScript.Quit code
"@
Set-Content -Path $vbs -Value $vbsContent -Encoding ASCII

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""

$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# 3650 days = effectively indefinite; [TimeSpan]::MaxValue renders XML the
# Task Scheduler rejects (P99999999DT23H59M59S out of range).
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName 'ClaudeTimeTracker' -Action $action `
  -Trigger @($logonTrigger, $watchdogTrigger) -Settings $settings -Force | Out-Null

Write-Host "Scheduled task 'ClaudeTimeTracker' registered:"
Write-Host "  - starts hidden at every logon"
Write-Host "  - task tracks the server process; crash -> auto-restart (10x, 1 min apart)"
Write-Host "  - watchdog re-checks every 5 minutes (no-op while healthy)"
