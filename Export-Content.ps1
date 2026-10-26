<#
  Content Compare - READ-ONLY export script
  ------------------------------------------
  Paste this into Sitecore PowerShell ISE and click "Execute".
  It reads items under the paths below and downloads a .json file to your computer.

  It does NOT create, edit, move, publish or delete anything in Sitecore.

  Run it once in each environment (e.g. UAT and PROD), then open both files
  in compare.html.
#>

# ===================== SETTINGS (edit these) =====================

# A label for this environment. It appears in the file name and the report.
$EnvironmentName = "UAT"

# "master" = content as edited in the CMS
# "web"    = content that has been published (what the live site shows)
$Database = "master"

# Which parts of the content tree to read. Add or remove lines as needed.
$RootPaths = @(
    "/sitecore/content/Home"
    # "/sitecore/layout/Renderings"
    # "/sitecore/templates/Project"
)

# $true = also read every item underneath each path
$IncludeChildren = $true

# "*" = all languages, or a single language such as "en"
$Language = "*"

# Safety limit so a huge tree does not slow the server down
$MaxItems = 5000

# ==================================================================

# Standard Sitecore fields (names start with "__") are skipped because they always
# differ between environments (dates, revision IDs, who edited it).
# These ones ARE kept, because they affect what the page shows or whether it is published.
$keepStandardFields = @(
    "__Renderings", "__Final Renderings",
    "__Display name", "__Hidden",
    "__Never publish", "__Hide version",
    "__Publish", "__Unpublish", "__Valid from", "__Valid to",
    "__Workflow", "__Workflow state",
    "__Base template", "__Insert Rules", "__Masters"
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($root in $RootPaths) {
    if ($results.Count -ge $MaxItems) { break }

    $drivePath = "$($Database):$root"
    $items = @(Get-Item -Path $drivePath -Language $Language -ErrorAction SilentlyContinue)
    if ($items.Count -eq 0) {
        Write-Host "Path not found, skipped: $drivePath" -ForegroundColor Yellow
        continue
    }
    if ($IncludeChildren) {
        $items += @(Get-ChildItem -Path $drivePath -Recurse -Language $Language)
    }

    foreach ($item in $items) {
        if ($results.Count -ge $MaxItems) { break }

        $item.Fields.ReadAll()
        $fields = [ordered]@{}
        foreach ($f in $item.Fields) {
            if ($f.Name.StartsWith("__") -and $keepStandardFields -notcontains $f.Name) { continue }
            $key = $f.Name
            if ($fields.Contains($key)) { $key = "$($f.Name) [$($f.ID)]" }
            $fields[$key] = [string]$f.Value
        }

        $results.Add([ordered]@{
            id         = $item.ID.ToString()
            path       = $item.Paths.FullPath
            name       = $item.Name
            template   = $item.TemplateName
            templateId = $item.TemplateID.ToString()
            language   = $item.Language.Name
            version    = $item.Version.Number
            fields     = $fields
        })
    }
}

# Page layouts refer to components and data sources by ID. Look up their names
# so the report can say "Hero Banner" instead of a GUID. (Read-only.)
$known = @{}
foreach ($r in $results) { $known[$r.id] = $true }
$lookup = [ordered]@{}
foreach ($r in $results) {
    foreach ($layoutField in @("__Renderings", "__Final Renderings")) {
        $value = $r.fields[$layoutField]
        if (-not $value) { continue }
        foreach ($m in [regex]::Matches($value, '\{[0-9A-Fa-f-]{36}\}')) {
            $refId = $m.Value.ToUpper()
            if ($known.ContainsKey($refId) -or $lookup.Contains($refId) -or $lookup.Count -ge 500) { continue }
            $ref = Get-Item -Path "$($Database):" -ID $refId -ErrorAction SilentlyContinue
            if ($ref) { $lookup[$refId] = [ordered]@{ name = $ref.Name; path = $ref.Paths.FullPath } }
        }
    }
}

$export = [ordered]@{
    tool            = "content-compare"
    formatVersion   = 1
    environment     = $EnvironmentName
    database        = $Database
    rootPaths       = $RootPaths
    exportedAt      = (Get-Date).ToString("o")
    sitecoreVersion = [Sitecore.Configuration.About]::VersionInformation()
    itemCount       = $results.Count
    truncated       = ($results.Count -ge $MaxItems)
    lookup          = $lookup
    items           = $results
}

if ($export.truncated) {
    Write-Host "Stopped at $MaxItems items. Narrow the paths or raise MaxItems." -ForegroundColor Yellow
}

$json = $export | ConvertTo-Json -Depth 6 -Compress
$fileName = "content-$EnvironmentName-$Database-$(Get-Date -Format 'yyyyMMdd-HHmm').json"

Write-Host "Read $($results.Count) item versions. Downloading $fileName ..." -ForegroundColor Green
Out-Download -Name $fileName -InputObject $json
