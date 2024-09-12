@echo off

$IDE_SIDECAR_REPO = "ide-sidecar"
$IDE_SIDECAR_VERSION = Get-Content .versions/ide-sidecar.txt
$IDE_SIDECAR_VERSION_NO_V = $IDE_SIDECAR_VERSION -replace '^v', ''
$EXECUTABLE_DOWNLOAD_PATH = "bin/ide-sidecar-$IDE_SIDECAR_VERSION_NO_V-runner"

# Hardcoding the OS and architecture for Windows
# TODO: Change this to "windows-amd64" once we actually have a Windows build in GH
$SIDECAR_OS_ARCH = "linux-amd64"

# Check if the executable already exists
$SKIP_DOWNLOAD_EXECUTABLE = Test-Path $EXECUTABLE_DOWNLOAD_PATH -PathType Leaf

if ($SKIP_DOWNLOAD_EXECUTABLE) {
    Write-Host "Skipping download of sidecar executable since it already exists at $EXECUTABLE_DOWNLOAD_PATH"
} else {
    # Create the directory if it doesn't exist
    New-Item -Path "bin" -ItemType Directory -Force

    # Set up the executable path
    $EXECUTABLE_PATH = "ide-sidecar-$IDE_SIDECAR_VERSION_NO_V-runner-$SIDECAR_OS_ARCH"

    # Download the executable using GitHub CLI (gh)
    gh release download $IDE_SIDECAR_VERSION --repo $IDE_SIDECAR_REPO --pattern=$EXECUTABLE_PATH --output $EXECUTABLE_DOWNLOAD_PATH --clobber

    # Set the executable permissions
    icacls $EXECUTABLE_DOWNLOAD_PATH /grant Everyone:"(X)"

    Write-Host "Downloaded sidecar executable to $EXECUTABLE_DOWNLOAD_PATH"
}
