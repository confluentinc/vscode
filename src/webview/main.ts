/** This file runs in WebView. Beware of Node.js dependencies used here. */

import { provideVSCodeDesignSystem, allComponents } from "@vscode/webview-ui-toolkit";
import { handlePopoverPosition } from "./popover/popover";

// Linking css bundle entrypoint that will be processed by the build system
import "./main.css";

// Enable all components from the toolkit
provideVSCodeDesignSystem().register(allComponents);

// Enable automatic positioning of HTML popovers
handlePopoverPosition();
