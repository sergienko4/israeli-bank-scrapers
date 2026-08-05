<#
.SYNOPSIS
  Emits one compact JSON line per sample describing the memory footprint
  of a process tree.

.DESCRIPTION
  Walks the descendant tree rooted at -RootPid and reports WorkingSetSize
  (RSS) and PrivatePageCount (private bytes) for every member. The tree
  walk happens here rather than in Node so each sample stays small.

  A browser-based bank run is Node + Camoufox + N Firefox content
  processes; measuring only the Node process understates the real
  footprint by roughly an order of magnitude.

  Browser processes that appear after startup but are NOT in the tree
  are reported under "strays", so the caller can tell whether the walk
  missed a detached browser rather than silently under-reporting.
  Browsers that were already running before the profiled run was spawned
  are excluded, otherwise the operator's own everyday browser windows
  would swamp the signal. That baseline is supplied by the caller rather
  than measured here, because by the time this script starts the profiled
  run already exists and could have launched a browser of its own.

.PARAMETER RootPid
  PID whose descendant tree (inclusive) is measured.

.PARAMETER IntervalMs
  Delay between samples in milliseconds. Must be positive: zero would
  turn the sampling loop into a busy loop that floods stdout.

.PARAMETER BaselinePids
  Comma-separated PIDs of browser processes that were already running
  before the profiled run was spawned. Excluded from the stray count.

.PARAMETER BrowserPattern
  Regex matched against process names to classify a process as a browser.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [ValidateRange(1, [int]::MaxValue)][int]$IntervalMs = 500,
  [string]$BaselinePids = '',
  [string]$BrowserPattern = 'camoufox|firefox|chrome|chromium|msedge'
)

$ErrorActionPreference = 'Stop'

function Get-ProcessRows {
  Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount
}

function Get-DescendantIds {
  param($Rows, [int]$Root)
  $byParent = @{}
  foreach ($r in $Rows) {
    $key = [int]$r.ParentProcessId
    if (-not $byParent.ContainsKey($key)) { $byParent[$key] = New-Object System.Collections.ArrayList }
    [void]$byParent[$key].Add([int]$r.ProcessId)
  }
  $seen = New-Object System.Collections.Generic.HashSet[int]
  $stack = New-Object System.Collections.Stack
  $stack.Push($Root)
  while ($stack.Count -gt 0) {
    $id = $stack.Pop()
    if (-not $seen.Add($id)) { continue }
    if ($byParent.ContainsKey($id)) { foreach ($c in $byParent[$id]) { $stack.Push($c) } }
  }
  # Unary comma prevents PowerShell from unrolling the set on return —
  # a single-process tree would otherwise degrade to a bare [int].
  return , $seen
}

function New-Sample {
  param($Rows, $Ids, $Baseline)
  $members = @($Rows | Where-Object { $Ids.Contains([int]$_.ProcessId) } | ForEach-Object {
      [pscustomobject]@{
        procId = [int]$_.ProcessId
        name   = $_.Name
        ws     = [int64]$_.WorkingSetSize
        pb     = [int64]$_.PrivatePageCount
      }
    })
  $strays = @($Rows | Where-Object {
      $_.Name -match $BrowserPattern -and
      -not $Ids.Contains([int]$_.ProcessId) -and
      -not $Baseline.Contains([int]$_.ProcessId)
    })
  # Detached browsers are the leak this profiler exists to surface, so their
  # count and total working set are emitted as separate fields (strays,
  # strayWs). The reporter prints them next to, but NOT inside, the tree
  # total, so a leaking run stays visible without distorting the tree number.
  $strayWs = 0
  foreach ($s in $strays) { $strayWs += [int64]$s.WorkingSetSize }
  [pscustomobject]@{
    t       = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    procs   = $members
    strays  = $strays.Count
    strayWs = $strayWs
  }
}

function Get-BaselineSet {
  param([string]$Ids)
  $set = New-Object System.Collections.Generic.HashSet[int]
  foreach ($id in ($Ids -split ',')) {
    if ($id -match '^\d+$') { [void]$set.Add([int]$id) }
  }
  return , $set
}

$baseline = Get-BaselineSet -Ids $BaselinePids

# Orphaned browsers only become observable once the tree they belonged to is
# gone, so sampling continues briefly past root exit. Bounded, so the sampler
# always terminates even if the strays never do.
$graceLeft = 10

while ($true) {
  $rows = Get-ProcessRows
  $rootAlive = [bool]($rows | Where-Object { [int]$_.ProcessId -eq $RootPid })
  if ($rootAlive) {
    $ids = Get-DescendantIds -Rows $rows -Root $RootPid
  }
  else {
    $ids = New-Object System.Collections.Generic.HashSet[int]
  }
  $sample = New-Sample -Rows $rows -Ids $ids -Baseline $baseline
  $sample | ConvertTo-Json -Compress -Depth 4
  if (-not $rootAlive) {
    if ($sample.strays -eq 0 -or $graceLeft -le 0) { break }
    $graceLeft -= 1
  }
  Start-Sleep -Milliseconds $IntervalMs
}
