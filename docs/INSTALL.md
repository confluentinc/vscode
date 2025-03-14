
# Installation

### From the Visual Studio Code Extension Marketplace

In your browser, go to the [VS Code Marketplace](https://marketplace.visualstudio.com/) to view,
download, and install the
[Confluent for VS Code](https://marketplace.visualstudio.com/items?itemName=confluentinc.vscode-confluent)
extension.

### From within VS Code

1. Open VS Code.

1. In the VS Code sidebar, click **Extensions** (`Cmd+Shift+X`/`Ctrl+Shift+X`).

1. In the **Extensions** view, search for "Confluent".

1. Click **Install**.

### From a `.vsix` file

_Note: This doc refers to the extension version as `x.x.x`. Ensure you replace this with the actual
version number you want to use, without the `v` prefix._

Confluent provides these VSIX files:

- MacOS with Apple Silicon: `vscode-confluent-darwin-arm64-x.x.x.vsix`
- MacOS with Intel processors: `vscode-confluent-darwin-x64-x.x.x.vsix`
- Linux on ARM-64 processors: `vscode-confluent-linux-arm64-x.x.x.vsix`
- Linux on x64 processors: `vscode-confluent-linux-x64-x.x.x.vsix`
- Windows on x64 processors: `vscode-confluent-windows-x64-x.x.x.vsix`

You can install the Confluent extension by using the VS Code UI or by using the
`code --install-extension` command in the terminal.

To install by using the UI with an online connection, follow these steps:

1. Download the VSIX file appropriate for your machine.

1. Open VS Code, and in the Sidebar, click **Extensions**.

1. At the top of the **Extensions** view, click **...**, and in the context menu, click **Install
   from VSIX…**

1. Navigate to your downloaded `vscode-confluent-vX.X.X.vsix` file and click **Install**.

To install in the terminal, run the following command:

```
code --install-extension /path/to/vscode-confluent-vX.X.X.vsix
```

### `.vsix` file installation via offvsix

If you have been struggling with pre-downloading extension payloads (and assuming you have
[python](https://www.python.org/), [pip](https://pypi.org/project/pip/), and
[offvsix](https://github.com/gni/offvsix), you can follow these steps:

```
mkdir offvsix
cd offvsix

python3 -m venv .
. bin/activate

pip install offvsix

offvsix confluentinc.vscode-confluent
```