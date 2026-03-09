/**
 * User Memory — user preferences and profiles.
 * Stores persistent information about the user for personalization.
 */

import type { MemoryStore } from "../repository/memory.js";

export interface UserPreference {
  key: string;
  value: string;
  category: string;
}

export interface UserProfile {
  name?: string;
  preferences: UserPreference[];
  context: Record<string, string>;
}

export class UserMemory {
  private store: MemoryStore;
  private agentId: string;

  constructor(store: MemoryStore, agentId: string = "default") {
    this.store = store;
    this.agentId = agentId;
  }

  setPreference(pref: UserPreference): string {
    const value = JSON.stringify(pref);
    const entry = this.store.createFromText(
      "user",
      `pref:${pref.category}:${pref.key}`,
      value,
      { createdBy: "human" }
    );
    return entry.id;
  }

  getPreference(category: string, key: string): UserPreference | null {
    const entries = this.store.getByKey(`pref:${category}:${key}`);
    if (entries.length === 0) return null;
    try {
      return JSON.parse(entries[0].value) as UserPreference;
    } catch {
      return null;
    }
  }

  getAllPreferences(): UserPreference[] {
    const entries = this.store.search("pref:", "user");
    return entries
      .map((e) => {
        try {
          return JSON.parse(e.value) as UserPreference;
        } catch {
          return null;
        }
      })
      .filter((p): p is UserPreference => p !== null);
  }

  setContext(key: string, value: string): string {
    const entry = this.store.createFromText(
      "user",
      `ctx:${key}`,
      value,
      { createdBy: "human" }
    );
    return entry.id;
  }

  getContext(key: string): string | null {
    const entries = this.store.getByKey(`ctx:${key}`);
    return entries.length > 0 ? entries[0].value : null;
  }

  buildProfile(): UserProfile {
    const prefs = this.getAllPreferences();
    const contextEntries = this.store.search("ctx:", "user");
    const context: Record<string, string> = {};
    for (const e of contextEntries) {
      const key = e.key.replace("ctx:", "");
      context[key] = e.value;
    }

    return {
      preferences: prefs,
      context,
    };
  }
}
