$ErrorActionPreference = 'Stop'
try {
  Unregister-ScheduledTask -TaskName 'ClaudeTimeTracker' -Confirm:$false
  Write-Host "Scheduled task 'ClaudeTimeTracker' removed."
} catch {
  Write-Host "Scheduled task 'ClaudeTimeTracker' was not registered."
}
