# Mostra o estado do Ollama: modelos disponiveis + onde o modelo carregado roda.
# Coluna PROCESSOR deve dizer "100% GPU"; se aparecer "x%/y% CPU/GPU", o contexto
# estourou a VRAM (confira OLLAMA_CONTEXT_LENGTH=8192).
$ErrorActionPreference = "SilentlyContinue"

Write-Host "OLLAMA_CONTEXT_LENGTH (User) = $([Environment]::GetEnvironmentVariable('OLLAMA_CONTEXT_LENGTH','User'))"
Write-Host ""

try {
    $tags = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3
    Write-Host "Servidor: ONLINE (http://localhost:11434)"
    Write-Host "Modelos disponiveis:"
    $tags.models | ForEach-Object { Write-Host "  - $($_.name) ($([math]::Round($_.size / 1GB, 1)) GB)" }
} catch {
    Write-Host "Servidor: OFFLINE. Rode 'npm run ollama:start'."
    exit 1
}

Write-Host ""
Write-Host "Modelos carregados na memoria (ollama ps):"
ollama ps
