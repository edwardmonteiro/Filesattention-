/**
 * Path resolution and namespace management for AFS.
 * All context sources are mapped into a unified hierarchical namespace.
 */

export interface NamespaceEntry {
  path: string;
  resolverName: string;
  mountPoint: string;
}

export class NamespaceManager {
  private mounts: Map<string, string> = new Map(); // mountPoint -> resolverName

  mount(mountPoint: string, resolverName: string): void {
    const normalized = this.normalize(mountPoint);
    this.mounts.set(normalized, resolverName);
  }

  unmount(mountPoint: string): void {
    const normalized = this.normalize(mountPoint);
    this.mounts.delete(normalized);
  }

  resolve(path: string): NamespaceEntry | null {
    const normalized = this.normalize(path);

    // Find the longest matching mount point
    let bestMatch = "";
    let bestResolver = "";

    for (const [mount, resolver] of this.mounts) {
      if (normalized.startsWith(mount) && mount.length > bestMatch.length) {
        bestMatch = mount;
        bestResolver = resolver;
      }
    }

    if (!bestMatch) return null;

    return {
      path: normalized,
      resolverName: bestResolver,
      mountPoint: bestMatch,
    };
  }

  listMounts(): Array<{ mountPoint: string; resolverName: string }> {
    return Array.from(this.mounts.entries()).map(([mountPoint, resolverName]) => ({
      mountPoint,
      resolverName,
    }));
  }

  normalize(path: string): string {
    // Ensure leading slash, remove trailing slash, collapse double slashes
    let normalized = path.replace(/\/+/g, "/");
    if (!normalized.startsWith("/")) normalized = "/" + normalized;
    if (normalized.length > 1 && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  }

  /**
   * Get the relative path within a mount point.
   */
  relativePath(fullPath: string, mountPoint: string): string {
    const normalizedFull = this.normalize(fullPath);
    const normalizedMount = this.normalize(mountPoint);
    const relative = normalizedFull.slice(normalizedMount.length);
    return relative || "/";
  }
}
