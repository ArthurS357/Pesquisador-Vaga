# Inicia o Ollama local (nativo Windows) com contexto capado para caber na VRAM.
# A RX 7600 tem 8 GB; o contexto default (32K) infla o KV cache e força split CPU/GPU.
# OLLAMA_CONTEXT_LENGTH=8192 mantem o qwen3:8b inteiro na GPU (6.6 GB, 100% GPU).
#
# O valor vem do .env do projeto (fonte unica de verdade): mude la e o script
# acompanha. Se o .env nao existir ou nao tiver a var, cai no fallback 8192.
$ErrorActionPreference = "SilentlyContinue"

# ── Le OLLAMA_CONTEXT_LENGTH do .env (../.env, relativo a este script) ─────────
$contextLength = "8192"   # fallback padrao
$source = "fallback"
$envFile = Join-Path $PSScriptRoot "..\.env"
if (Test-Path $envFile) {
    # A captura (\d+) pega so os digitos: para no 1o nao-digito, ignorando
    # comentario inline (ex.: "OLLAMA_CONTEXT_LENGTH=8192 # nota"). Linhas
    # comentadas comecam com '#' e nao casam com a ancora ^\s*OLLAMA_CONTEXT_LENGTH.
    $match = Select-String -Path $envFile -Pattern '^\s*OLLAMA_CONTEXT_LENGTH\s*=\s*(\d+)' | Select-Object -First 1
    if ($match) {
        $contextLength = $match.Matches.Groups[1].Value
        $source = "from .env"
    }
}
Write-Host "OLLAMA_CONTEXT_LENGTH=$contextLength ($source)"

# Garante o contexto persistente para futuros launches (inclusive o app de tray).
if ([Environment]::GetEnvironmentVariable("OLLAMA_CONTEXT_LENGTH", "User") -ne $contextLength) {
    [Environment]::SetEnvironmentVariable("OLLAMA_CONTEXT_LENGTH", $contextLength, "User")
    Write-Host "OLLAMA_CONTEXT_LENGTH=$contextLength gravado nas variaveis de usuario."
}
$env:OLLAMA_CONTEXT_LENGTH = $contextLength

# ── Parametros de sondagem de prontidao ────────────────────────────────────────
# ProbeTimeout 5s (era 2s): tolera cold start / I/O lento, onde a conexao e aceita
# mas a resposta demora. MaxAttempts 12 com sleep de 1s => orcamento de ate ~72s
# no pior caso (12 x (1s sleep + 5s probe)); na pratica sobe nas 1as tentativas.
$probeTimeout = 5
$maxAttempts  = 12
$tagsUrl      = "http://localhost:11434/api/tags"

# Ja esta no ar?
try {
    Invoke-WebRequest -Uri $tagsUrl -UseBasicParsing -TimeoutSec $probeTimeout | Out-Null
    Write-Host "Ollama ja esta rodando em http://localhost:11434"
    exit 0
} catch { }

Write-Host "Iniciando Ollama (contexto $contextLength)..."
Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden

for ($i = 0; $i -lt $maxAttempts; $i++) {
    Start-Sleep -Seconds 1
    try {
        Invoke-WebRequest -Uri $tagsUrl -UseBasicParsing -TimeoutSec $probeTimeout | Out-Null
        Write-Host "Ollama no ar apos $($i + 1) tentativa(s)."
        exit 0
    } catch { }
}
$budget = $maxAttempts * ($probeTimeout + 1)
Write-Host "ERRO: Ollama nao respondeu apos $maxAttempts tentativas (~${budget}s). Rode 'ollama serve' manualmente para ver o log."
exit 1
