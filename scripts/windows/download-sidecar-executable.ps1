$IDE_SIDECAR_REPO = "confluentinc/ide-sidecar"
$IDE_SIDECAR_VERSION = Get-Content .versions/ide-sidecar.txt
$IDE_SIDECAR_VERSION_NO_V = $IDE_SIDECAR_VERSION -replace '^v', ''
$EXECUTABLE_DOWNLOAD_PATH = "bin/ide-sidecar-$IDE_SIDECAR_VERSION_NO_V-runner.exe"

# Hardcoding the OS and architecture for Windows
$SIDECAR_OS_ARCH = "windows-x64"

# Check if the executable already exists
$SKIP_DOWNLOAD_EXECUTABLE = Test-Path $EXECUTABLE_DOWNLOAD_PATH -PathType Leaf

if ($SKIP_DOWNLOAD_EXECUTABLE) {
    Write-Host "Skipping download of sidecar executable since it already exists at $EXECUTABLE_DOWNLOAD_PATH"
} else {
    # Create the directory if it doesn't exist
    New-Item -Path "bin" -ItemType Directory -Force

    # Set up the executable path
    $EXECUTABLE_PATH = "ide-sidecar-$IDE_SIDECAR_VERSION_NO_V-runner-$SIDECAR_OS_ARCH.exe"

    # Download the executable using GitHub CLI (gh)
    Write-Host "Downloading sidecar executable from Release $IDE_SIDECAR_VERSION"
    gh release download $IDE_SIDECAR_VERSION --repo $IDE_SIDECAR_REPO --pattern=$EXECUTABLE_PATH --output $EXECUTABLE_DOWNLOAD_PATH --clobber
    if (-not (Test-Path $EXECUTABLE_DOWNLOAD_PATH -PathType Leaf)) {
        Write-Host "Failed to download sidecar executable."
        exit 1
    }

    # Set the executable permissions
    Write-Host "Setting permissions for the downloaded sidecar executable"
    icacls $EXECUTABLE_DOWNLOAD_PATH /grant Everyone:"(X)"

    Write-Host "Downloaded sidecar executable to $EXECUTABLE_DOWNLOAD_PATH"
}
