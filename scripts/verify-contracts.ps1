$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Push-Location $projectRoot

try {
    function Invoke-AjvCase {
        param(
            [Parameter(Mandatory = $true)][string]$Schema,
            [Parameter(Mandatory = $true)][string]$Data,
            [Parameter(Mandatory = $true)][int]$ExpectedExit,
            [string[]]$References = @()
        )

        $ajvArguments = @("validate", "--spec=draft2020", "-c", "ajv-formats", "-s", $Schema, "-d", $Data)
        foreach ($reference in $References) {
            $ajvArguments += @("-r", $reference)
        }

        & npx --yes --package ajv-cli@5 --package ajv-formats@3 ajv @ajvArguments
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

    $workerSchema = "maestro/references/schemas/worker.schema.json"
    $requirementsSchema = "maestro/references/schemas/capability-requirements.schema.json"
    $registrySchema = "maestro/references/schemas/worker-registry.schema.json"
    $selectionSchema = "maestro/references/schemas/worker-selection.schema.json"
    Invoke-AjvCase $requirementsSchema "$fixtureRoot/capability-requirements-valid.json" 0
    Invoke-AjvCase $requirementsSchema "$fixtureRoot/capability-requirements-overlap-invalid.json" 0
    Invoke-AjvCase $workerSchema "$fixtureRoot/worker-temporary-valid.json" 0
    Invoke-AjvCase $workerSchema "$fixtureRoot/worker-temporary-lifecycle-invalid.json" 1
    Invoke-AjvCase $workerSchema "$fixtureRoot/worker-permission-invalid.json" 1
    Invoke-AjvCase $registrySchema "maestro/references/workers/builtin-registry.json" 0 `
        @($workerSchema)
    Invoke-AjvCase $registrySchema "$fixtureRoot/worker-registry-valid.json" 0 @($workerSchema)
    Invoke-AjvCase $registrySchema "$fixtureRoot/worker-registry-duplicate-invalid.json" 0 `
        @($workerSchema)
    Invoke-AjvCase $registrySchema "$fixtureRoot/worker-registry-source-invalid.json" 1 `
        @($workerSchema)
    Invoke-AjvCase $selectionSchema "$fixtureRoot/worker-selection-exact-valid.json" 0 `
        @($requirementsSchema)
    Invoke-AjvCase $selectionSchema "$fixtureRoot/worker-selection-composed-valid.json" 0 `
        @($requirementsSchema)
    Invoke-AjvCase $selectionSchema "$fixtureRoot/worker-selection-generated-valid.json" 0 `
        @($requirementsSchema)
    Invoke-AjvCase $handoffSchema "$fixtureRoot/worker-handoff-valid.json" 0
    Invoke-AjvCase $handoffSchema "$fixtureRoot/worker-handoff-both-paths-invalid.json" 1

    $duplicateRegistry = Get-Content -Raw "$fixtureRoot/worker-registry-duplicate-invalid.json" |
        ConvertFrom-Json
    $duplicateIds = @($duplicateRegistry.workers | Group-Object id | Where-Object Count -gt 1)
    if ($duplicateIds.Count -eq 0) {
        throw "Duplicate registry fixture did not contain duplicate Worker IDs"
    }

    $overlapRequirements = Get-Content -Raw `
        "$fixtureRoot/capability-requirements-overlap-invalid.json" | ConvertFrom-Json
    $overlap = @($overlapRequirements.required_capabilities |
        Where-Object { $overlapRequirements.optional_capabilities -contains $_ })
    if ($overlap.Count -eq 0) {
        throw "Overlap requirements fixture did not reuse a required capability as optional"
    }

    $builtinRegistry = Get-Content -Raw "maestro/references/workers/builtin-registry.json" |
        ConvertFrom-Json
    $builtinDuplicateIds = @($builtinRegistry.workers | Group-Object id | Where-Object Count -gt 1)
    if ($builtinDuplicateIds.Count -gt 0) {
        throw "Built-in registry contains duplicate Worker IDs: $($builtinDuplicateIds.Name -join ', ')"
    }

    $canonicalCapabilityPattern = '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$'
    $knownCapabilities = @{}
    foreach ($worker in $builtinRegistry.workers) {
        if ($worker.source -ne "builtin") {
            throw "Built-in registry Worker '$($worker.id)' has source '$($worker.source)'"
        }

        $rolePath = "maestro/references/roles/$($worker.id).md"
        if (-not (Test-Path -LiteralPath $rolePath)) {
            throw "Built-in Worker '$($worker.id)' has no matching stable role reference"
        }

        foreach ($capability in $worker.capabilities) {
            if ($capability -notmatch $canonicalCapabilityPattern) {
                throw "Worker '$($worker.id)' uses non-canonical capability '$capability'"
            }
            if (-not (Select-String -LiteralPath $rolePath -SimpleMatch ('`' + $capability + '`') -Quiet)) {
                throw "Role '$($worker.id)' does not declare registry capability '$capability'"
            }
            $knownCapabilities[$capability] = $true
        }
    }

    foreach ($alias in $builtinRegistry.aliases.PSObject.Properties) {
        if ($alias.Name -notmatch $canonicalCapabilityPattern -or
            $alias.Value -notmatch $canonicalCapabilityPattern) {
            throw "Built-in registry contains a non-canonical capability alias"
        }
        if (-not $knownCapabilities.ContainsKey($alias.Value)) {
            throw "Capability alias '$($alias.Name)' targets unknown capability '$($alias.Value)'"
        }
    }

    $projectRegistry = Get-Content -Raw "$fixtureRoot/worker-registry-valid.json" | ConvertFrom-Json
    $projectCapabilities = @($projectRegistry.workers | ForEach-Object capabilities | Sort-Object -Unique)
    foreach ($alias in $projectRegistry.aliases.PSObject.Properties) {
        if ($alias.Name -notmatch $canonicalCapabilityPattern -or
            $alias.Value -notmatch $canonicalCapabilityPattern) {
            throw "Project registry contains a non-canonical capability alias"
        }
        if ($projectCapabilities -notcontains $alias.Value) {
            throw "Project capability alias '$($alias.Name)' targets unknown capability '$($alias.Value)'"
        }
    }

    function Test-ContainsEvery {
        param([object[]]$Available, [object[]]$Required)
        return @($Required | Where-Object { $Available -notcontains $_ }).Count -eq 0
    }

    $exactSelection = Get-Content -Raw "$fixtureRoot/worker-selection-exact-valid.json" |
        ConvertFrom-Json
    $exactCapabilities = @($exactSelection.requirements.required_capabilities) +
        @($exactSelection.requirements.optional_capabilities)
    $exactCandidates = @($builtinRegistry.workers | Where-Object {
        Test-ContainsEvery $_.capabilities $exactCapabilities
    })
    if ($exactCandidates.Count -ne 1 -or
        $exactCandidates[0].id -ne $exactSelection.selected_workers[0].id) {
        throw "Exact selection fixture does not resolve uniquely from the built-in registry"
    }

    $composedSelection = Get-Content -Raw "$fixtureRoot/worker-selection-composed-valid.json" |
        ConvertFrom-Json
    $composedWorkers = @($composedSelection.selected_workers | ForEach-Object {
        $selectedId = $_.id
        $builtinRegistry.workers | Where-Object id -eq $selectedId
    })
    if ($composedWorkers.Count -ne $composedSelection.selected_workers.Count) {
        throw "Composed selection contains an unknown built-in Worker"
    }
    $composedCapabilities = @($composedWorkers | ForEach-Object capabilities | Sort-Object -Unique)
    if (-not (Test-ContainsEvery $composedCapabilities `
        $composedSelection.requirements.required_capabilities)) {
        throw "Composed selection does not cover every required capability"
    }
    foreach ($worker in $composedWorkers) {
        if (Test-ContainsEvery $worker.capabilities $composedSelection.requirements.required_capabilities) {
            throw "Composed selection is not minimal because one Worker covers every requirement"
        }
    }

    $generatedSelection = Get-Content -Raw "$fixtureRoot/worker-selection-generated-valid.json" |
        ConvertFrom-Json
    $generatedWorker = Get-Content -Raw "$fixtureRoot/worker-temporary-valid.json" | ConvertFrom-Json
    if ($generatedWorker.id -ne $generatedSelection.selected_workers[0].id -or
        -not (Test-ContainsEvery $generatedWorker.capabilities `
            $generatedSelection.requirements.required_capabilities)) {
        throw "Generated selection and Task-scoped Worker fixture disagree"
    }
    if (-not (Test-ContainsEvery $generatedSelection.requirements.available_tools `
        $generatedWorker.tools)) {
        throw "Generated Worker requests a tool outside the requirements"
    }
    if (-not (Test-ContainsEvery $generatedSelection.requirements.context.read_paths `
        $generatedWorker.context.read_paths) -or
        -not (Test-ContainsEvery $generatedSelection.requirements.context.write_paths `
            $generatedWorker.context.write_paths)) {
        throw "Generated Worker context exceeds the requirements"
    }
    if (-not (Test-ContainsEvery $generatedSelection.requirements.permission_ceiling.autonomous `
        $generatedWorker.permissions.autonomous) -or
        -not (Test-ContainsEvery $generatedSelection.requirements.permission_ceiling.conditional `
            $generatedWorker.permissions.conditional)) {
        throw "Generated Worker permissions exceed the requirements ceiling"
    }
    if ($generatedWorker.lifecycle.scope -ne "task" -or
        $generatedWorker.lifecycle.expires_at -ne "task-completion") {
        throw "Generated Worker is not bounded to the Task lifecycle"
    }
    $reusableGeneratedMatch = @($builtinRegistry.workers | Where-Object {
        Test-ContainsEvery $_.capabilities $generatedSelection.requirements.required_capabilities
    })
    if ($reusableGeneratedMatch.Count -gt 0) {
        throw "Generated selection has a reusable match and should not generate a Worker"
    }

    foreach ($selectionPath in @(
        "$fixtureRoot/worker-selection-exact-valid.json",
        "$fixtureRoot/worker-selection-composed-valid.json",
        "$fixtureRoot/worker-selection-generated-valid.json"
    )) {
        $selection = Get-Content -Raw $selectionPath | ConvertFrom-Json
        foreach ($selected in $selection.selected_workers) {
            $expectedSuffix = "/workers/$($selected.id)/spec.yaml"
            if (-not $selected.snapshot_path.EndsWith($expectedSuffix)) {
                throw "Selection snapshot path does not match Worker ID '$($selected.id)'"
            }
        }
    }

    $requiredContracts = @(
        @{ Path = "maestro/references/storage.md"; Text = "committed.yaml" },
        @{ Path = "maestro/references/storage.md"; Text = "before/<state-key>" },
        @{ Path = "maestro/references/storage.md"; Text = "staged/<state-key>" },
        @{ Path = "maestro/references/storage.md"; Text = "applied/<sequence>.yaml" },
        @{ Path = "maestro/references/storage.md"; Text = "SHA-256" },
        @{ Path = "maestro/references/coordination.md"; Text = "only logical active destination" },
        @{ Path = "maestro/references/handoffs.md"; Text = 'requires `status: blocked`' },
        @{ Path = "maestro/references/memory.md"; Text = "current code or runtime evidence" },
        @{ Path = "maestro/references/workers.md"; Text = "Worker permissions are requested action categories, never grants" },
        @{ Path = "maestro/references/workers.md"; Text = "Task resumption uses this snapshot" },
        @{ Path = "maestro/references/workers.md"; Text = "must never promote it automatically" },
        @{ Path = "maestro/references/coordination.md"; Text = "Convert the bounded delegation into capability requirements" }
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
