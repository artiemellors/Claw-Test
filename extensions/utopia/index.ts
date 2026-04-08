import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { utopiaPlugin } from "./src/channel.js";
import { setUtopiaRuntime } from "./src/runtime.js";

const plugin = {
  id: "utopia",
  name: "Utopia",
  description: "Utopia decentralized messenger channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setUtopiaRuntime(api.runtime);
    api.registerChannel({ plugin: utopiaPlugin });
  },
};

export default plugin;
