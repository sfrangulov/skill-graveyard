import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
  const homeRoot = claudeDir ? dirname(root) : homedir();
  return {
    claudeDir: root,
    projectsDir: join(root, "projects"),
    pluginsDir: join(root, "plugins"),
    installedPluginsJson: join(root, "plugins", "installed_plugins.json"),
    userSkillsDir: join(root, "skills"),
    agentsSkillsDir: join(homeRoot, ".agents", "skills"),
  };
}
