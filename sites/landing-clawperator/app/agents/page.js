export const metadata = {
  title: "Clawperator for Agents",
  description: "Machine-oriented entrypoint for agents integrating with Clawperator.",
  openGraph: {
    title: "Clawperator for Agents",
    description: "Machine-oriented entrypoint for agents integrating with Clawperator.",
    siteName: "Clawperator",
    type: "website",
    images: [
      {
        url: "https://static.clawperator.com/img/share/clawperator_share_image.png",
        type: "image/png",
        width: 1200,
        height: 630,
        alt: "Clawperator share image"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "Clawperator for Agents",
    description: "Machine-oriented entrypoint for agents integrating with Clawperator.",
    images: ["https://static.clawperator.com/img/share/clawperator_share_image.png"]
  }
};

const links = [
  { href: "https://docs.clawperator.com/", label: "Technical docs home" },
  { href: "https://docs.clawperator.com/ai-agents/agent-quickstart/", label: "Agent quickstart" },
  { href: "https://docs.clawperator.com/ai-agents/node-api-for-agents/", label: "Node API guide" },
  { href: "https://docs.clawperator.com/reference/snapshot-format/", label: "Snapshot format" },
  { href: "https://docs.clawperator.com/design/operator-llm-playbook/", label: "Operator LLM playbook" },
  { href: "https://docs.clawperator.com/reference/api-overview/", label: "API overview" },
  { href: "https://docs.clawperator.com/reference/cli-reference/", label: "CLI reference" },
  { href: "https://docs.clawperator.com/getting-started/first-time-setup/", label: "First-time setup" },
  { href: "https://clawperator.com/install.sh", label: "Install script" },
  { href: "https://clawperator.com/llms-full.txt", label: "Full docs text corpus" },
  { href: "https://github.com/clawperator/clawperator", label: "GitHub repository" },
  { href: "https://github.com/clawperator/clawperator-skills", label: "Skills repository" }
];

const isExternalLink = (href) => href.startsWith("http://") || href.startsWith("https://");

export default function AgentsPage() {
  return (
    <main className="page-shell">
      <section className="content-section">
        <h1>Clawperator for Agents</h1>
        <p>
          Clawperator is a deterministic Android automation runtime for AI agents. It is the actuator layer: your
          external agent or LLM owns reasoning and planning, and Clawperator executes validated actions and returns
          structured results.
        </p>
        <p>
          Prefer the docs site for technical behavior. This page is a compact routing surface for agents and retrieval
          systems that need a low-noise starting point.
        </p>
        <div className="grid-2-col">
          <div>
            <h2>Key facts</h2>
            <ul>
              <li>Clawperator is an actuator, not an autonomous planner.</li>
              <li>The Node API and CLI are the canonical integration surfaces.</li>
              <li>Results are structured, deterministic, and machine-readable.</li>
              <li>A physical Android burner device is the preferred runtime target.</li>
            </ul>
          </div>
          <div>
            <h2>Primary links</h2>
            <ul>
              {links.map((link) => (
                <li key={link.href}>
                  <a href={link.href} target={isExternalLink(link.href) ? "_blank" : undefined} rel={isExternalLink(link.href) ? "noreferrer" : undefined}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="setup-note">
          <p>
            An agent-friendly markdown version of this page is available at <a href="/index.md">/index.md</a>.
          </p>
        </div>
      </section>
    </main>
  );
}
