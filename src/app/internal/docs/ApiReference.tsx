"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

// Private configuration: no telemetry, no CDN fonts, no external proxy, no try-it button, no AI agent/MCP.
export function ApiReference({ spec }: { spec: object }) {
  return (
    <ApiReferenceReact
      configuration={{
        content: spec,
        telemetry: false,
        withDefaultFonts: false,
        hideClientButton: true,
        hideTestRequestButton: true,
        showDeveloperTools: "never",
        agent: { disabled: true },
        mcp: { disabled: true },
        documentDownloadType: "json",
      }}
    />
  );
}
