export type DockerFileKind = "dockerfile" | "docker-compose";

export interface DetectionResult {
  kind: DockerFileKind | "unknown";
  confidence: "high" | "medium" | "low";
  reason: string;
}

const COMPOSE_FILENAME = /^(docker[-_.])?compose([-_.].*)?\.ya?ml$/i;
const DOCKERFILE_FILENAME = /^dockerfile(\..+)?$/i;
const DOCKERFILE_SUFFIX = /\.dockerfile$/i;

const TOP_LEVEL_SERVICES = /^services\s*:\s*(?:#.*)?$/m;
const TOP_LEVEL_VERSION = /^version\s*:\s*["']?\d/m;
const COMPOSE_SHAPE = /^\s*(services|volumes|networks|configs|secrets)\s*:/m;

const SYNTAX_DIRECTIVE = /^#\s*syntax\s*=/i;
const DOCKERFILE_DIRECTIVE = /^(ARG\s+\S|FROM\s+\S)/i;

/**
 * Returns true if the first non-blank, non-comment line is a Dockerfile
 * directive such as `FROM` or `ARG`. `# syntax=...` BuildKit parser
 * directives at the top are also accepted as a strong signal.
 */
function looksLikeDockerfileBody(text: string): boolean {
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      if (SYNTAX_DIRECTIVE.test(line)) return true;
      continue;
    }
    return DOCKERFILE_DIRECTIVE.test(line);
  }
  return false;
}

/**
 * Returns true if the text contains a top-level `services:` (or other compose-only)
 * key at indent zero. We intentionally only accept indent-zero so a Dockerfile
 * with a comment like `# services: none` does not get mistaken for compose.
 */
function looksLikeComposeBody(text: string): boolean {
  if (TOP_LEVEL_SERVICES.test(text)) return true;
  if (TOP_LEVEL_VERSION.test(text) && COMPOSE_SHAPE.test(text)) return true;
  return false;
}

export function detectFileKind(
  filename: string,
  content: string,
  hint?: DockerFileKind,
): DetectionResult {
  const trimmed = (content ?? "").trim();

  if (trimmed) {
    const isCompose = looksLikeComposeBody(trimmed);
    const isDockerfile = looksLikeDockerfileBody(trimmed);

    if (isCompose && !isDockerfile) {
      return {
        kind: "docker-compose",
        confidence: "high",
        reason: "Top-level `services:` key detected.",
      };
    }
    if (isDockerfile && !isCompose) {
      return {
        kind: "dockerfile",
        confidence: "high",
        reason: "File starts with a Dockerfile directive (FROM / ARG / # syntax=).",
      };
    }
  }

  const base = (filename || "").split(/[\\/]/).pop() ?? "";
  if (COMPOSE_FILENAME.test(base)) {
    return {
      kind: "docker-compose",
      confidence: "medium",
      reason: `Filename \`${base}\` matches a docker-compose naming convention.`,
    };
  }
  if (DOCKERFILE_FILENAME.test(base) || DOCKERFILE_SUFFIX.test(base)) {
    return {
      kind: "dockerfile",
      confidence: "medium",
      reason: `Filename \`${base}\` matches a Dockerfile naming convention.`,
    };
  }

  if (hint) {
    return {
      kind: hint,
      confidence: "low",
      reason: "Falling back to the kind selected in the UI.",
    };
  }

  return {
    kind: "unknown",
    confidence: "low",
    reason:
      "Could not detect whether this is a Dockerfile or a docker-compose file. " +
      "Rename it to `Dockerfile` or `docker-compose.yml`, or pick the matching button.",
  };
}
