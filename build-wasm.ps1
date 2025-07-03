# build-wasm.ps1

# Step 1: Build Rust WASM target in release mode
Write-Host "Building Rust crate for wasm32-unknown-unknown target..."
cargo build --target wasm32-unknown-unknown --release

if ($LASTEXITCODE -ne 0) {
  Write-Error "Cargo build failed! Exiting."
  exit $LASTEXITCODE
}

# Step 2: Run wasm-bindgen to generate JS + WASM bindings
Write-Host "Running wasm-bindgen on generated wasm..."

$wasmPath = "target\wasm32-unknown-unknown\release\memoro_crypto.wasm"
$outDir = "src\wasm"

# Ensure output directory exists
if (-Not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}

wasm-bindgen $wasmPath --out-dir $outDir --target web

if ($LASTEXITCODE -ne 0) {
  Write-Error "wasm-bindgen failed! Exiting."
  exit $LASTEXITCODE
}

Write-Host "Build complete! JS + WASM files placed in $outDir"
