$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $projectRoot

try {
    function Invoke-AjvCase {
        param(
            [Parameter(Mandatory = $true)][string]$Schema,
            [Parameter(Mandatory = $true)][string]$Data,
            [Parameter(Mandatory = $true)][int]$ExpectedExit
        )

        & npx --yes --package ajv-cli@5 --package ajv-formats@3 ajv validate `
            --spec=draft2020 -c ajv-formats -s $Schema -d $Data
        $actualExit = $LASTEXITCODE
        if ($actualExit -ne $ExpectedExit) {
            throw "Ajv case failed for $Data`: expected exit $ExpectedExit, got $actualExit"
        }
    }

    Get-ChildItem "maestro/references/schemas" -Filter "*.json" | ForEach-Object {
        Get-Content -Raw $_.FullName | ConvertFrom-Json | Out-Null
    }
    Get-ChildItem "maestro/references/scenarios/schema-fixtures" -Filter "*.json" | ForEach-Object {
        Get-Content -Raw $_.FullName | ConvertFrom-Json | Out-Null
    }

    $handoffSchema = "maestro/references/schemas/handoff.schema.json"
    $fixtureRoot = "maestro/references/scenarios/schema-fixtures"
    Invoke-AjvCase $handoffSchema "$fixtureRoot/handoff-blocked-valid.json" 0
    Invoke-AjvCase $handoffSchema "$fixtureRoot/handoff-completed-valid.json" 0
    Invoke-AjvCase $handoffSchema "$fixtureRoot/handoff-blocked-invalid.json" 1
    Invoke-AjvCase $handoffSchema "$fixtureRoot/handoff-completed-invalid.json" 1
    Invoke-AjvCase $handoffSchema "$fixtureRoot/handoff-completed-with-input-invalid.json" 1
    Invoke-AjvCase "maestro/references/schemas/temporary-meta.schema.json" `
        "$fixtureRoot/temporary-meta-valid.json" 0
    Invoke-AjvCase "maestro/references/schemas/task.schema.json" "$fixtureRoot/task-valid.json" 0
    Invoke-AjvCase "maestro/references/schemas/task.schema.json" `
        "$fixtureRoot/task-promoted-invalid.json" 1

    $requiredContracts = @(
        @{ Path = "maestro/references/storage.md"; Text = "committed.yaml" },
        @{ Path = "maestro/references/storage.md"; Text = "before/<state-key>" },
        @{ Path = "maestro/references/storage.md"; Text = "staged/<state-key>" },
        @{ Path = "maestro/references/storage.md"; Text = "applied/<sequence>.yaml" },
        @{ Path = "maestro/references/storage.md"; Text = "SHA-256" },
        @{ Path = "maestro/references/coordination.md"; Text = "only logical active destination" },
        @{ Path = "maestro/references/handoffs.md"; Text = 'requires `status: blocked`' },
        @{ Path = "maestro/references/memory.md"; Text = "current code or runtime evidence" }
    )
    foreach ($contract in $requiredContracts) {
        if (-not (Select-String -LiteralPath $contract.Path -SimpleMatch $contract.Text -Quiet)) {
            throw "Missing contract '$($contract.Text)' in $($contract.Path)"
        }
    }

    $markdownFiles = Get-ChildItem "maestro" -Recurse -Filter "*.md"
    foreach ($document in $markdownFiles) {
        $content = Get-Content -Raw $document.FullName
        $fenceCount = [regex]::Matches($content, '(?m)^```').Count
        if (($fenceCount % 2) -ne 0) {
            throw "Unbalanced code fences in $($document.FullName)"
        }

        $links = [regex]::Matches($content, "\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)")
        foreach ($link in $links) {
            $relativeTarget = $link.Groups[1].Value
            if ($relativeTarget -match "^(https?://|mailto:)") {
                continue
            }
            $target = Join-Path $document.DirectoryName $relativeTarget
            if (-not (Test-Path -LiteralPath $target)) {
                throw "Broken local link in $($document.FullName): $relativeTarget"
            }
        }
    }

    Write-Output "All Maestro contract checks passed."
}
finally {
    Pop-Location
}

# Expected-invalid Ajv fixtures leave a native exit code of 1 even though the assertions passed.
# Return success explicitly; any thrown validation error exits before reaching this line.
exit 0
