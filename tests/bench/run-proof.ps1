<#
.SYNOPSIS
    Run the whole failure laboratory in order and assemble one report.

.DESCRIPTION
    Six k6 scenarios, each bracketed by a database snapshot, then a rendered
    report. The point is that the run is repeatable in front of someone: nothing
    is typed by hand mid-demo, the replica kill happens on a timer rather than
    on an operator remembering to run it, and the numbers are written to disk
    rather than scrolled past in a terminal.

    Exit code is non-zero if any scenario failed its own thresholds. This script
    never decides that a run passed -- k6 does, and this only reports it.

.PARAMETER Scenarios
    Which scenarios to run. Defaults to all six, in order.

.PARAMETER SkipKill
    Run scenario 05 without killing a replica. Use when demonstrating on a
    single-replica deployment, where there is nothing to kill.

.EXAMPLE
    pwsh tests/bench/run-proof.ps1
    pwsh tests/bench/run-proof.ps1 -Scenarios 01-duplicate-storm,02-double-spend
#>

[CmdletBinding()]
param(
    [string[]]$Scenarios = @(
        '01-duplicate-storm',
        '02-double-spend',
        '03-deadlock-pressure',
        '04-sustained-load',
        '05-replica-kill',
        '06-money-request-payment-storm'
    ),
    [switch]$SkipKill,
    [string]$KillContainer = 'pstu-money-api-2',
    [int]$KillAfterSeconds = 15
)

# Deliberately NOT 'Stop'. Windows PowerShell 5.1 wraps anything a native
# executable writes to stderr in an ErrorRecord, and docker compose reports
# ordinary progress ("Container ... Creating") there. Under 'Stop' the first
# healthy container start aborts the run. Exit codes are the truth for native
# commands, so Invoke-Native checks those explicitly and every cmdlet call below
# is either guarded or harmless.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $repo

# The exit code is published on a script-scope variable rather than returned.
# A `return` here would put the code at the end of a pipeline that already
# carries every line the command printed, so the caller would capture an array
# of output and compare THAT to zero -- which is never equal, and every scenario
# would read as failed regardless of what k6 actually decided.
$script:LastNativeExit = 0

function Invoke-Native {
    param(
        [Parameter(Mandatory)][scriptblock]$Command,
        [string]$What = 'command',
        [switch]$AllowFailure
    )
    & $Command | Out-Host
    $script:LastNativeExit = $LASTEXITCODE
    if ($script:LastNativeExit -ne 0 -and -not $AllowFailure) {
        Pop-Location
        throw "$What failed with exit code $($script:LastNativeExit)"
    }
}

$results = Join-Path $PSScriptRoot 'results'
New-Item -ItemType Directory -Force -Path $results | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $results 'snapshots') | Out-Null

function Write-Step($text) {
    Write-Host ''
    Write-Host "== $text" -ForegroundColor Cyan
}

function Invoke-Snapshot($label) {
    Invoke-Native { python tests/bench/collect.py snapshot $label | Out-Null } "snapshot '$label'"
}

Write-Step 'Bringing up the stack with the chaos profile'
Invoke-Native { docker compose --profile chaos up -d } 'docker compose up'

# The gateway answering is the real readiness signal; a container being "up" is
# not the same thing as three replicas having applied the schema.
Write-Step 'Waiting for the gateway'
$ready = $false
foreach ($attempt in 1..40) {
    try {
        $response = Invoke-WebRequest -Uri 'http://localhost:8080/api/v1/health/ready' -TimeoutSec 3 -UseBasicParsing
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 750 }
}
if (-not $ready) { throw 'gateway did not become ready' }

$failures = @()
$runStart = Get-Date -Format 'yyyyMMdd-HHmmss'

foreach ($scenario in $Scenarios) {
    Write-Step "Scenario $scenario"
    Invoke-Snapshot "$scenario-before"

    $killJob = $null
    if ($scenario -eq '05-replica-kill' -and -not $SkipKill) {
        # Scheduled rather than manual: the whole claim of this scenario is that
        # a replica dies WHILE money is moving, and a human typing docker kill
        # into a second terminal cannot be relied on to hit that window.
        Write-Host "   killing $KillContainer after ${KillAfterSeconds}s" -ForegroundColor Yellow
        $killJob = Start-Job -ScriptBlock {
            param($container, $delay)
            Start-Sleep -Seconds $delay
            docker kill $container | Out-Null
        } -ArgumentList $KillContainer, $KillAfterSeconds
    }

    # k6 computes med/p(90)/p(95) by default. p(99) is the one a reviewer asks
    # about, so it is requested explicitly rather than left out of the report.
    # A scenario failing its thresholds is a result to report, not a reason to
    # abandon the pass -- the remaining scenarios still have to run.
    Invoke-Native -AllowFailure -What $scenario -Command {
        docker compose --profile chaos run --rm k6 run `
            --summary-trend-stats 'min,med,p(90),p(95),p(99),max' `
            "/scripts/$scenario.js"
    }
    $scenarioExit = $script:LastNativeExit

    if ($killJob) {
        Wait-Job $killJob | Out-Null
        Remove-Job $killJob | Out-Null
        Write-Host '   restarting the killed replica' -ForegroundColor Yellow
        Invoke-Native { docker compose up -d --no-recreate api | Out-Null } 'replica restart'
        # nginx resolved the upstream addresses when it started, and a restarted
        # container can come back on a different address. Reload so the gateway
        # is talking to the replica that now exists rather than the one that did.
        Invoke-Native -AllowFailure -What 'nginx reload' -Command {
            docker compose exec -T gateway nginx -s reload | Out-Null
        }
        Start-Sleep -Seconds 5
    }

    Invoke-Snapshot "$scenario-after"

    if ($scenarioExit -ne 0) {
        $failures += $scenario
        Write-Host "   $scenario FAILED its thresholds" -ForegroundColor Red
    }
}

Write-Step 'Building the report'
Invoke-Native { python tests/bench/report.py $runStart } 'report build'

Pop-Location

if ($failures.Count -gt 0) {
    Write-Host ''
    Write-Host "FAILED: $($failures -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'All scenarios passed their own thresholds.' -ForegroundColor Green
exit 0
