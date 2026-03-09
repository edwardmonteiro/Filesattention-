/**
 * ACL enforcement for AFS operations.
 * Controls which agents/users can access which paths.
 */

export interface AccessRequest {
  actor: string;
  operation: "read" | "write" | "exec" | "list" | "search";
  path: string;
}

export interface AccessRule {
  path: string;        // glob pattern
  actors: string[];    // allowed actors ("*" = everyone)
  operations: string[];
  allow: boolean;
}

export class AccessControl {
  private rules: AccessRule[] = [];

  addRule(rule: AccessRule): void {
    this.rules.push(rule);
  }

  removeRule(path: string): void {
    this.rules = this.rules.filter((r) => r.path !== path);
  }

  check(request: AccessRequest): boolean {
    // Find matching rules, most specific first
    const matchingRules = this.rules
      .filter((rule) => this.pathMatches(request.path, rule.path))
      .sort((a, b) => b.path.length - a.path.length);

    if (matchingRules.length === 0) {
      // Default: allow if no rules defined
      return true;
    }

    for (const rule of matchingRules) {
      const actorMatch =
        rule.actors.includes("*") || rule.actors.includes(request.actor);
      const opMatch =
        rule.operations.includes("*") ||
        rule.operations.includes(request.operation);

      if (actorMatch && opMatch) {
        return rule.allow;
      }
    }

    return true; // Default allow
  }

  private pathMatches(path: string, pattern: string): boolean {
    if (pattern === "*" || pattern === "/**") return true;

    // Simple prefix matching for directory patterns
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return path.startsWith(prefix);
    }

    // Exact match
    return path === pattern;
  }

  listRules(): AccessRule[] {
    return [...this.rules];
  }
}
