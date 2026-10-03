"use client";

import { useEffect, useRef, useState } from "react";

const installCommands = {
  oneLiner: "curl -fsSL https://clawperator.com/install.sh | bash",
  npm: "npm install -g clawperator"
};

const agentSetupPrompt = "Read https://clawperator.com/skill.md and get me set up with Clawperator.";

const reliabilityCards = [
  {
    title: "Deterministic",
    body: "Each command does one thing, returns one result, and never hides retries."
  },
  {
    title: "Structured",
    body: "Agents get machine-readable UI state, explicit errors, and results they can branch on."
  },
  {
    title: "Built for loops",
    body: "Clawperator is designed for reasoning systems that need predictable execution, not best-effort automation."
  }
];

const workflowCards = [
  {
    title: "Home battery and energy apps",
    body: "Read Powerwall, battery, or inverter status from mobile-only apps and trigger actions when thresholds are crossed."
  },
  {
    title: "Google Home and thermostat control",
    body: "Check temperature, switch device state, and turn heating or cooling on without waiting for a public API that may never exist."
  },
  {
    title: "School app notification filtering",
    body: "Monitor a noisy school app, filter the clutter, and surface only the updates that actually matter."
  },
  {
    title: "Family location flows",
    body: "Check Life360-style apps and send updates or screenshots until someone gets home, then stop automatically."
  },
  {
    title: "Shopping, delivery, and status checks",
    body: "Build private workflows around grocery, courier, or account apps that only really exist as mobile interfaces."
  },
  {
    title: "App-only balances and alerts",
    body: "Pull statuses, balances, or alerts from user-installed Android apps that do not expose a usable public API."
  }
];

const resourceCards = [
  {
    title: "Discord",
    body: "Join the community",
    icon: "discord",
    disabled: true
  },
  {
    title: "Documentation",
    body: "Learn the ropes",
    href: "https://docs.clawperator.com",
    icon: "docs"
  },
  {
    title: "GitHub",
    body: "View the source",
    href: "https://github.com/clawperator/clawperator",
    icon: "github"
  },
  {
    title: "Skills",
    body: "Browse the skills section",
    href: "#skills",
    icon: "skills"
  }
];

const faqs = [
  {
    question: "Can I use this if I have an iPhone?",
    answer:
      "Yes. Clawperator does not require you to switch your primary phone to Android. The normal setup is to keep using your iPhone and connect your agent to a separate Android burner phone or a local Android emulator."
  },
  {
    question: "I do not have an Android phone. Can I still use Clawperator?",
    answer:
      "Yes. Clawperator can provision a local Google Play-equipped Android emulator. That is useful for getting started, local development, and many automation flows."
  },
  {
    question: "Do I need a dedicated burner phone?",
    answer:
      "A cheap dedicated burner phone is the preferred setup for compatibility and long-running reliability, but it is not the only option. A local Android emulator is available when you do not have a device handy."
  },
  {
    question: "What if the skill I need does not exist yet?",
    answer:
      "That is fine. Clawperator includes a growing open source skills library, but you are not blocked on prebuilt skills. Your agent can use Clawperator's structured, documented API to explore an app, operate it, and build a private skill for your own workflow."
  },
  {
    question: "Does Clawperator do the thinking for my agent?",
    answer:
      "No. The agent decides what to do next. Clawperator executes validated Android actions and returns structured results."
  }
];

