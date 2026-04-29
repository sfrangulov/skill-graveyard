import { homedir } from "node:os";
import { join } from "node:path";

export interface ClaudePaths {
  claudeDir: string;
  projectsDir: string;
  pluginsDir: string;
  installedPluginsJson: string;
  userSkillsDir: string;
  agentsSkillsDir: string;
}

export function resolveClaudePaths(claudeDir?: string): ClaudePaths {
  const root = claudeDir ?? join(homedir(), ".claude");
  return {
    claudeDir: root,
    projectsDir: join(root, "projects"),
    pluginsDir: join(root, "plugins"),
    installedPluginsJson: join(root, "plugins", "installed_plugins.json"),
    userSkillsDir: join(root, "skills"),
    agentsSkillsDir: join(homedir(), ".agents", "skills"),
  };
}