export default function Home() {
  const [mode, setMode] = useState("oneLiner");
  const [copied, setCopied] = useState(false);
  const [emulatorCommandCopied, setEmulatorCommandCopied] = useState(false);
  const [agentPromptCopied, setAgentPromptCopied] = useState(false);
  const [activeSection, setActiveSection] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeCommand = mode === "npm" ? installCommands.npm : installCommands.oneLiner;
  const emulatorCommand = "clawperator emulator provision";

  const sectionIds = ["install", "skills", "how-it-works", "faq"];
  const sectionLabels = {
    install: "Install",
    skills: "Skills",
    "how-it-works": "How it works",
    faq: "FAQ"
  };

  const copyTimeoutRef = useRef(null);
  const emulatorCopyTimeoutRef = useRef(null);
  const agentPromptCopyTimeoutRef = useRef(null);
  const toggleMobileMenu = () => setMobileMenuOpen((open) => !open);
  const closeMobileMenu = () => setMobileMenuOpen(false);
  const renderResourceIcon = (icon) => {
    switch (icon) {
      case "discord":
        return (
          <svg viewBox="0 0 64 48" aria-hidden="true">
            <path
              d="M40.575 0C39.9562 1.09866 39.4006 2.2352 38.8954 3.397C34.0967 2.67719 29.2096 2.67719 24.3982 3.397C23.9057 2.2352 23.3374 1.09866 22.7186 0C18.2104 0.770324 13.8157 2.12155 9.64839 4.02841C1.38951 16.2652 -0.845688 28.1863 0.265599 39.9432C5.10222 43.517 10.5197 46.2447 16.2909 47.9874C17.5916 46.2447 18.7407 44.3883 19.7257 42.4562C17.8568 41.7616 16.0509 40.8903 14.3208 39.88C14.7755 39.5517 15.2175 39.2107 15.6468 38.8824C25.7873 43.6559 37.5316 43.6559 47.6847 38.8824C48.1141 39.236 48.5561 39.577 49.0107 39.88C47.2806 40.9029 45.4748 41.7616 43.5931 42.4688C44.5781 44.4009 45.7273 46.2573 47.028 48C52.7991 46.2573 58.2167 43.5422 63.0533 39.9684C64.3666 26.3299 60.8055 14.5099 53.6452 4.04104C49.4905 2.13418 45.0959 0.782952 40.5876 0.0252565L40.575 0ZM21.1401 32.7072C18.0209 32.7072 15.4321 29.8785 15.4321 26.3804C15.4321 22.8824 17.9199 20.041 21.1275 20.041C24.3351 20.041 26.886 22.895 26.8354 26.3804C26.7849 29.8658 24.3224 32.7072 21.1401 32.7072ZM42.1788 32.7072C39.047 32.7072 36.4834 29.8785 36.4834 26.3804C36.4834 22.8824 38.9712 20.041 42.1788 20.041C45.3864 20.041 47.9246 22.895 47.8741 26.3804C47.8236 29.8658 45.3611 32.7072 42.1788 32.7072Z"
              fill="currentColor"
            />
          </svg>
        );
      case "docs":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M7 4.5h7.5L18 8v11.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="M14.5 4.5V8H18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M9 11h6M9 14h6M9 17h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        );
      case "github":
        return (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M6.766 11.695C4.703 11.437 3.25 9.904 3.25 7.92c0-.806.281-1.677.75-2.258-.203-.532-.172-1.662.062-2.129.626-.081 1.469.258 1.969.726.594-.194 1.219-.291 1.985-.291.765 0 1.39.097 1.953.274.484-.451 1.343-.79 1.969-.709.218.435.25 1.564.046 2.113.5.613.766 1.436.766 2.274 0 1.984-1.453 3.485-3.547 3.759.531.355.891 1.129.891 2.016v1.678c0 .484.39.758.859.564C13.781 14.824 16 11.905 16 8.291 16 3.726 12.406 0 7.984 0 3.562 0 0 3.726 0 8.291c0 3.581 2.203 6.55 5.172 7.663A.595.595 0 0 0 6 15.389v-1.291c-.219.097-.5.162-.75.162-1.031 0-1.641-.581-2.078-1.662-.172-.435-.36-.693-.719-.742-.187-.016-.25-.097-.25-.193 0-.194.313-.339.625-.339.453 0 .844.29 1.25.887.313.468.641.678 1.031.678.391 0 .641-.146 1-.516.266-.275.469-.517.657-.678Z"
              fill="currentColor"
            />
          </svg>
        );
      case "skills":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3.5 4.5 7.3v5.4c0 4.3 3 7.3 7.5 7.8 4.5-.5 7.5-3.5 7.5-7.8V7.3L12 3.5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <path d="m9.5 12 1.5 1.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
      default:
        return null;
    }
  };

  const copyToClipboard = async (text, setCopiedState, timeoutRef) => {
    const fallbackCopy = () => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);
      return successful;
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        if (!fallbackCopy()) throw new Error("Fallback copy failed");
      }
    } catch {
      try {
        if (!fallbackCopy()) {
          setCopiedState(false);
          return;
        }
      } catch {
        setCopiedState(false);
        return;
      }
    }

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
    
    setCopiedState(true);
    timeoutRef.current = window.setTimeout(() => {
      setCopiedState(false);
      timeoutRef.current = null;
    }, 1200);
  };

  const handleCopy = () => copyToClipboard(activeCommand, setCopied, copyTimeoutRef);
  const handleEmulatorCommandCopy = () => copyToClipboard(emulatorCommand, setEmulatorCommandCopied, emulatorCopyTimeoutRef);
  const handleAgentPromptCopy = () => copyToClipboard(agentSetupPrompt, setAgentPromptCopied, agentPromptCopyTimeoutRef);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
      if (emulatorCopyTimeoutRef.current) window.clearTimeout(emulatorCopyTimeoutRef.current);
      if (agentPromptCopyTimeoutRef.current) window.clearTimeout(agentPromptCopyTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleResize = () => {
      if (window.innerWidth > 840) {
        setMobileMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const toolbarRef = useRef(null);

  useEffect(() => {
    let frame = null;

    const updateActiveSection = () => {
      const toolbarHeight = toolbarRef.current?.offsetHeight || 80;
      // Use a focus line below the toolbar so a section becomes active when it is
      // meaningfully on screen, not the instant a heading peeks into view.
      const focusY = window.scrollY + toolbarHeight + Math.min(window.innerHeight * 0.22, 180);
      const docBottom = window.scrollY + window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;

      // Last section needs a bottom-of-page fallback because the FAQ heading may
      // never climb near the toolbar on shorter pages.
      if (docBottom >= docHeight - 48) {
        setActiveSection("faq");
        return;
      }

      let nextActive = null;
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top + window.scrollY;
        if (focusY >= top) {
          nextActive = id;
        } else {
          break;
        }
      }

      setActiveSection(nextActive);
    };

    const requestUpdate = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        updateActiveSection();
      });
    };

    requestUpdate();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!activeSection) {
      if (!window.location.hash) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      return;
    }

    const nextHash = `#${activeSection}`;
    if (window.location.hash === nextHash) return;
    window.history.replaceState(null, "", nextHash);
  }, [activeSection]);

  return (
    <>
      <header ref={toolbarRef} className="top-toolbar">
        <div className="top-toolbar-inner">
          <a href="#top" className="toolbar-brand">
            <img src="/clawperator-logo.png" alt="" aria-hidden="true" className="toolbar-logo" />
            <span className="toolbar-brand-stack">
              <span className="toolbar-brand-text">Clawperator</span>
              <span className="toolbar-subtitle">Android automation for agents</span>
            </span>
          </a>

          <button
            type="button"
            className={mobileMenuOpen ? "mobile-menu-btn active" : "mobile-menu-btn"}
            aria-expanded={mobileMenuOpen}
            aria-controls="toolbar-menu"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={toggleMobileMenu}
          >
            <span />
            <span />
            <span />
          </button>

          <nav
            id="toolbar-menu"
            className={mobileMenuOpen ? "toolbar-links mobile-open" : "toolbar-links"}
            aria-label="Page sections"
          >
            {sectionIds.map((id) => (
              <a
                key={id}
                href={`#${id}`}
                className={activeSection === id ? "toolbar-section-link active" : "toolbar-section-link"}
                onClick={closeMobileMenu}
              >
                {sectionLabels[id] || id}
              </a>
            ))}
            <a href="https://docs.clawperator.com" target="_blank" rel="noreferrer" onClick={closeMobileMenu}>
              Docs
            </a>
            <a
              href="https://github.com/clawperator/clawperator"
              target="_blank"
              rel="noreferrer"
              className="toolbar-cta"
              onClick={closeMobileMenu}
            >
              GitHub
            </a>
          </nav>
        </div>
      </header>
      <button
        type="button"
        className={mobileMenuOpen ? "mobile-menu-scrim open" : "mobile-menu-scrim"}
        aria-label="Close navigation menu"
        aria-hidden={!mobileMenuOpen}
        tabIndex={mobileMenuOpen ? 0 : -1}
        onClick={closeMobileMenu}
      />

      <main className="page-shell">
      {/* Hero Section */}
      <section id="top" className="hero-card">
        <div className="hero-waterfall">
          <p className="hero-problem">Many services don&apos;t have APIs…<br />But they do have apps!</p>
          <img src="/clawperator-logo.png" alt="" aria-hidden="true" className="hero-logo" />
          <p className="hero-product-name">Clawperator</p>
          <h1 className="hero-catchphrase">
            PLAYWRIGHT-STYLE AUTOMATION
            <br />
            FOR ANDROID APPS.
          </h1>
          <p className="hero-category-line">Clawperator gives agents direct control of real Android apps.</p>
          <p className="hero-summary">
            Clawperator is a deterministic execution layer that lets agents run skills on real Android apps to read data and take action on behalf of users.
          </p>
          <div className="hero-video-embed">
            <iframe
              src="https://www.youtube-nocookie.com/embed/lQnMRqi6Zag?rel=0&modestbranding=1"
              title="Clawperator introduction video"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <p className="hero-summary hero-summary-secondary">
            Keep using your iPhone. Use a dedicated Android &quot;burner&quot; device, or let Clawperator create a Google
            Play-equipped emulator that runs all your apps.
          </p>

          <p className="hero-brain-hand">
            Your OpenClaw/agent is the brain.
            <br />
            Clawperator is the hand.
            <br />
            Repeatable app flows become skills, so automations can be packaged and run again.
          </p>

          <div className="hero-image-panel">
            <h2 className="hero-image-heading">Agents operate real apps</h2>
            <img
              src="https://static.clawperator.com/img/hero/clawperator-hero-2x2.webp"
              alt="Diagram showing how OpenClaw and Clawperator let AI agents control real Android apps and return results to chat. This image was made with human claws."
              title="this image was made with human claws"
              width="2160"
              height="2300"
              className="hero-diagram"
            />
            <p className="hero-image-caption">Automate any Android app. No API required.</p>
          </div>

          <div className="resource-grid" aria-label="Primary resources">
            {resourceCards.map((card) => {
              const classes = card.disabled ? "resource-card disabled" : "resource-card";
              const content = (
                <>
                  <span className="resource-icon">{renderResourceIcon(card.icon)}</span>
                  <span className="resource-title">{card.title}</span>
                  <span className="resource-copy">{card.body}</span>
                </>
              );

              if (card.disabled) {
                return (
                  <div key={card.title} className={classes} aria-disabled="true">
                    {content}
                  </div>
                );
              }

              return (
                <a key={card.title} href={card.href} className={classes} target={card.href.startsWith("http") ? "_blank" : undefined} rel={card.href.startsWith("http") ? "noreferrer" : undefined}>
                  {content}
                </a>
              );
            })}
          </div>
        </div>

      <section id="workflows" className="content-section">
        <h2>What you can do with Clawperator</h2>
        <p className="workflow-subtitle">
          Clawperator is most useful where the real interface only exists in a mobile app.
        </p>

        <div className="workflow-cards">
          {workflowCards.map((card) => (
            <article key={card.title} className="workflow-card workflow-card-simple">
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

        <div className="quickstart-intro">
          <h2 id="install">Quick Start</h2>
          <p>
            One command installs the CLI, fetches the latest Clawperator Operator Android app, verifies it, and helps
            prepare an Android device for your agent.
          </p>
        </div>

        <div className="agent-prompt-block">
          <p className="quickstart-hint">Tell your agent to:</p>
          <div className="command-row">
            <pre>
              <code>{agentSetupPrompt}</code>
            </pre>
            <button
              type="button"
              className={agentPromptCopied ? "copy-btn copied" : "copy-btn"}
              onClick={handleAgentPromptCopy}
              title={agentPromptCopied ? "Copied" : "Copy agent prompt"}
            >
              <span className="copy-btn-label">{agentPromptCopied ? "Copied" : "Copy agent prompt"}</span>
              {agentPromptCopied ? (
                <svg viewBox="0 0 24 24" focusable="false">
                  <path
                    d="M20 7L9 18l-5-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" focusable="false">
                  <rect x="9" y="9" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
                  <rect x="4" y="4" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="quickstart-block" aria-label="Quickstart terminal">
          <div className="quickstart-top">
            <div className="traffic-lights" aria-hidden="true">
              <span className="dot red" />
              <span className="dot yellow" />
              <span className="dot green" />
            </div>

            <div className="mode-switcher" role="tablist" aria-label="Install mode">
              <button
                type="button"
                className={mode === "oneLiner" ? "mode-btn active" : "mode-btn"}
                onClick={() => setMode("oneLiner")}
                role="tab"
                aria-selected={mode === "oneLiner"}
              >
                One-liner
              </button>
              <button
                type="button"
                className={mode === "npm" ? "mode-btn active" : "mode-btn"}
                onClick={() => setMode("npm")}
                role="tab"
                aria-selected={mode === "npm"}
              >
                npm
              </button>
            </div>
          </div>

          <div className="quickstart-command">
            <p className="quickstart-hint"># Install Clawperator on macOS/Linux</p>
            <div className="command-row">
              <pre>
                <code>{activeCommand}</code>
              </pre>
              <button
                type="button"
                className={copied ? "copy-btn copied" : "copy-btn"}
                onClick={handleCopy}
                aria-label={copied ? "Copied" : "Copy command"}
                title={copied ? "Copied" : "Copy command"}
              >
                {copied ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M20 7L9 18l-5-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="9" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
                    <rect x="4" y="4" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div className="quickstart-command">
            <p className="quickstart-hint">
              No Android device handy? Have Clawperator create a Google Play equipped Android emulator.
            </p>
            <div className="command-row">
              <pre>
                <code>{emulatorCommand}</code>
              </pre>
              <button
                type="button"
                className={emulatorCommandCopied ? "copy-btn copied" : "copy-btn"}
                onClick={handleEmulatorCommandCopy}
                aria-label={emulatorCommandCopied ? "Copied" : "Copy command"}
                title={emulatorCommandCopied ? "Copied" : "Copy command"}
              >
                {emulatorCommandCopied ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M20 7L9 18l-5-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="9" y="9" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
                    <rect x="4" y="4" width="11" height="11" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        <p className="quickstart-docs">
          Clawperator has comprehensive documentation, setup guides, and API references at{" "}
          <a href="https://docs.clawperator.com" target="_blank" rel="noreferrer">
            docs.clawperator.com
          </a>
          .
        </p>

        <div className="agent-entry-strip" aria-label="For agents">
          <p className="agent-entry-title">For agents</p>
          <p className="agent-entry-copy">
            Prefer the technical docs over this overview page. Start with the{" "}
            <a href="https://docs.clawperator.com/ai-agents/node-api-for-agents/" target="_blank" rel="noreferrer">
              Node API guide
            </a>
            , the{" "}
            <a href="https://docs.clawperator.com/design/operator-llm-playbook/" target="_blank" rel="noreferrer">
              Operator LLM playbook
            </a>
            , or the machine-oriented <a href="/index.md">markdown landing page</a>.
          </p>
          <div className="agent-entry-links">
            <a href="/agents">/agents</a>
            <span className="agent-entry-sep">·</span>
            <a href="/index.md">/index.md</a>
            <span className="agent-entry-sep">·</span>
            <a href="https://docs.clawperator.com/reference/cli-reference/" target="_blank" rel="noreferrer">
              CLI reference
            </a>
            <span className="agent-entry-sep">·</span>
            <a href="https://docs.clawperator.com/reference/api-overview/" target="_blank" rel="noreferrer">
              API overview
            </a>
            <span className="agent-entry-sep">·</span>
            <a href="https://docs.clawperator.com/api/mcp/" target="_blank" rel="noreferrer">
              MCP server
            </a>
          </div>
        </div>
      </section>

      <section id="reliability" className="feature-grid">
        <div className="feature-intro">
          <h2>Built for agent loops</h2>
          <p>More than UI automation. Each command does one thing, returns one result, and never hides retries.</p>
          <div className="contract-strip">
            <span>action</span>
            <span className="contract-arrow">&rarr;</span>
            <span>execution</span>
            <span className="contract-arrow">&rarr;</span>
            <span>structured result</span>
          </div>
          <div className="loop-example">
            <p className="loop-example-label">
              Example agent loop (see{" "}
              <a href="https://docs.clawperator.com" target="_blank" rel="noreferrer">
                docs.clawperator.com
              </a>{" "}
              for the full API)
            </p>
            <pre>
              <code>{`##
## Runtime skill path:
##

clawperator skills run <hvac-app>.set-power -- --climate-state on --unit-name "Living room"

##
## Or, agent-driven control path:
##

clawperator open --app <hvac-app>

clawperator snapshot    # Get the current UI state as structured JSON.
# { "ui_tree": [...] }

# 🧠 agent: Inspect the snapshot, determine commands to run next.

clawperator click --text "Climate"
clawperator scroll-and-click --text-contains "Living room"

clawperator read --id ":id/power_state"
# { "text": "Off" }

# 🧠 agent: Power is off; target climate state is on.

clawperator click --id ":id/power_button"`}</code>
            </pre>
          </div>
        </div>

        {reliabilityCards.map((feature) => (
          <article key={feature.title} className="feature-card">
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </article>
        ))}
      </section>

      <section id="skills" className="content-section">
        <h2>Skills</h2>
        <p>
          Clawperator automations are unlocked through skills.
        </p>
        <p>
          Clawperator includes an{" "}
          <a href="https://github.com/clawperator/clawperator-skills" target="_blank" rel="noreferrer">
            open source, ever-expanding skills repository
          </a>{" "}
          for common Android workflows.
        </p>
        <p>
          But you are not blocked waiting for an official skill. Agents do not need a prebuilt skill to automate your
          apps.
        </p>
        <p>
          Our dedicated build-your-own-skill-from-scratch documentation walks agents through the process step by step.
          Point your agent at the right app and tell it to make a skill. It can use the <code>clawperator</code> API
          to inspect the app&apos;s UI, find a reliable path to the state or action you need, and create a private,
          personalized skill for your exact workflow.
        </p>

        <div className="grid-2-col">
          <div>
            <h3>Included with install</h3>
            <ul>
              <li>Open source skills repository</li>
              <li>Reusable building blocks for common workflows</li>
              <li>Discoverable and runnable through the same runtime</li>
            </ul>
          </div>
          <div>
            <h3>Yours to create</h3>
            <ul>
              <li>Private skills for your own apps and accounts</li>
              <li>Agent-built skills from live app exploration</li>
              <li>Public and private skills mixed in the same runtime</li>
            </ul>
          </div>
        </div>

        <div className="setup-note">
          <p>
            <strong>You are not blocked waiting for a public skill.</strong> Start with included skills, adapt them to
            your setup, or let your agent create private ones through Clawperator&apos;s documented API.
          </p>
        </div>
      </section>

      <section id="how-it-works" className="content-section architecture-section loop-section">
        <h2>How it actually works</h2>
        <p>
          Your agent is the brain. Clawperator is the hand. Skills sit above the runtime as reusable app-specific
          workflows. Whether the agent runs a skill or drives the UI step by step, Clawperator is the execution layer
          that talks to the Android device and returns structured results.
        </p>
        <div className="architecture-strip">
          <article className="architecture-card architecture-card-edge">
            <div className="architecture-card-stack">
              <p className="architecture-label">AI Agent / LLM</p>
              <p className="architecture-meta">the brain</p>
            </div>
          </article>
          <div className="architecture-connector">
            <span className="architecture-line" />
            <span className="architecture-text">Node API / CLI / MCP / Skills</span>
          </div>
          <article className="architecture-card architecture-card-core">
            <div className="architecture-card-stack">
              <p className="architecture-label">Clawperator</p>
              <p className="architecture-meta">runtime / hand</p>
            </div>
          </article>
          <div className="architecture-connector">
            <span className="architecture-line" />
            <span className="architecture-text">ADB</span>
          </div>
          <article className="architecture-card architecture-card-core">
            <div className="architecture-card-stack">
              <p className="architecture-label">Android Device</p>
              <p className="architecture-meta">physical or emulator</p>
            </div>
          </article>
          <div className="architecture-connector">
            <span className="architecture-line" />
          </div>
          <article className="architecture-card architecture-card-edge">
            <div className="architecture-card-stack">
              <p className="architecture-label">Mobile Apps</p>
              <p className="architecture-meta">the app is the api</p>
            </div>
          </article>
        </div>
        <p>
          The runtime includes the CLI on your host machine and the Clawperator Operator Android app on the Android
          device. The agent decides what to do next. Skills give the agent reusable ways to handle app-specific
          workflows it already understands, whether those come from the open source skills repository or from private
          skills the agent created for you. Clawperator executes the Android side of the workflow and returns data your
          agent can use.
        </p>
        <div className="grid-2-col">
          <div>
            <h3>When a skill exists</h3>
            <ul>
              <li>The agent picks a skill for a known app workflow</li>
              <li>The skill packages the reliable path to the state or action needed</li>
              <li>Clawperator still executes the underlying Android actions and returns the result</li>
            </ul>
          </div>
          <div>
            <h3>When no skill exists yet</h3>
            <ul>
              <li>The agent opens the app and inspects the live UI</li>
              <li>It finds a reliable path step by step using the documented API</li>
              <li>Once the flow is understood, it can turn that path into a private skill</li>
            </ul>
          </div>
        </div>
        <p>The operating loop is simple: observe, decide, execute, return.</p>

        <div className="loop-steps" aria-label="Clawperator hand loop">
          <article className="loop-step">
            <p className="loop-index">01</p>
            <div>
              <h3>Observe</h3>
              <p>Capture the current Android UI as structured state so the agent can reason on a real snapshot of the app.</p>
            </div>
          </article>

          <article className="loop-step">
            <p className="loop-index">02</p>
            <div>
              <h3>Decide</h3>
              <p>The agent chooses the next action or runs a skill. Clawperator does not plan, improvise, or decide on its own.</p>
            </div>
          </article>

          <article className="loop-step">
            <p className="loop-index">03</p>
            <div>
              <h3>Execute</h3>
              <p>Clawperator performs the requested tap, type, scroll, read, or app action on the connected Android device.</p>
            </div>
          </article>

          <article className="loop-step">
            <p className="loop-index">04</p>
            <div>
              <h3>Return</h3>
              <p>Return one machine-readable result so the agent can continue, recover, or stop with confidence.</p>
            </div>
          </article>
        </div>
      </section>

      <section id="faq" className="content-section faq-section">
        <h2>FAQ</h2>
        <div className="faq-list">
          {faqs.map((item) => (
            <details key={item.question} className="faq-item">
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

        <footer className="site-footer">
          <p className="footer-title">Clawperator</p>
          <p className="footer-copy">
            Open source execution infrastructure for agent-driven Android burner-device workflows.
          </p>
          <nav className="footer-links" aria-label="Footer links">
            <a href="https://docs.clawperator.com" target="_blank" rel="noreferrer">
              docs
            </a>
            <span className="dot" aria-hidden="true">
              ·
            </span>
            <a href="https://github.com/clawperator/clawperator/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer">
              release notes
            </a>
            <span className="dot" aria-hidden="true">
              ·
            </span>
            <a href="https://github.com/clawperator/clawperator" target="_blank" rel="noreferrer">
              github
            </a>
            <span className="dot" aria-hidden="true">
              ·
            </span>
            <a href="https://www.npmjs.com/package/clawperator" target="_blank" rel="noreferrer">
              npm
            </a>
          </nav>
          <p className="footer-tagline">
            Built with human claws by{" "}
            <a href="https://x.com/chrismlacy" target="_blank" rel="noreferrer">
              @chrismlacy
            </a>
            {" "}and a scrappy crew of bots.
          </p>
          <p className="footer-copyright">© 2026 Action Launcher Pty Ltd</p>
        </footer>
      </main>
    </>
  );
}
