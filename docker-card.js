/*
 * Docker Card
 * A minimal Lovelace custom card to monitor and control Docker containers.
 */


(function () {
  const CARD_NAME = "docker-card";
  const CARD_DESCRIPTION = "Modern Docker container overview with start/stop toggles and restart actions.";
  const DEFAULT_LANGUAGE = "en";
  const DEFAULT_TRANSLATIONS = {
    common: {
      card_title: "Docker Card",
      container: "container",
      containers: "Containers",
      ungrouped: "Ungrouped",
    },
    placeholders: {
      waiting: "Waiting for Home Assistant…",
      no_containers: "No containers configured.",
    },
    overview: {
      running_total: "Running / Total",
      images: "Images",
      docker: "Docker",
      os: "OS",
      running_total_aria: "Open running containers details",
      images_aria: "Open Docker images details",
      docker_aria: "Open Docker version details",
      os_aria: "Open operating system details",
    },
    aria: {
      open_status_details: "Open Docker status details",
      collapse_containers: "Collapse container list",
      expand_containers: "Expand container list",
      collapse_group: "Collapse {name}",
      expand_group: "Expand {name}",
      stack_toggle: "Start or stop {name}",
    },
    resources: {
      cpu: "CPU",
      memory: "Memory"
    },
    actions: {
      start: "start",
      stop: "stop",
      restart: "Restart",
      pause: "Pause",
      resume: "Resume",
      kill: "Kill",
      recreate: "Recreate",
      update: "Update",
      start_container: "Start container",
      stop_container: "Stop container",
      more: "More actions",
      confirm: "Confirm {action}?",
      open_in_portainer: "Open in Portainer",
      prune_images: "Prune unused images",
      prune_volumes: "Prune unused volumes",
      host_actions: "Host actions",
    },
    badges: {
      update_available: "Update",
      update_available_aria: "An image update is available for {name}",
      health_aria: "Container health: {state}",
      installing: "Installing…",
    },
    health: {
      healthy: "Healthy",
      unhealthy: "Unhealthy",
      starting: "Starting",
    },
    notifications: {
      starting: "Starting {name}…",
      stopping: "Stopping {name}…",
      failed_start: "Failed to start {name}. Check logs.",
      failed_stop: "Failed to stop {name}. Check logs.",
      missing_toggle: "No service configured to {action} {name}.",
      missing_action: "No {action} service configured for {name}.",
      pending: {
        restart: "Restarting {name}…",
        pause: "Pausing {name}…",
        resume: "Resuming {name}…",
        kill: "Killing {name}…",
        recreate: "Recreating {name}…",
        update: "Updating {name}…",
        prune_images: "Pruning unused images…",
        prune_volumes: "Pruning unused volumes…",
      },
      failed: {
        restart: "Failed to restart {name}.",
        pause: "Failed to pause {name}.",
        resume: "Failed to resume {name}.",
        kill: "Failed to kill {name}.",
        recreate: "Failed to recreate {name}.",
        update: "Failed to update {name}.",
        prune_images: "Failed to prune images.",
        prune_volumes: "Failed to prune volumes.",
      },
    },
    status: {
      online: "Online",
      offline: "Offline",
      idle: "Idle",
      running: "Running",
      stopped: "Stopped",
      unknown: "Unknown",
      starting: "Starting",
      degraded: "Degraded",
      paused: "Paused",
    },
  };
  const TRANSLATION_CACHE = new Map([[DEFAULT_LANGUAGE, DEFAULT_TRANSLATIONS]]);
  const TRANSLATION_PROMISES = new Map();
  const MODULE_BASE_URL = (() => {
    if (typeof document === "undefined") {
      return undefined;
    }
    const script = document.currentScript;
    if (script && script.src) {
      try {
        const url = new URL(script.src, typeof window !== "undefined" ? window.location.href : undefined);
        url.hash = "";
        url.search = "";
        url.pathname = url.pathname.replace(/[^/]+$/, "");
        return url.toString();
      } catch (error) {
        console.warn("docker-card: Unable to determine base URL for translations", error);
      }
    }
    return undefined;
  })();

  if (typeof window !== "undefined") {
    window.customCards = window.customCards || [];
    if (!window.customCards.some((card) => card.type === CARD_NAME)) {
      window.customCards.push({
        type: CARD_NAME,
        name: "Docker Card",
        description: CARD_DESCRIPTION,
        preview: false,
      });
    }
  }

  const domainFromEntityId = (entityId) => {
    if (typeof entityId !== "string") {
      return undefined;
    }
    const separatorIndex = entityId.indexOf(".");
    if (separatorIndex <= 0) {
      return undefined;
    }
    return entityId.slice(0, separatorIndex);
  };

  const TOGGLE_SERVICE_MAP = {
    switch: { on: "turn_on", off: "turn_off" },
    input_boolean: { on: "turn_on", off: "turn_off" },
    automation: { on: "turn_on", off: "turn_off" },
    script: { on: "turn_on", off: "turn_off" },
    light: { on: "turn_on", off: "turn_off" },
    fan: { on: "turn_on", off: "turn_off" },
  };

  // Domains that can be "pressed" to run a one-shot container action.
  const ACTION_SERVICE_MAP = {
    button: { service: "press" },
    switch: { service: "turn_on" },
    script: { service: "turn_on" },
    automation: { service: "trigger" },
  };

  // Every lifecycle action shares one grammar: <key>_entity / <key>_domain /
  // <key>_service. `restart` is the original and keeps working unchanged.
  const CONTAINER_ACTIONS = [
    { key: "restart", icon: "mdi:restart" },
    { key: "resume", icon: "mdi:play" },
    { key: "pause", icon: "mdi:pause" },
    { key: "update", icon: "mdi:package-up", domain: "update", service: "install", destructive: true },
    { key: "recreate", icon: "mdi:autorenew", destructive: true },
    { key: "kill", icon: "mdi:skull-outline", destructive: true },
  ];
  const CONTAINER_ACTION_KEYS = CONTAINER_ACTIONS.map((action) => action.key);
  const ACTION_BY_KEY = new Map(CONTAINER_ACTIONS.map((action) => [action.key, action]));

  // States where something is already happening, so the switch would only
  // fight the daemon. `paused` is deliberately absent: stopping is still valid.
  const IN_FLIGHT_STATES = ["restarting", "removing", "starting"];

  const DEFAULT_RUNNING_STATES = ["running", "on", "started", "up"];
  const DEFAULT_STOPPED_STATES = ["stopped", "off", "exited", "down", "inactive", "dead", "created"];
  const DEFAULT_TRANSITIONAL_STATES = ["restarting", "removing", "paused", "starting"];

  const UNGROUPED_KEY = "__ungrouped__";
  const ARM_TIMEOUT_MS = 4000;
  // A recreate can run for minutes with no progress signal; never leave a row
  // stuck pending because a service call never resolves.
  const PENDING_TIMEOUT_MS = 15000;

  const DEFAULT_CONTAINER_ICON = "mdi:docker";

  // Portainer's entity roles, keyed by translation_key. Entity ids are generated
  // from names in the user's language, so they are never matched on.
  const DISCOVERY_CONTAINER_ROLES = {
    container_state: { domain: "sensor", role: "status_entity" },
    container: { domain: "switch", role: "control_entity" },
    restart_container: { domain: "button", role: "restart_entity" },
    pause_container: { domain: "button", role: "pause_entity" },
    resume_container: { domain: "button", role: "resume_entity" },
    kill_container: { domain: "button", role: "kill_entity" },
    recreate_container: { domain: "button", role: "recreate_entity" },
    container_image_update: { domain: "update", role: "update_entity" },
    container_health_state: { domain: "sensor", role: "health_entity" },
    cpu_usage_total: { domain: "sensor", role: "cpu_entity" },
    memory_usage_percentage: { domain: "sensor", role: "memory_entity", priority: 2 },
    memory_usage: { domain: "sensor", role: "memory_entity", priority: 1 },
    image: { domain: "sensor", role: "image_entity" },
  };

  const DISCOVERY_STACK_ROLES = {
    stack: { domain: "switch", role: "control_entity" },
    status: { domain: "binary_sensor", role: "status_entity" },
    stack_type: { domain: "sensor", role: "type_entity" },
    stack_containers_count: { domain: "sensor", role: "count_entity" },
  };

  const DISCOVERY_OVERVIEW_ROLES = {
    status: { domain: "binary_sensor", role: "status" },
    containers_count: { domain: "sensor", role: "container_count" },
    containers_running: { domain: "sensor", role: "containers_running" },
    containers_stopped: { domain: "sensor", role: "containers_stopped" },
    images_count: { domain: "sensor", role: "image_count" },
    docker_version: { domain: "sensor", role: "docker_version" },
    operating_system: { domain: "sensor", role: "operating_system" },
    operating_system_version: { domain: "sensor", role: "operating_system_version" },
    images_prune: { domain: "button", role: "prune_images" },
    volumes_prune: { domain: "button", role: "prune_volumes" },
  };

  const CONTAINER_KEYS = [
    "id",
    "name",
    "icon",
    "stack",
    "extra_entities",
    "health_entity",
    "image_entity",
    "update_entity",
    "update_action",
    "primary_action",
    "actions",
    "status_entity",
    "control_entity",
    "control_domain",
    "switch_entity",
    "switch_domain",
    ...CONTAINER_ACTION_KEYS.flatMap((key) => [`${key}_entity`, `${key}_domain`, `${key}_service`]),
    "restart_entity",
    "restart_domain",
    "cpu_entity",
    "memory_entity",
    "start_service",
    "stop_service",
    "restart_service",
    "running_states",
    "stopped_states",
    "running_color",
    "not_running_color",
    "stopped_color",
    "tap_action",
    "hold_action",
    "hold_delay",
  ];

  const looksLikeContainer = (value) =>
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    CONTAINER_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key));

  const normalizeExtraEntities = (value) => {
    if (!value) {
      return [];
    }
    const list = Array.isArray(value) ? value : [value];
    const result = [];
    list.forEach((entry) => {
      if (typeof entry === "string") {
        const entityId = entry.trim();
        if (entityId) {
          result.push({ entity: entityId });
        }
        return;
      }
      if (entry && typeof entry === "object" && typeof entry.entity === "string") {
        const entityId = entry.entity.trim();
        if (entityId) {
          result.push({ ...entry, entity: entityId });
        }
      }
    });
    return result;
  };

  // "auto" | "always" | "never", from a boolean or one of those strings.
  const normalizeVisibility = (value) => {
    if (value === true) {
      return "always";
    }
    if (value === false) {
      return "never";
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "always" || normalized === "true") {
        return "always";
      }
      if (normalized === "never" || normalized === "false") {
        return "never";
      }
    }
    return "auto";
  };

  const asList = (value) => {
    if (value === undefined || value === null) {
      return [];
    }
    return (Array.isArray(value) ? value : [value]).filter((entry) => entry !== undefined && entry !== null);
  };

  const globToRegExp = (pattern) => {
    const escaped = pattern
      .toString()
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i");
  };

  const matchesAny = (value, patterns) => {
    if (!patterns.length) {
      return false;
    }
    const text = (value || "").toString();
    return patterns.some((pattern) => globToRegExp(pattern).test(text));
  };

  const normalizeAutoDiscover = (value) => {
    if (!value) {
      return undefined;
    }
    const options = value === true || typeof value === "string" ? {} : { ...value };
    if (typeof value === "string") {
      options.integration = value;
    }
    return {
      integration: (options.integration || "portainer").toString(),
      endpoint: options.endpoint === undefined ? undefined : options.endpoint.toString(),
      stack: options.stack === undefined ? undefined : options.stack.toString(),
      area: options.area === undefined ? undefined : options.area.toString(),
      include: asList(options.include).map(String),
      exclude: asList(options.exclude).map(String),
      sort: (options.sort || "name").toString().toLowerCase(),
      link_to_portainer: options.link_to_portainer !== false,
      overview: options.overview !== false,
      include_hidden: options.include_hidden === true,
    };
  };

  const lowercaseList = (value) => {
    if (!Array.isArray(value)) {
      return undefined;
    }
    return value
      .filter((entry) => entry !== undefined && entry !== null)
      .map((entry) => entry.toString().toLowerCase());
  };

  const cryptoRandom = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const array = new Uint32Array(4);
      crypto.getRandomValues(array);
      return Array.from(array, (num) => num.toString(16)).join("");
    }
    return `docker_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  const isDefined = customElements.get(CARD_NAME);
  if (isDefined) {
    return;
  }

  class DockerCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._pending = new Map();
      this._containersExpanded = false;
      this._containerListId = `docker-card-containers-${cryptoRandom()}`;
    }

    setConfig(config) {
      if (!config) {
        throw new Error("Missing configuration for docker-card");
      }

      const normalizedConfig = { ...config };
      if (normalizedConfig.stopped_color && !normalizedConfig.not_running_color) {
        normalizedConfig.not_running_color = normalizedConfig.stopped_color;
      }

      const containers = this._normalizeContainers(
        normalizedConfig.containers ?? normalizedConfig.container,
      );

      this.config = {
        running_states: DEFAULT_RUNNING_STATES,
        stopped_states: DEFAULT_STOPPED_STATES,
        transitional_states: DEFAULT_TRANSITIONAL_STATES,
        running_color: "var(--state-active-color, var(--success-color, #2e8f57))",
        not_running_color: "var(--state-error-color, var(--error-color, #c22040))",
        ...normalizedConfig,
        containers,
      };

      this.config.running_states = lowercaseList(this.config.running_states) || DEFAULT_RUNNING_STATES;
      this.config.stopped_states = lowercaseList(this.config.stopped_states) || DEFAULT_STOPPED_STATES;
      this.config.transitional_states =
        lowercaseList(this.config.transitional_states) || DEFAULT_TRANSITIONAL_STATES;
      this.config.show_containers = normalizeVisibility(this.config.show_containers);
      this.config.show_icons = normalizeVisibility(this.config.show_icons);
      this.config.auto_discover = normalizeAutoDiscover(this.config.auto_discover);
      this.config.group_by = (this.config.group_by || "none").toString().toLowerCase() === "stack"
        ? "stack"
        : "none";
      this._collapsedGroups = new Set();

      this._trackedEntities = undefined;
      this._discovered = undefined;
      this._discoverySignature = undefined;
      this._lastEntities = undefined;
      this._lastDevices = undefined;
      this._closeMenu();
      this._disarm();

      if (typeof this.config.containers_expanded === "boolean") {
        this._containersExpanded = this.config.containers_expanded;
      }

      if (!this.config.docker_overview || typeof this.config.docker_overview !== "object") {
        this.config.docker_overview = {};
      }

      if (!this.config.containers.length && !this.config.auto_discover) {
        console.warn("docker-card: 'containers' is empty. The card will render a placeholder.");
      }

      this.render();
    }

    connectedCallback() {
      this.render();
    }

    set hass(hass) {
      const previous = this._hass;
      this._hass = hass;
      if (!this.config) {
        return;
      }
      const rediscovered = this._maybeDiscover(hass);
      if (!rediscovered && previous && !this._relevantStateChanged(previous, hass)) {
        return;
      }
      this.render();
    }

    get hass() {
      return this._hass;
    }

    getCardSize() {
      if (!this.config) {
        return 3;
      }
      if (this.config.show_containers === "never") {
        return 2;
      }
      if (!this._containersExpanded) {
        return 3;
      }
      return 3 + Math.min(this._effectiveContainers().length, 8);
    }

    _relevantStateChanged(previous, next) {
      if (!previous || !next || !previous.states || !next.states || !this.config) {
        return true;
      }
      if ((previous.selectedLanguage || previous.language) !== (next.selectedLanguage || next.language)) {
        return true;
      }
      return this._trackedEntityIds().some((entityId) => previous.states[entityId] !== next.states[entityId]);
    }

    // ---------------------------------------------------------------- //
    // Auto-discovery                                                    //
    // ---------------------------------------------------------------- //

    _maybeDiscover(hass) {
      const options = this.config.auto_discover;
      if (!options) {
        return false;
      }
      // The registries are replaced wholesale when they change, so identity is
      // enough — no need to walk them on every state tick.
      if (hass.entities === this._lastEntities && hass.devices === this._lastDevices) {
        return false;
      }
      this._lastEntities = hass.entities;
      this._lastDevices = hass.devices;

      const discovered = this._discover(hass, options);
      const signature = JSON.stringify(discovered);
      if (signature === this._discoverySignature) {
        return false;
      }
      this._discoverySignature = signature;
      this._discovered = discovered;
      this._trackedEntities = undefined;
      return true;
    }

    _discover(hass, options) {
      const devices = hass.devices;
      const entities = hass.entities;
      if (!devices || !entities) {
        if (!this._warnedNoRegistry) {
          this._warnedNoRegistry = true;
          console.warn(
            "docker-card: auto_discover needs hass.entities/hass.devices, which this Home Assistant did not provide.",
          );
        }
        return { containers: [], overview: {}, stacks: {} };
      }

      const integration = options.integration;
      const owned = Object.values(devices).filter(
        (device) =>
          device &&
          !device.disabled_by &&
          (device.identifiers || []).some((identifier) => Array.isArray(identifier) && identifier[0] === integration),
      );
      if (!owned.length) {
        return { containers: [], overview: {}, stacks: {} };
      }

      const ownedIds = new Set(owned.map((device) => device.id));
      const byDevice = new Map();
      Object.values(entities).forEach((entry) => {
        if (!entry || !entry.device_id || !ownedIds.has(entry.device_id)) {
          return;
        }
        // `platform` is the precise check; older registries may omit it, in
        // which case device ownership already narrowed us enough.
        if (entry.platform && entry.platform !== integration) {
          return;
        }
        if (entry.hidden && !options.include_hidden) {
          return;
        }
        if (!hass.states[entry.entity_id]) {
          return;
        }
        if (!byDevice.has(entry.device_id)) {
          byDevice.set(entry.device_id, []);
        }
        byDevice.get(entry.device_id).push(entry);
      });

      const modelOf = (device) => (device.model || "").toString().toLowerCase();
      const nameOf = (device) => (device.name_by_user || device.name || "").toString();
      const endpoints = owned.filter((device) => modelOf(device) === "endpoint");
      const stacks = owned.filter((device) => modelOf(device) === "stack");
      const stackById = new Map(stacks.map((device) => [device.id, device]));

      const matchesDevice = (device, wanted) => {
        if (!wanted) {
          return true;
        }
        const target = wanted.toLowerCase();
        return device.id === wanted || nameOf(device).toLowerCase() === target;
      };

      const selectedEndpoints = endpoints.filter((device) => matchesDevice(device, options.endpoint));
      const selectedEndpointIds = new Set(selectedEndpoints.map((device) => device.id));

      // A container hangs off its stack, and the stack off the endpoint.
      const endpointOf = (device) => {
        const parent = device.via_device_id;
        if (!parent) {
          return undefined;
        }
        if (stackById.has(parent)) {
          return stackById.get(parent).via_device_id;
        }
        return parent;
      };
      const stackOf = (device) => {
        const parent = device.via_device_id;
        return parent && stackById.has(parent) ? stackById.get(parent) : undefined;
      };

      const stackConfigs = {};
      stacks.forEach((device) => {
        const mapped = this._mapDeviceEntities(byDevice.get(device.id) || [], DISCOVERY_STACK_ROLES);
        const name = nameOf(device);
        if (name) {
          stackConfigs[name] = { ...mapped, id: device.id, name };
        }
      });

      const containers = [];
      owned
        .filter((device) => modelOf(device) === "container")
        .forEach((device) => {
          const name = nameOf(device);
          const stack = stackOf(device);

          if (options.endpoint) {
            const endpointId = endpointOf(device);
            if (!endpointId || !selectedEndpointIds.has(endpointId)) {
              return;
            }
          }
          if (options.stack && !(stack && matchesDevice(stack, options.stack))) {
            return;
          }
          if (options.area) {
            const areaId = device.area_id;
            const area = areaId && hass.areas ? hass.areas[areaId] : undefined;
            const areaName = area ? (area.name || "").toLowerCase() : "";
            const aliases = area && Array.isArray(area.aliases) ? area.aliases.map((a) => a.toLowerCase()) : [];
            const wanted = options.area.toLowerCase();
            if (areaId !== options.area && areaName !== wanted && aliases.indexOf(wanted) === -1) {
              return;
            }
          }
          if (options.include.length && !matchesAny(name, options.include)) {
            return;
          }
          if (options.exclude.length && matchesAny(name, options.exclude)) {
            return;
          }

          const container = this._mapDeviceEntities(byDevice.get(device.id) || [], DISCOVERY_CONTAINER_ROLES);
          if (!Object.keys(container).length) {
            return;
          }

          container.id = device.id;
          container.name = name || undefined;
          if (stack) {
            container.stack = nameOf(stack);
          }
          if (options.link_to_portainer && device.configuration_url) {
            container.hold_action = { action: "url", url_path: device.configuration_url };
          }
          if (container.image_entity) {
            container.extra_entities = [{ entity: container.image_entity }];
          }
          containers.push(container);
        });

      const sorters = {
        name: (a, b) => (a.name || "").localeCompare(b.name || ""),
        state: (a, b) => {
          const stateOf = (entry) => {
            const entity = entry.status_entity ? hass.states[entry.status_entity] : undefined;
            return entity ? entity.state : "";
          };
          return stateOf(a).localeCompare(stateOf(b)) || (a.name || "").localeCompare(b.name || "");
        },
        cpu: (a, b) => {
          const cpuOf = (entry) => {
            const entity = entry.cpu_entity ? hass.states[entry.cpu_entity] : undefined;
            const value = entity ? Number.parseFloat(entity.state) : Number.NaN;
            return Number.isNaN(value) ? -1 : value;
          };
          return cpuOf(b) - cpuOf(a) || (a.name || "").localeCompare(b.name || "");
        },
      };
      containers.sort(sorters[options.sort] || sorters.name);

      let overview = {};
      if (options.overview) {
        if (selectedEndpoints.length === 1) {
          overview = this._mapDeviceEntities(
            byDevice.get(selectedEndpoints[0].id) || [],
            DISCOVERY_OVERVIEW_ROLES,
          );
        } else if (selectedEndpoints.length > 1 && !this._warnedManyEndpoints) {
          this._warnedManyEndpoints = true;
          console.warn(
            "docker-card: several Portainer endpoints found; set auto_discover.endpoint to pick one for the overview.",
          );
        }
      }

      // Only keep stacks that still have a row on the card.
      const usedStacks = new Set(containers.map((container) => container.stack).filter(Boolean));
      const stacksResult = {};
      Object.keys(stackConfigs).forEach((name) => {
        if (usedStacks.has(name)) {
          stacksResult[name] = stackConfigs[name];
        }
      });

      return { containers, overview, stacks: stacksResult };
    }

    _mapDeviceEntities(entries, roles) {
      const result = {};
      const priorities = {};

      entries.forEach((entry) => {
        const domain = domainFromEntityId(entry.entity_id);
        const mapping = entry.translation_key ? roles[entry.translation_key] : undefined;
        if (mapping && mapping.domain === domain) {
          const priority = mapping.priority || 1;
          if (!result[mapping.role] || priority > (priorities[mapping.role] || 0)) {
            result[mapping.role] = entry.entity_id;
            priorities[mapping.role] = priority;
          }
        }
      });

      // Best effort for registries that do not carry translation_key.
      entries.forEach((entry) => {
        if (entry.translation_key) {
          return;
        }
        const domain = domainFromEntityId(entry.entity_id);
        const state = this._getEntity(entry.entity_id);
        const attributes = (state && state.attributes) || {};
        if (domain === "switch" && !result.control_entity && roles === DISCOVERY_CONTAINER_ROLES) {
          result.control_entity = entry.entity_id;
        } else if (domain === "update" && !result.update_entity) {
          result.update_entity = entry.entity_id;
        } else if (
          domain === "sensor" &&
          !result.status_entity &&
          Array.isArray(attributes.options) &&
          attributes.options.indexOf("running") !== -1
        ) {
          result.status_entity = entry.entity_id;
        }
      });

      return result;
    }

    _effectiveContainers() {
      const configured = this.config.containers || [];
      const discovered = this._discovered ? this._discovered.containers : undefined;
      if (!discovered || !discovered.length) {
        return configured;
      }
      if (!configured.length) {
        return discovered;
      }

      // Configured entries refine discovered rows of the same name; anything
      // that does not match is kept as a manual row.
      const overrides = new Map();
      configured.forEach((container) => {
        if (container.name) {
          overrides.set(container.name.toLowerCase(), container);
        }
      });

      const used = new Set();
      const merged = discovered.map((container) => {
        const override = container.name ? overrides.get(container.name.toLowerCase()) : undefined;
        if (!override) {
          return container;
        }
        used.add(override);
        return { ...container, ...override };
      });

      configured.forEach((container) => {
        if (!used.has(container)) {
          merged.push(container);
        }
      });

      return merged;
    }

    _stackConfig(name) {
      if (!name) {
        return undefined;
      }
      const discovered = (this._discovered && this._discovered.stacks) || {};
      const configured = this.config.stacks || {};
      const merged = { ...(discovered[name] || {}), ...(configured[name] || {}) };
      merged.name = name;
      return merged;
    }

    _effectiveOverview() {
      const configured = this.config.docker_overview || {};
      if (Object.keys(configured).length) {
        return configured;
      }
      return (this._discovered && this._discovered.overview) || configured;
    }

    _trackedEntityIds() {
      if (this._trackedEntities) {
        return this._trackedEntities;
      }

      const ids = new Set();
      const add = (value) => {
        if (typeof value === "string" && value.includes(".")) {
          ids.add(value);
        }
      };

      Object.values(this._effectiveOverview()).forEach(add);
      if (this.config.group_by === "stack") {
        this._groupContainers(this._effectiveContainers()).forEach((group) => {
          const stack = group.stack || {};
          add(stack.control_entity);
          add(stack.status_entity);
        });
      }
      this._effectiveContainers().forEach((container) => {
        add(container.status_entity);
        add(container.control_entity);
        add(container.switch_entity);
        add(container.cpu_entity);
        add(container.memory_entity);
        add(container.health_entity);
        add(container.update_entity);
        CONTAINER_ACTION_KEYS.forEach((key) => add(container[`${key}_entity`]));
        (container.extra_entities || []).forEach((extra) => add(extra.entity));
        [container.tap_action, container.hold_action].forEach((action) => {
          if (action && typeof action === "object") {
            add(action.entity);
          }
        });
      });

      this._trackedEntities = Array.from(ids);
      return this._trackedEntities;
    }

    render() {
      const root = this.shadowRoot;
      if (!root || !this.config) {
        return;
      }

      if (!this._styleEl) {
        this._styleEl = document.createElement("style");
        this._styleEl.textContent = this._style();
        root.appendChild(this._styleEl);
      }

      let card = this._card;
      if (!card) {
        card = document.createElement("ha-card");
        card.classList.add("docker-card");
        this._card = card;
        root.appendChild(card);
      }

      if (!this._hass) {
        card.innerHTML = `<div class='placeholder'>${this._localize("placeholders.waiting")}</div>`;
        return;
      }

      card.innerHTML = "";
      this._menuElement = undefined;
      this._menuAnchor = undefined;
      this._menuItems = undefined;

      if (this.config.running_color) {
        card.style.setProperty("--docker-card-running-color", this.config.running_color);
      }
      if (this.config.not_running_color) {
        card.style.setProperty("--docker-card-not-running-color", this.config.not_running_color);
      }

      const header = this._buildHeader();
      card.appendChild(header);

      const overview = this._buildOverview();
      if (overview) {
        card.appendChild(overview);
      }

      const containerSection = this._buildContainers(Boolean(overview));
      if (containerSection) {
        card.appendChild(containerSection);
      }

      this._placeMenu(card);
    }

    _placeMenu(card) {
      const menu = this._menuElement;
      if (!menu || !menu.isConnected) {
        return;
      }

      // Themes are free to clip ha-card, so flip the menu above its trigger
      // rather than let it hang off the bottom of the card.
      menu.classList.remove("upwards");
      const menuRect = menu.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const anchorRect = this._menuAnchor ? this._menuAnchor.getBoundingClientRect() : menuRect;
      if (menuRect.height && menuRect.bottom > cardRect.bottom) {
        const flippedTop = anchorRect.top - menuRect.height;
        if (flippedTop >= cardRect.top) {
          menu.classList.add("upwards");
        }
      }

      const items = this._menuItems || [];
      const index = this._menuFocusIndex;
      if (typeof index === "number" && items[index]) {
        items[index].focus();
      } else if (items[0]) {
        items[0].focus();
      }
    }

    _style() {
      return `
        :host {
          display: block;
          /* Lets the row reflow by card width rather than viewport width — a
             narrow dashboard column on a wide screen needs the same treatment
             as a phone. */
          container-type: inline-size;
        }
        ha-card.docker-card {
          padding: 1rem 1.25rem;
          border-radius: var(--ha-card-border-radius, 12px);
          background: var(--ha-card-background, var(--card-background-color, #fff));
          box-shadow: var(--ha-card-box-shadow, none);
          color: var(--primary-text-color);
        }
        .header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        .header .title {
          flex: 1 1 auto;
          min-width: 0;
        }
        .header .host-actions .action-button {
          width: 1.9rem;
          height: 1.9rem;
        }
        .title {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .status-pill {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding: 0.3rem 0.75rem;
          border-radius: 999px;
          background: var(--docker-card-running-color, var(--primary-color));
          color: var(--text-primary-color, #fff);
        }
        .status-pill.actionable {
          cursor: pointer;
        }
        .status-pill.actionable:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .status-pill.running {
          background: var(--docker-card-running-color, var(--state-active-color, var(--success-color, #2e8f57)));
        }
        .status-pill.offline,
        .status-pill.not-running {
          background: var(--docker-card-not-running-color, var(--state-error-color, var(--error-color)));
        }
        .status-pill.idle {
          background: var(--state-warning-color, var(--warning-color));
          color: var(--primary-text-color);
        }
        .docker-overview {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 0.5rem;
          margin-bottom: 1.25rem;
        }
        .overview-item {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.45rem 0.75rem;
          border-radius: var(--ha-card-border-radius, 10px);
          background: var(--card-background-color, rgba(0, 0, 0, 0.04));
          border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
          min-height: 52px;
        }
        .overview-item.actionable {
          cursor: pointer;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .overview-item.actionable:hover {
          border-color: var(--primary-color);
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
        }
        .overview-item.actionable:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .overview-badge {
          width: 2.1rem;
          height: 2.1rem;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.8rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          background: var(--divider-color, rgba(0, 0, 0, 0.08));
          color: var(--primary-text-color);
        }
        .overview-text {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
          line-height: 1.2;
        }
        .overview-label {
          font-size: 0.6rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--secondary-text-color);
        }
        .overview-value {
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--primary-text-color);
        }
        .overview-value.running {
          color: var(--docker-card-running-color, var(--state-active-color, var(--success-color, #2e8f57)));
        }
        .overview-value.not-running {
          color: var(--docker-card-not-running-color, var(--state-error-color, var(--error-color, #c22040)));
        }
        .container-section {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .section-title {
          font-size: 0.85rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--secondary-text-color);
        }
        .section-header .section-title {
          flex: 1 1 auto;
          text-align: left;
        }
        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          width: 100%;
          margin: 0 0 0.5rem 0;
          padding: 0;
          background: none;
          border: none;
          color: inherit;
          cursor: pointer;
          font: inherit;
        }
        .section-header:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .section-chevron {
          width: 0;
          height: 0;
          border-style: solid;
          border-width: 0.35rem 0.3rem 0 0.3rem;
          border-color: var(--secondary-text-color) transparent transparent transparent;
          transition: transform 0.2s ease;
        }
        .container-section.collapsed .section-header {
          margin-bottom: 0;
        }
        .container-section.collapsed .section-chevron {
          transform: rotate(-90deg);
        }
        .container-section.collapsed .container-list {
          display: none;
        }
        .container-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .container-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .group-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .group-toggle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex: 1 1 auto;
          min-width: 0;
          margin: 0;
          padding: 0;
          background: none;
          border: none;
          color: inherit;
          font: inherit;
          cursor: pointer;
          text-align: left;
        }
        .group-toggle:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .group-toggle .section-chevron {
          transition: transform 0.2s ease;
        }
        .container-group.collapsed .section-chevron {
          transform: rotate(-90deg);
        }
        .container-group.collapsed .group-list {
          display: none;
        }
        .group-name {
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--secondary-text-color);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .group-count {
          flex: 0 0 auto;
          min-width: 1.25rem;
          padding: 0.05rem 0.4rem;
          border-radius: 999px;
          background: var(--divider-color, rgba(0, 0, 0, 0.08));
          color: var(--secondary-text-color);
          font-size: 0.65rem;
          font-weight: 600;
          text-align: center;
          font-variant-numeric: tabular-nums;
        }
        .group-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .group-switch {
          flex: 0 0 auto;
        }
        .container-row {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          flex-wrap: nowrap;
          gap: 0.75rem 1.25rem;
          padding: 0.9rem 1rem;
          border-radius: var(--ha-card-border-radius, 12px);
          background: var(--card-background-color, rgba(0, 0, 0, 0.03));
          border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .container-row.actionable {
          cursor: pointer;
        }
        .container-row.actionable:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .container-row.running {
          border-color: var(--docker-card-running-color, var(--state-active-color, var(--success-color, #2e8f57)));
        }
        .container-row.stopped,
        .container-row.unknown {
          border-color: var(--docker-card-not-running-color, var(--state-error-color, var(--error-color, #c22040)));
        }
        .container-row.transitional {
          border-color: var(--state-warning-color, var(--warning-color, #ffa600));
        }
        .container-row.pending {
          opacity: 0.65;
          cursor: progress;
        }
        .container-icon {
          --mdc-icon-size: 24px;
          width: 24px;
          height: 24px;
          flex: 0 0 auto;
          color: var(--docker-card-not-running-color, var(--state-error-color, var(--error-color, #c22040)));
        }
        .container-row.running .container-icon {
          color: var(--docker-card-running-color, var(--state-active-color, var(--success-color, #2e8f57)));
        }
        .container-row.transitional .container-icon {
          color: var(--state-warning-color, var(--warning-color, #ffa600));
        }
        .container-icon.placeholder-icon {
          visibility: hidden;
        }
        .container-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          flex: 1 1 200px;
          min-width: 0;
        }
        .container-name {
          font-weight: 600;
          font-size: 1rem;
          color: var(--primary-text-color);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .container-status {
          font-size: 0.85rem;
          text-transform: capitalize;
        }
        .container-status.running {
          color: var(--docker-card-running-color, var(--state-active-color, var(--success-color, #2e8f57)));
        }
        .container-status.stopped,
        .container-status.unknown {
          color: var(--docker-card-not-running-color, var(--state-error-color, var(--error-color, #c22040)));
        }
        .container-status.transitional {
          color: var(--state-warning-color, var(--warning-color, #ffa600));
        }
        .container-resources {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem 1rem;
          font-size: 0.75rem;
          color: var(--secondary-text-color);
          margin-top: 0.25rem;
          max-width: 100%;
        }
        .resource-item {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          min-width: 0;
        }
        .resource-label {
          font-weight: 500;
          flex: 0 0 auto;
        }
        .resource-icon {
          --mdc-icon-size: 14px;
          width: 14px;
          height: 14px;
          flex: 0 0 auto;
        }
        .resource-value {
          font-variant-numeric: tabular-nums;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          flex: 0 0 auto;
          margin-left: auto;
        }
        .action-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 2.25rem;
          height: 2.25rem;
          padding: 0;
          border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          background: transparent;
          color: var(--primary-text-color);
          font: inherit;
          border-radius: 50%;
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
          --mdc-icon-size: 18px;
        }
        .action-button ha-icon {
          width: 18px;
          height: 18px;
        }
        .action-button:hover {
          border-color: var(--primary-color);
          color: var(--primary-color);
        }
        .action-button:active {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }
        .action-button:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .action-button:disabled,
        ha-switch[disabled] {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .overflow {
          position: relative;
          display: inline-flex;
        }
        .menu {
          position: absolute;
          top: calc(100% + 0.35rem);
          right: 0;
          z-index: 4;
          min-width: 11rem;
          display: flex;
          flex-direction: column;
          padding: 0.25rem;
          border-radius: var(--ha-card-border-radius, 10px);
          border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          background: var(--card-background-color, #fff);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
        }
        .menu.upwards {
          top: auto;
          bottom: calc(100% + 0.35rem);
        }
        .menu-item {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.5rem 0.65rem;
          border: none;
          border-radius: 6px;
          background: none;
          color: var(--primary-text-color);
          font: inherit;
          font-size: 0.85rem;
          text-align: left;
          cursor: pointer;
          --mdc-icon-size: 18px;
        }
        .menu-item ha-icon {
          width: 18px;
          height: 18px;
          flex: 0 0 auto;
          color: var(--secondary-text-color);
        }
        .menu-item:hover {
          background: var(--divider-color, rgba(0, 0, 0, 0.08));
        }
        .menu-item:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: -2px;
        }
        .menu-item.destructive:hover,
        .menu-item.destructive:hover ha-icon {
          color: var(--error-color, #c22040);
        }
        .menu-item.armed,
        .menu-item.armed ha-icon {
          color: var(--error-color, #c22040);
          font-weight: 600;
        }
        .container-name-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.25rem 0.4rem;
          min-width: 0;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          flex: 0 0 auto;
          padding: 0.1rem 0.45rem;
          border-radius: 999px;
          font-size: 0.65rem;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          --mdc-icon-size: 12px;
        }
        .badge ha-icon {
          width: 12px;
          height: 12px;
        }
        .badge.actionable {
          cursor: pointer;
        }
        .badge:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }
        .update-badge {
          background: var(--info-color, var(--primary-color));
          color: var(--text-primary-color, #fff);
        }
        .health-badge {
          background: var(--divider-color, rgba(0, 0, 0, 0.08));
          color: var(--secondary-text-color);
          text-transform: none;
          letter-spacing: normal;
        }
        .health-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--secondary-text-color);
        }
        .health-badge.health-healthy .health-dot {
          background: var(--success-color, #2e8f57);
        }
        .health-badge.health-unhealthy .health-dot {
          background: var(--error-color, #c22040);
        }
        .health-badge.health-starting .health-dot {
          background: var(--warning-color, #ffa600);
        }
        .empty-hint {
          font-size: 0.85rem;
          color: var(--secondary-text-color);
          text-align: center;
          padding: 0.75rem 0;
        }
        @media (max-width: 768px) {
          ha-card.docker-card {
            padding: 0.9rem;
          }
          .docker-overview {
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          }
        }
        @container (max-width: 360px) {
          .container-row {
            flex-wrap: wrap;
            row-gap: 0.6rem;
          }
          .container-info {
            flex: 1 1 100%;
          }
          .actions {
            width: 100%;
            margin-left: 0;
            justify-content: flex-end;
          }
        }
      `;
    }

    _toggleContainers() {
      this._containersExpanded = !this._containersExpanded;
      this.render();
    }

    _buildHeader() {
      const wrapper = document.createElement("div");
      wrapper.classList.add("header");

      const title = document.createElement("div");
      title.classList.add("title");
      title.textContent = this.config.title || this._localize("common.card_title");
      wrapper.appendChild(title);

      const status = this._computeOverallStatus();
      const statusPill = document.createElement("div");
      statusPill.classList.add("status-pill");
      if (status.cssClass) {
        status.cssClass
          .toString()
          .split(/\s+/)
          .filter(Boolean)
          .forEach((cls) => statusPill.classList.add(cls));
      }
      if (status.tone === "not_running") {
        statusPill.classList.add("not-running");
      }
      statusPill.style.setProperty("--docker-card-running-color", this.config.running_color);
      statusPill.style.setProperty("--docker-card-not-running-color", this.config.not_running_color);
      if (status.tone === "running" && status.accent) {
        statusPill.style.background = status.accent;
      } else if (status.tone === "not_running" && status.accent) {
        statusPill.style.background = status.accent;
      } else {
        statusPill.style.removeProperty("background");
      }
      statusPill.textContent = status.label;
      if (status.entityId) {
        this._makeElementActionable(statusPill, status.entityId, this._localize("aria.open_status_details"));
      }
      wrapper.appendChild(statusPill);

      const hostActions = this._buildHostActions();
      if (hostActions) {
        wrapper.appendChild(hostActions);
      }

      return wrapper;
    }

    _buildHostActions() {
      if (this.config.show_host_actions === false) {
        return null;
      }

      const overview = this._effectiveOverview();
      const entries = [
        { key: "prune_images", entityId: overview.prune_images, icon: "mdi:image-remove" },
        { key: "prune_volumes", entityId: overview.prune_volumes, icon: "mdi:database-remove" },
      ].filter((entry) => {
        if (!entry.entityId) {
          return false;
        }
        const entity = this._getEntity(entry.entityId);
        return Boolean(entity) && entity.state !== "unavailable";
      });

      if (!entries.length) {
        return null;
      }

      const key = "__host__";
      const wrapper = document.createElement("div");
      wrapper.classList.add("overflow", "host-actions");

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.classList.add("action-button", "overflow-trigger");
      trigger.title = this._localize("actions.host_actions");
      trigger.setAttribute("aria-label", this._localize("actions.host_actions"));
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", String(this._menuKey === key));
      trigger.disabled = Boolean(this._pending.get(key));

      const triggerIcon = document.createElement("ha-icon");
      triggerIcon.setAttribute("icon", "mdi:dots-vertical");
      trigger.appendChild(triggerIcon);
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        this._toggleMenu(key);
      });
      wrapper.appendChild(trigger);

      if (this._menuKey !== key) {
        return wrapper;
      }

      const menu = document.createElement("div");
      menu.classList.add("menu");
      menu.setAttribute("role", "menu");

      const items = [];
      entries.forEach((entry) => {
        const armed = this._armed && this._armed.key === key && this._armed.action === entry.key;
        const item = document.createElement("button");
        item.type = "button";
        item.classList.add("menu-item", "destructive");
        item.dataset.action = entry.key;
        item.setAttribute("role", "menuitem");
        if (armed) {
          item.classList.add("armed");
        }

        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", armed ? "mdi:alert-outline" : entry.icon);
        item.appendChild(icon);

        const label = document.createElement("span");
        const actionLabel = this._localize(`actions.${entry.key}`);
        label.textContent = armed
          ? this._localize("actions.confirm", { action: actionLabel })
          : actionLabel;
        item.appendChild(label);

        item.addEventListener("click", (event) => {
          event.stopPropagation();
          if (this._confirmRequired(entry.key) && !armed) {
            this._arm(key, entry.key);
            this.render();
            return;
          }
          this._disarm();
          this._closeMenu();
          this._handleHostAction(entry);
        });
        items.push(item);
        menu.appendChild(item);
      });

      menu.addEventListener("keydown", (event) => this._handleMenuKeydown(event, items));
      wrapper.appendChild(menu);
      this._menuElement = menu;
      this._menuAnchor = wrapper;
      this._menuItems = items;

      return wrapper;
    }

    async _handleHostAction(entry) {
      const capability = this._actionCapability(entry.entityId);
      const serviceConfig = capability
        ? { domain: capability.domain, service: capability.service, data: { entity_id: capability.entity_id } }
        : undefined;
      if (!serviceConfig) {
        return;
      }

      const key = "__host__";
      this._setPending(key, entry.key);
      this.render();

      try {
        await this._callService(serviceConfig);
        this._notify(this._localize(`notifications.pending.${entry.key}`));
      } catch (error) {
        console.error(`docker-card ${entry.key} error`, error);
        this._notify(this._localize(`notifications.failed.${entry.key}`));
      } finally {
        this._clearPending(key);
        this.render();
      }
    }

    _buildOverview() {
      const overviewConfig = this._effectiveOverview();
      if (!overviewConfig || typeof overviewConfig !== "object") {
        return null;
      }

      const fetchState = (key) => {
        const entityId = overviewConfig[key];
        const entity = entityId ? this._getEntity(entityId) : undefined;
        return {
          entityId,
          entity,
          state: entity ? entity.state : undefined,
        };
      };

      const total = fetchState("container_count");
      const running = fetchState("containers_running");
      const stopped = fetchState("containers_stopped");
      const images = fetchState("image_count");
      const dockerVersion = fetchState("docker_version");
      const osName = fetchState("operating_system");
      const osVersion = fetchState("operating_system_version");

      const overviewItems = [];

      const runningCount = this._parseIntState(running.state);
      let totalCount = this._parseIntState(total.state);
      let totalLabel = this._formatStateValue(total.state);
      if (totalCount === undefined && typeof runningCount === "number") {
        const stoppedCount = this._parseIntState(stopped.state);
        if (typeof stoppedCount === "number") {
          totalCount = runningCount + stoppedCount;
          totalLabel = String(totalCount);
        }
      }
      const runningValue = `${this._formatStateValue(running.state)} / ${totalLabel}`;
      if (!this._isPlaceholderValue(runningValue)) {
        const varianceClass =
          typeof runningCount === "number" && typeof totalCount === "number" && runningCount !== totalCount
            ? "not-running"
            : "running";
        overviewItems.push({
          label: this._localize("overview.running_total"),
          value: runningValue,
          badge: "rt",
          cssClass: varianceClass,
          entityId: running.entityId,
          ariaLabel: this._localize("overview.running_total_aria"),
        });
      }

      const imageValue = this._formatStateValue(images.state);
      if (!this._isPlaceholderValue(imageValue)) {
        overviewItems.push({
          label: this._localize("overview.images"),
          value: imageValue,
          badge: "img",
          entityId: images.entityId,
          ariaLabel: this._localize("overview.images_aria"),
        });
      }

      const dockerValue = this._formatStateValue(dockerVersion.state);
      if (!this._isPlaceholderValue(dockerValue)) {
        overviewItems.push({
          label: this._localize("overview.docker"),
          value: dockerValue,
          badge: "doc",
          entityId: dockerVersion.entityId,
          ariaLabel: this._localize("overview.docker_aria"),
        });
      }

      const osLabel = this._formatStateValue(osName.state);
      const osVersionLabel = this._formatStateValue(osVersion.state);
      let osValue = "";
      if (osLabel !== "—" && osVersionLabel !== "—") {
        osValue = `${osLabel} · ${osVersionLabel}`;
      } else if (osLabel !== "—") {
        osValue = osLabel;
      } else if (osVersionLabel !== "—") {
        osValue = osVersionLabel;
      }
      if (!this._isPlaceholderValue(osValue)) {
        overviewItems.push({
          label: this._localize("overview.os"),
          value: osValue,
          badge: "os",
          entityId: osVersion.entityId || osName.entityId,
          ariaLabel: this._localize("overview.os_aria"),
        });
      }

      if (!overviewItems.length) {
        return null;
      }

      const overview = document.createElement("div");
      overview.classList.add("docker-overview");

      overviewItems.forEach((item) => {
        const pill = document.createElement("div");
        pill.classList.add("overview-item");

        if (item.badge) {
          const badge = document.createElement("div");
          badge.classList.add("overview-badge");
          badge.textContent = item.badge;
          pill.appendChild(badge);
        }

        const text = document.createElement("div");
        text.classList.add("overview-text");

        const label = document.createElement("div");
        label.classList.add("overview-label");
        label.textContent = item.label;
        text.appendChild(label);

        const value = document.createElement("div");
        value.classList.add("overview-value");
        value.textContent = item.value;
        if (item.cssClass) {
          value.classList.add(item.cssClass);
        }
        text.appendChild(value);

        pill.appendChild(text);
        if (item.entityId) {
          this._makeElementActionable(pill, item.entityId, item.ariaLabel || `Open ${item.label} details`);
        }
        overview.appendChild(pill);
      });

      return overview;
    }

    _buildContainers(hasOverview) {
      const showContainers = this.config.show_containers;
      const containers = this._effectiveContainers();

      if (showContainers === "never") {
        return null;
      }
      // "auto": drop the whole section when it has nothing to say, but only if
      // the card still shows something else. An otherwise empty card keeps the
      // hint so a broken config is visible rather than silently blank.
      if (showContainers !== "always" && !containers.length && hasOverview) {
        return null;
      }

      const section = document.createElement("div");
      section.classList.add("container-section");
      if (!this._containersExpanded) {
        section.classList.add("collapsed");
      }

      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.classList.add("section-header");
      toggleButton.setAttribute("aria-expanded", String(this._containersExpanded));
      toggleButton.setAttribute("aria-controls", this._containerListId);
      toggleButton.setAttribute(
        "aria-label",
        this._containersExpanded
          ? this._localize("aria.collapse_containers")
          : this._localize("aria.expand_containers"),
      );
      toggleButton.addEventListener("click", () => this._toggleContainers());

      const title = document.createElement("span");
      title.classList.add("section-title");
      title.textContent = this._localize("common.containers");
      toggleButton.appendChild(title);

      const chevron = document.createElement("span");
      chevron.classList.add("section-chevron");
      toggleButton.appendChild(chevron);

      section.appendChild(toggleButton);

      const list = document.createElement("div");
      list.classList.add("container-list");
      list.id = this._containerListId;
      list.hidden = !this._containersExpanded;
      section.appendChild(list);

      if (!containers.length) {
        const hint = document.createElement("div");
        hint.classList.add("empty-hint");
        hint.textContent = this._localize("placeholders.no_containers");
        list.appendChild(hint);
        return section;
      }

      // Resolved up front so rows without an icon can reserve the same space and
      // keep the list aligned across every group.
      const icons = new Map();
      containers.forEach((container) => icons.set(container, this._resolveContainerIcon(container)));
      const anyIcon = Array.from(icons.values()).some(Boolean);

      const groups = this.config.group_by === "stack" ? this._groupContainers(containers) : [];

      if (groups.length > 1 || (groups.length === 1 && groups[0].key !== UNGROUPED_KEY)) {
        groups.forEach((group, index) => {
          list.appendChild(this._buildGroup(group, index, icons, anyIcon));
        });
        return section;
      }

      containers.forEach((container) => {
        list.appendChild(this._buildContainerRow(container, icons.get(container), anyIcon));
      });

      return section;
    }

    _groupContainers(containers) {
      const order = [];
      const groups = new Map();

      containers.forEach((container) => {
        const name = typeof container.stack === "string" ? container.stack.trim() : "";
        const key = name || UNGROUPED_KEY;
        if (!groups.has(key)) {
          groups.set(key, {
            key,
            name: name || this._localize("common.ungrouped"),
            stack: name ? this._stackConfig(name) : undefined,
            containers: [],
          });
          order.push(key);
        }
        groups.get(key).containers.push(container);
      });

      // Named stacks first, alphabetically; anything loose goes last.
      return order
        .map((key) => groups.get(key))
        .sort((a, b) => {
          if (a.key === UNGROUPED_KEY) {
            return 1;
          }
          if (b.key === UNGROUPED_KEY) {
            return -1;
          }
          return a.name.localeCompare(b.name);
        });
    }

    _buildGroup(group, index, icons, anyIcon) {
      const collapsed = this._collapsedGroups.has(group.key);
      const listId = `${this._containerListId}-group-${index}`;

      const wrapper = document.createElement("div");
      wrapper.classList.add("container-group");
      wrapper.dataset.group = group.key;
      if (collapsed) {
        wrapper.classList.add("collapsed");
      }

      const header = document.createElement("div");
      header.classList.add("group-header");

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.classList.add("group-toggle");
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-controls", listId);
      toggle.setAttribute(
        "aria-label",
        collapsed
          ? this._localize("aria.expand_group", { name: group.name })
          : this._localize("aria.collapse_group", { name: group.name }),
      );
      toggle.addEventListener("click", () => this._toggleGroup(group.key));

      const chevron = document.createElement("span");
      chevron.classList.add("section-chevron");
      toggle.appendChild(chevron);

      const name = document.createElement("span");
      name.classList.add("group-name");
      name.textContent = group.name;
      toggle.appendChild(name);

      const count = document.createElement("span");
      count.classList.add("group-count");
      count.textContent = String(group.containers.length);
      toggle.appendChild(count);

      header.appendChild(toggle);

      const stackToggle = this._buildStackToggle(group);
      if (stackToggle) {
        header.appendChild(stackToggle);
      }

      wrapper.appendChild(header);

      const groupList = document.createElement("div");
      groupList.classList.add("group-list");
      groupList.id = listId;
      groupList.hidden = collapsed;
      group.containers.forEach((container) => {
        groupList.appendChild(this._buildContainerRow(container, icons.get(container), anyIcon));
      });
      wrapper.appendChild(groupList);

      return wrapper;
    }

    _buildStackToggle(group) {
      const stack = group.stack;
      if (!stack || !stack.control_entity) {
        return undefined;
      }
      const entity = this._getEntity(stack.control_entity);
      if (!entity) {
        return undefined;
      }

      // A synthetic container lets the stack switch reuse the whole toggle path,
      // pending state and notifications included.
      const pseudo = {
        id: `stack:${stack.id || group.key}`,
        name: group.name,
        control_entity: stack.control_entity,
      };
      const key = this._containerKey(pseudo);
      const pending = this._pending.get(key);

      const toggle = document.createElement("ha-switch");
      toggle.classList.add("group-switch");
      toggle.checked = pending
        ? pending === "start"
        : this.config.running_states.includes((entity.state || "").toString().toLowerCase());
      toggle.disabled = Boolean(pending);
      toggle.title = this._localize("aria.stack_toggle", { name: group.name });
      toggle.setAttribute("aria-label", toggle.title);
      toggle.addEventListener("change", (event) => {
        event.stopPropagation();
        const target = event.target;
        if (!target || target.disabled) {
          return;
        }
        this._handleToggle(pseudo, target.checked, toggle);
      });

      return toggle;
    }

    _toggleGroup(key) {
      if (this._collapsedGroups.has(key)) {
        this._collapsedGroups.delete(key);
      } else {
        this._collapsedGroups.add(key);
      }
      this.render();
    }

    _buildContainerRow(container, iconName, reserveIcon) {
      const key = this._containerKey(container);
      const pendingAction = this._pending.get(key);
      const statusInfo = this._containerStatus(container);
      const updateInfo = this._updateInfo(container);
      const busy = Boolean(pendingAction) || updateInfo.inProgress;

      const row = document.createElement("div");
      row.classList.add("container-row");
      row.classList.add(statusInfo.cssClass);
      row.dataset.containerKey = key;

      const runningColor = container.running_color || this.config.running_color;
      const notRunningColor =
        container.not_running_color || container.stopped_color || this.config.not_running_color;
      if (runningColor) {
        row.style.setProperty("--docker-card-running-color", runningColor);
      }
      if (notRunningColor) {
        row.style.setProperty("--docker-card-not-running-color", notRunningColor);
      }
      if (busy) {
        row.classList.add("pending");
      }

      if (reserveIcon) {
        const icon = document.createElement("ha-icon");
        icon.classList.add("container-icon");
        if (iconName) {
          icon.setAttribute("icon", iconName);
        } else {
          icon.classList.add("placeholder-icon");
        }
        row.appendChild(icon);
      }

      const infoBlock = document.createElement("div");
      infoBlock.classList.add("container-info");

      const nameRow = document.createElement("div");
      nameRow.classList.add("container-name-row");

      const name = document.createElement("div");
      name.classList.add("container-name");
      name.textContent = container.name || this._friendlyName(container.status_entity || container.switch_entity);
      nameRow.appendChild(name);

      this._buildBadges(container, updateInfo).forEach((badge) => nameRow.appendChild(badge));
      infoBlock.appendChild(nameRow);

      const state = document.createElement("div");
      state.classList.add("container-status", statusInfo.cssClass);
      state.textContent = updateInfo.inProgress
        ? this._updateProgressLabel(updateInfo)
        : statusInfo.label;
      infoBlock.appendChild(state);

      const resources = this._buildResourceUsage(container);
      if (resources) {
        infoBlock.appendChild(resources);
      }

      row.appendChild(infoBlock);
      row.appendChild(this._buildActions(container, statusInfo, key, pendingAction, busy));

      this._attachContainerActions(row, container, statusInfo, name.textContent || "");
      return row;
    }

    _buildBadges(container, updateInfo) {
      const badges = [];
      const displayName = this._containerDisplayName(container);

      if (updateInfo.available && this.config.show_update_badge !== false) {
        const badge = document.createElement("span");
        badge.classList.add("badge", "update-badge");

        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", "mdi:package-up");
        badge.appendChild(icon);

        const text = document.createElement("span");
        text.textContent = this._localize("badges.update_available");
        badge.appendChild(text);

        if (updateInfo.title) {
          badge.title = updateInfo.title;
        }

        const behaviour = container.update_action || "more-info";
        if (behaviour !== "none" && updateInfo.entityId) {
          const label = this._localize("badges.update_available_aria", { name: displayName });
          if (behaviour === "install") {
            badge.classList.add("actionable");
            badge.setAttribute("role", "button");
            badge.setAttribute("tabindex", "0");
            badge.setAttribute("aria-label", label);
            const run = (event) => {
              event.stopPropagation();
              this._handleAction(container, "update");
            };
            badge.addEventListener("click", run);
            badge.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                run(event);
              }
            });
          } else {
            this._makeElementActionable(badge, updateInfo.entityId, label);
          }
        }
        badges.push(badge);
      }

      const healthEntity = container.health_entity ? this._getEntity(container.health_entity) : undefined;
      if (healthEntity && this.config.show_health !== false) {
        const raw = (healthEntity.state || "").toString().toLowerCase();
        if (raw && raw !== "unknown" && raw !== "unavailable") {
          const badge = document.createElement("span");
          badge.classList.add("badge", "health-badge", `health-${raw}`);

          const dot = document.createElement("span");
          dot.classList.add("health-dot");
          badge.appendChild(dot);

          const text = document.createElement("span");
          const known = this._getTranslationValue(DEFAULT_TRANSLATIONS, `health.${raw}`);
          text.textContent = known ? this._localize(`health.${raw}`) : healthEntity.state;
          badge.appendChild(text);

          this._makeElementActionable(
            badge,
            container.health_entity,
            this._localize("badges.health_aria", { state: text.textContent }),
          );
          badges.push(badge);
        }
      }

      return badges;
    }

    _buildActions(container, statusInfo, key, pendingAction, busy) {
      const actions = document.createElement("div");
      actions.classList.add("actions");

      const toggle = document.createElement("ha-switch");
      toggle.checked = pendingAction ? pendingAction === "start" : statusInfo.isRunning;
      toggle.disabled = !statusInfo.canToggle || busy;
      toggle.title = statusInfo.isRunning
        ? this._localize("actions.stop_container")
        : this._localize("actions.start_container");
      toggle.addEventListener("change", (event) => {
        event.stopPropagation();
        const target = event.target;
        if (!target || target.disabled) {
          return;
        }
        this._handleToggle(container, target.checked, toggle);
      });
      actions.appendChild(toggle);

      const available = this._availableActions(container, statusInfo);
      let primaryKey = this._primaryActionKey(container, statusInfo, available);
      let primary = available.filter((entry) => entry.key === primaryKey)[0];
      if (!primary && primaryKey !== "restart" && primaryKey !== "none" && available.length) {
        // A configured primary that cannot run right now should not push every
        // other action into the overflow.
        primary = available[0];
        primaryKey = primary.key;
      }
      const overflow = available.filter((entry) => entry.key !== primaryKey);

      if (primaryKey !== "none" && (primary || primaryKey === "restart")) {
        // The restart slot always renders so a container without a restart
        // entity still shows why it cannot be restarted.
        const definition = primary || ACTION_BY_KEY.get("restart");
        const button = this._buildActionButton(container, definition, busy || !primary);
        actions.appendChild(button);
      }

      if (overflow.length) {
        actions.appendChild(this._buildOverflow(container, key, overflow, busy));
      }

      return actions;
    }

    _buildActionButton(container, definition, disabled) {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.add("action-button");
      // Kept for backwards compatibility with card_mod styling in the wild.
      if (definition.key === "restart") {
        button.classList.add("restart-button");
      }
      button.dataset.action = definition.key;
      button.disabled = Boolean(disabled);

      const label = this._localize(`actions.${definition.key}`);
      button.title = label;
      button.setAttribute("aria-label", label);

      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", definition.icon);
      button.appendChild(icon);

      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this._handleAction(container, definition.key);
      });

      return button;
    }

    _buildOverflow(container, key, entries, busy) {
      const wrapper = document.createElement("div");
      wrapper.classList.add("overflow");

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.classList.add("action-button", "overflow-trigger");
      trigger.disabled = Boolean(busy);
      trigger.title = this._localize("actions.more");
      trigger.setAttribute("aria-label", this._localize("actions.more"));
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", String(this._menuKey === key));

      const triggerIcon = document.createElement("ha-icon");
      triggerIcon.setAttribute("icon", "mdi:dots-vertical");
      trigger.appendChild(triggerIcon);
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        this._toggleMenu(key);
      });
      wrapper.appendChild(trigger);

      if (this._menuKey !== key) {
        return wrapper;
      }

      const menu = document.createElement("div");
      menu.classList.add("menu");
      menu.setAttribute("role", "menu");

      const items = [];
      entries.forEach((definition) => {
        const armed = this._armed && this._armed.key === key && this._armed.action === definition.key;
        const item = document.createElement("button");
        item.type = "button";
        item.classList.add("menu-item");
        item.dataset.action = definition.key;
        item.setAttribute("role", "menuitem");
        if (definition.destructive) {
          item.classList.add("destructive");
        }
        if (armed) {
          item.classList.add("armed");
        }

        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", armed ? "mdi:alert-outline" : definition.icon);
        item.appendChild(icon);

        const label = document.createElement("span");
        const actionLabel = this._localize(`actions.${definition.key}`);
        label.textContent = armed
          ? this._localize("actions.confirm", { action: actionLabel })
          : actionLabel;
        item.appendChild(label);

        item.addEventListener("click", (event) => {
          event.stopPropagation();
          this._activateMenuItem(container, key, definition);
        });
        items.push(item);
        menu.appendChild(item);
      });

      if (container.hold_action && container.hold_action.action === "url" && container.hold_action.url_path) {
        const link = document.createElement("button");
        link.type = "button";
        link.classList.add("menu-item");
        link.dataset.action = "open";
        link.setAttribute("role", "menuitem");

        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", "mdi:open-in-new");
        link.appendChild(icon);

        const label = document.createElement("span");
        label.textContent = this._localize("actions.open_in_portainer");
        link.appendChild(label);

        link.addEventListener("click", (event) => {
          event.stopPropagation();
          this._closeMenu();
          this._handleContainerAction(container.hold_action, undefined, undefined);
          this.render();
        });
        items.push(link);
        menu.appendChild(link);
      }

      menu.addEventListener("keydown", (event) => this._handleMenuKeydown(event, items));
      wrapper.appendChild(menu);
      this._menuElement = menu;
      this._menuAnchor = wrapper;
      this._menuItems = items;

      return wrapper;
    }

    _handleMenuKeydown(event, items) {
      if (event.key === "Escape") {
        event.preventDefault();
        this._closeMenu();
        this.render();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
        return;
      }
      event.preventDefault();
      const current = items.indexOf(event.target);
      let next = current;
      if (event.key === "ArrowDown") {
        next = current + 1 >= items.length ? 0 : current + 1;
      } else if (event.key === "ArrowUp") {
        next = current <= 0 ? items.length - 1 : current - 1;
      } else if (event.key === "Home") {
        next = 0;
      } else {
        next = items.length - 1;
      }
      this._menuFocusIndex = next;
      if (items[next]) {
        items[next].focus();
      }
    }

    _activateMenuItem(container, key, definition) {
      if (definition.destructive && this._confirmRequired(definition.key)) {
        const armed = this._armed && this._armed.key === key && this._armed.action === definition.key;
        if (!armed) {
          this._arm(key, definition.key);
          this.render();
          return;
        }
      }
      this._disarm();
      this._closeMenu();
      this._handleAction(container, definition.key);
    }

    _confirmRequired(actionKey) {
      const configured = this.config.confirm_actions;
      if (configured === undefined) {
        return true;
      }
      return asList(configured).map(String).indexOf(actionKey) !== -1;
    }

    _arm(key, actionKey) {
      this._disarm();
      this._armed = { key, action: actionKey };
      this._armTimer = window.setTimeout(() => {
        this._armTimer = undefined;
        this._armed = undefined;
        this.render();
      }, ARM_TIMEOUT_MS);
    }

    _disarm() {
      if (this._armTimer) {
        window.clearTimeout(this._armTimer);
        this._armTimer = undefined;
      }
      this._armed = undefined;
    }

    _toggleMenu(key) {
      if (this._menuKey === key) {
        this._closeMenu();
      } else {
        this._openMenu(key);
      }
      this.render();
    }

    _openMenu(key) {
      this._closeMenu();
      this._menuKey = key;
      this._menuFocusIndex = undefined;
      this._outsideHandler = (event) => {
        const path = typeof event.composedPath === "function" ? event.composedPath() : [];
        // The anchor covers the trigger too: its own handler does the toggling.
        if (this._menuAnchor && path.indexOf(this._menuAnchor) !== -1) {
          return;
        }
        this._closeMenu();
        this.render();
      };
      document.addEventListener("click", this._outsideHandler, true);
    }

    _closeMenu() {
      if (this._outsideHandler) {
        document.removeEventListener("click", this._outsideHandler, true);
        this._outsideHandler = undefined;
      }
      this._menuKey = undefined;
      this._menuElement = undefined;
      this._menuAnchor = undefined;
      this._menuFocusIndex = undefined;
      this._disarm();
    }

    // ---------------------------------------------------------------- //
    // Lifecycle actions                                                 //
    // ---------------------------------------------------------------- //

    _availableActions(container, statusInfo) {
      const allowed = container.actions || this.config.actions;
      const allowList = allowed === undefined ? undefined : asList(allowed).map(String);

      return CONTAINER_ACTIONS.filter((definition) => {
        if (allowList && allowList.indexOf(definition.key) === -1) {
          return false;
        }
        const state = this._actionState(container, definition.key);
        if (!state.service) {
          return false;
        }
        if (!state.available) {
          return false;
        }
        if (definition.key === "update") {
          // Only worth offering when there is actually something to install.
          return this._updateInfo(container).available;
        }
        return true;
      }).map((definition) => ({ ...definition, statusInfo }));
    }

    _primaryActionKey(container, statusInfo, available) {
      const configured = (container.primary_action || this.config.primary_action || "auto")
        .toString()
        .toLowerCase();

      if (configured === "auto") {
        // A lone action does not deserve a menu — the trigger would cost the
        // same space and an extra click. Two or more collapse into the menu so
        // the row stays narrow.
        return available.length === 1 ? available[0].key : "none";
      }

      // A paused container cannot be restarted, so lead with Resume instead.
      if (
        configured === "restart" &&
        statusInfo.rawState &&
        statusInfo.rawState.toString().toLowerCase() === "paused" &&
        available.some((entry) => entry.key === "resume")
      ) {
        return "resume";
      }

      return configured;
    }

    _actionState(container, actionKey) {
      const service = this._getActionService(container, actionKey);
      const entityId = container[`${actionKey}_entity`];
      let available = true;
      if (entityId) {
        const entity = this._getEntity(entityId);
        // Portainer marks each button unavailable when the action does not
        // apply to the container's current state; trust that over guessing.
        available = Boolean(entity) && entity.state !== "unavailable";
      }
      return { service, entityId, available };
    }

    _getActionService(container, actionKey) {
      if (!container) {
        return undefined;
      }

      const definition = ACTION_BY_KEY.get(actionKey);
      const entityId = container[`${actionKey}_entity`];

      if (entityId && definition && definition.domain && definition.service) {
        return {
          domain: definition.domain,
          service: definition.service,
          data: { entity_id: entityId },
        };
      }

      if (entityId) {
        const capability = this._actionCapability(entityId, container[`${actionKey}_domain`]);
        if (capability) {
          return {
            domain: capability.domain,
            service: capability.service,
            data: { entity_id: capability.entity_id },
          };
        }
      }

      return this._normalizeService(container[`${actionKey}_service`]);
    }

    _actionCapability(entityId, domainOverride) {
      if (!entityId) {
        return undefined;
      }
      const domain = domainOverride || this._entityDomain(entityId);
      if (!domain) {
        return undefined;
      }
      const mapping = ACTION_SERVICE_MAP[domain];
      if (!mapping) {
        return undefined;
      }
      return { domain, entity_id: entityId, service: mapping.service };
    }

    _updateInfo(container) {
      const entityId = container.update_entity;
      const entity = entityId ? this._getEntity(entityId) : undefined;
      if (!entity) {
        return { entityId, available: false, inProgress: false };
      }
      const attributes = entity.attributes || {};
      const digest = (value) =>
        typeof value === "string" && value.length > 12 ? `${value.slice(0, 12)}…` : value;
      const installed = digest(attributes.installed_version);
      const latest = digest(attributes.latest_version);
      return {
        entityId,
        available: entity.state === "on",
        // Versions here are image digests, never a friendly version number.
        title: installed || latest ? `${installed || "?"} → ${latest || "?"}` : undefined,
        inProgress: attributes.in_progress === true || typeof attributes.in_progress === "number",
        percentage: typeof attributes.update_percentage === "number" ? attributes.update_percentage : undefined,
      };
    }

    _updateProgressLabel(updateInfo) {
      if (typeof updateInfo.percentage === "number") {
        return `${this._localize("badges.installing")} ${Math.round(updateInfo.percentage)}%`;
      }
      return this._localize("badges.installing");
    }

    _containerKey(container) {
      if (container.id) {
        return container.id;
      }
      if (!container.__dockerCardKey) {
        const fallback =
          container.name ||
          container.status_entity ||
          container.control_entity ||
          container.switch_entity ||
          cryptoRandom();
        Object.defineProperty(container, "__dockerCardKey", {
          value: fallback,
          enumerable: false,
          configurable: false,
        });
      }
      return container.__dockerCardKey;
    }

    _normalizeContainers(input) {
      if (!input) {
        return [];
      }

      const result = [];
      const addCandidate = (candidate) => {
        const normalized = this._cloneContainer(candidate);
        if (normalized) {
          result.push(normalized);
        }
      };

      const isIterable = Array.isArray(input) || typeof input[Symbol.iterator] === "function";
      if (isIterable) {
        try {
          for (const candidate of input) {
            addCandidate(candidate);
          }
        } catch (error) {
          console.warn("docker-card: Failed to iterate containers", error);
        }
        if (!result.length && Array.isArray(input) && input.length) {
          console.warn("docker-card: Containers configuration could not be parsed", input);
        }
        return result;
      }

      if (!result.length && looksLikeContainer(input)) {
        addCandidate(input);
      }

      if (!result.length && typeof input === "object") {
        const values = Object.values(input);
        if (values.length) {
          values.forEach(addCandidate);
        } else {
          addCandidate(input);
        }
      }

      if (!result.length) {
        console.warn("docker-card: Containers configuration could not be parsed", input);
      }

      return result;
    }

    _cloneContainer(candidate) {
      if (!candidate || typeof candidate !== "object") {
        return undefined;
      }
      let clone;
      try {
        if (typeof structuredClone === "function") {
          clone = structuredClone(candidate);
        }
      } catch (error) {
        console.warn("docker-card: structuredClone failed, falling back to shallow copy", error);
      }
      if (!clone) {
        try {
          clone = { ...candidate };
        } catch (error) {
          console.warn("docker-card: Unable to copy container config", candidate, error);
          return undefined;
        }
      }
      if (clone && clone.stopped_color && !clone.not_running_color) {
        clone.not_running_color = clone.stopped_color;
      }
      if (clone && Object.prototype.hasOwnProperty.call(clone, "extra_entities")) {
        clone.extra_entities = normalizeExtraEntities(clone.extra_entities);
      }
      if (clone) {
        const running = lowercaseList(clone.running_states);
        const stopped = lowercaseList(clone.stopped_states);
        if (running) {
          clone.running_states = running;
        }
        if (stopped) {
          clone.stopped_states = stopped;
        }
      }
      return clone;
    }

    _containerStatus(container) {
      const stateEntityId = container.status_entity || container.control_entity || container.switch_entity;
      const entity = stateEntityId ? this._getEntity(stateEntityId) : undefined;
      const rawState = entity ? entity.state : undefined;

      const runningStates = container.running_states || this.config.running_states;
      const stoppedStates = container.stopped_states || this.config.stopped_states;

      const transitionalStates = container.transitional_states || this.config.transitional_states;

      const normalizedState = rawState ? rawState.toLowerCase() : undefined;
      const isRunning = normalizedState ? runningStates.includes(normalizedState) : false;
      const isStopped = normalizedState ? stoppedStates.includes(normalizedState) : false;
      const isTransitional =
        !isRunning && !isStopped && normalizedState ? transitionalStates.includes(normalizedState) : false;
      const isInFlight = normalizedState ? IN_FLIGHT_STATES.includes(normalizedState) : false;

      const label = this._prettyStatus(rawState, { runningStates, stoppedStates });

      const cssClass = isRunning
        ? "running"
        : isTransitional
          ? "transitional"
          : isStopped
            ? "stopped"
            : "unknown";

      const controlEntityId = container.control_entity || container.switch_entity;
      const toggleCapability = this._toggleCapability(controlEntityId, container.control_domain || container.switch_domain);
      // Nothing to toggle mid-restart, but a paused container can still be stopped.
      const canToggle =
        Boolean(toggleCapability || (container.start_service && container.stop_service)) && !isInFlight;

      const restartService = this._getActionService(container, "restart");
      const canRestart = Boolean(restartService);

      return {
        entity,
        entityId: stateEntityId,
        rawState,
        label,
        cssClass,
        isRunning,
        isTransitional,
        isInFlight,
        canToggle,
        canRestart,
      };
    }

    _containerDisplayName(container) {
      if (!container || typeof container !== "object") {
        return this._localize("common.container");
      }
      if (container.name) {
        return container.name;
      }
      const fallbackEntity =
        container.status_entity ||
        container.control_entity ||
        container.switch_entity ||
        container.restart_entity;
      const friendly = fallbackEntity ? this._friendlyName(fallbackEntity) : undefined;
      return friendly || this._localize("common.container");
    }

    _resolveContainerIcon(container) {
      if (!container || this.config.show_icons === "never") {
        return undefined;
      }

      const configured = container.icon;
      if (configured === false || configured === "none") {
        return undefined;
      }
      if (typeof configured === "string" && configured.trim()) {
        return configured.trim();
      }

      const candidates = [
        container.status_entity,
        container.control_entity,
        container.switch_entity,
      ];
      for (const entityId of candidates) {
        const entity = entityId ? this._getEntity(entityId) : undefined;
        const icon = entity && entity.attributes ? entity.attributes.icon : undefined;
        if (typeof icon === "string" && icon.trim()) {
          return icon.trim();
        }
      }

      // "auto" only shows an icon somebody actually chose; "always" fills the gaps.
      return this.config.show_icons === "always" ? DEFAULT_CONTAINER_ICON : undefined;
    }

    _buildResourceUsage(container) {
      if (!container) {
        return null;
      }

      const displayName = this._containerDisplayName(container);
      const items = [
        { entityId: container.cpu_entity, label: this._localize("resources.cpu") },
        { entityId: container.memory_entity, label: this._localize("resources.memory") },
      ];

      (container.extra_entities || []).forEach((extra) => {
        const entity = this._getEntity(extra.entity);
        items.push({
          entityId: extra.entity,
          label: this._extraEntityLabel(extra, entity, displayName),
          icon: extra.icon,
          allowText: true,
        });
      });

      const resourcesDiv = document.createElement("div");
      resourcesDiv.classList.add("container-resources");

      items.forEach(({ entityId, label, icon, allowText }) => {
        const entity = entityId ? this._getEntity(entityId) : undefined;
        const value = this._formatResourceValue(entity, { allowText });
        if (value === null) {
          return;
        }

        const item = document.createElement("div");
        item.classList.add("resource-item");
        item.title = `${label}: ${value}`;

        if (icon) {
          const iconEl = document.createElement("ha-icon");
          iconEl.classList.add("resource-icon");
          iconEl.setAttribute("icon", icon);
          item.appendChild(iconEl);
        } else {
          const labelEl = document.createElement("span");
          labelEl.classList.add("resource-label");
          labelEl.textContent = `${label}:`;
          item.appendChild(labelEl);
        }

        const valueEl = document.createElement("span");
        valueEl.classList.add("resource-value");
        valueEl.textContent = value;
        item.appendChild(valueEl);

        resourcesDiv.appendChild(item);
      });

      return resourcesDiv.children.length > 0 ? resourcesDiv : null;
    }

    _extraEntityLabel(extra, entity, containerName) {
      if (extra.name) {
        return extra.name;
      }

      const friendly = entity && entity.attributes ? entity.attributes.friendly_name : undefined;
      if (friendly) {
        // Portainer sets has_entity_name, so friendly names read "Zigbee2MQTT Image".
        const stripped = this._stripNamePrefix(friendly, containerName);
        return stripped || friendly;
      }

      const objectId = extra.entity.split(".")[1] || extra.entity;
      const words = objectId
        .split("_")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      return this._stripNamePrefix(words, containerName) || words;
    }

    _stripNamePrefix(value, prefix) {
      if (!value || !prefix) {
        return "";
      }
      const text = value.toString();
      if (text.toLowerCase().indexOf(prefix.toString().toLowerCase()) !== 0) {
        return "";
      }
      return text.slice(prefix.length).replace(/^[\s\-_·:]+/, "").trim();
    }

    _formatResourceValue(entity, options = {}) {
      if (!entity) {
        return null;
      }
      const raw = entity.state;
      if (raw === undefined || raw === null) {
        return null;
      }
      const text = raw.toString().trim();
      const lower = text.toLowerCase();
      if (text === "" || lower === "unknown" || lower === "unavailable") {
        return null;
      }

      // Strict first: a version-like state ("2024.1.0") must not be read as 2024.
      // Percent/size sensors that bake the unit into the state ("7.2%") still
      // parse leniently, but only where a number is the only sensible answer.
      let num;
      if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) {
        num = Number(text);
      } else if (options.allowText) {
        return text;
      } else {
        num = Number.parseFloat(text);
      }

      if (Number.isNaN(num)) {
        return options.allowText ? text : null;
      }

      // CPU/memory are percentages unless told otherwise; an arbitrary extra
      // entity gets no unit invented for it.
      const declaredUnit = (entity.attributes && entity.attributes.unit_of_measurement) || "";
      const unit = declaredUnit || (options.allowText ? "" : "%");
      if (unit === "%") {
        return `${num.toFixed(1)}%`;
      }
      const rounded = Math.abs(num) >= 100 ? num.toFixed(0) : num.toFixed(1).replace(/\.0$/, "");
      return unit ? `${rounded} ${unit}` : rounded;
    }

    _translationUrl(language) {
      if (!language || !MODULE_BASE_URL) {
        return undefined;
      }
      try {
        return new URL(`translations/${language}.json`, MODULE_BASE_URL).toString();
      } catch (error) {
        console.warn("docker-card: Failed to resolve translation URL", language, error);
        return undefined;
      }
    }

    _maybeLoadTranslations(language) {
      if (!language || language === DEFAULT_LANGUAGE) {
        return;
      }
      if (TRANSLATION_CACHE.has(language) || TRANSLATION_PROMISES.has(language)) {
        return;
      }
      const url = this._translationUrl(language);
      if (!url) {
        return;
      }
      const loadPromise = fetch(url)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        })
        .then((data) => {
          if (data && typeof data === "object") {
            TRANSLATION_CACHE.set(language, data);
            this.render();
          }
        })
        .catch((error) => {
          console.warn(`docker-card: Failed to load ${language} translations`, error);
          TRANSLATION_CACHE.set(language, TRANSLATION_CACHE.get(DEFAULT_LANGUAGE) || DEFAULT_TRANSLATIONS);
        })
        .finally(() => {
          TRANSLATION_PROMISES.delete(language);
        });
      TRANSLATION_PROMISES.set(language, loadPromise);
    }

    _localize(key, replacements) {
      if (!key) {
        return "";
      }
      const language = this._hass?.selectedLanguage || this._hass?.language || DEFAULT_LANGUAGE;
      this._maybeLoadTranslations(language);
      const translations = TRANSLATION_CACHE.get(language) || TRANSLATION_CACHE.get(DEFAULT_LANGUAGE) || DEFAULT_TRANSLATIONS;
      const raw = this._getTranslationValue(translations, key) || this._getTranslationValue(DEFAULT_TRANSLATIONS, key) || key;
      return this._applyReplacements(raw, replacements);
    }

    _getTranslationValue(tree, key) {
      if (!tree || typeof tree !== "object" || !key) {
        return undefined;
      }
      return key.split(".").reduce((acc, segment) => {
        if (acc && Object.prototype.hasOwnProperty.call(acc, segment)) {
          return acc[segment];
        }
        return undefined;
      }, tree);
    }

    _applyReplacements(input, replacements) {
      if (!input || !replacements || typeof input !== "string" || typeof replacements !== "object") {
        return input;
      }
      return input.replace(/\{([^}]+)\}/g, (match, key) => {
        if (Object.prototype.hasOwnProperty.call(replacements, key)) {
          return replacements[key];
        }
        return match;
      });
    }

    _showMoreInfo(entityId) {
      if (!entityId) {
        return;
      }
      const event = new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      });
      this.dispatchEvent(event);
    }

    _makeElementActionable(element, entityId, ariaLabel) {
      if (!element || !entityId) {
        return;
      }

      element.classList.add("actionable");
      element.setAttribute("role", "button");
      element.setAttribute("tabindex", "0");
      if (ariaLabel) {
        element.setAttribute("aria-label", ariaLabel);
      }

      let keyboardClickSuppressed = false;

      element.addEventListener("click", (event) => {
        if (keyboardClickSuppressed) {
          keyboardClickSuppressed = false;
          return;
        }
        this._showMoreInfo(entityId);
      });

      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "Space" || event.key === "Spacebar") {
          keyboardClickSuppressed = true;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          this._showMoreInfo(entityId);
        }
        if (event.key === " " || event.key === "Space" || event.key === "Spacebar") {
          event.preventDefault();
        }
      });

      element.addEventListener("keyup", (event) => {
        if (event.key === " " || event.key === "Space" || event.key === "Spacebar") {
          event.preventDefault();
          this._showMoreInfo(entityId);
        }
        keyboardClickSuppressed = false;
      });
    }

    _attachContainerActions(row, container, statusInfo, labelText) {
      let tapAction = this._normalizeActionConfig(container.tap_action);
      let holdAction = this._normalizeActionConfig(container.hold_action);

      if (tapAction && tapAction.action === "none") {
        tapAction = undefined;
      }
      if (holdAction && holdAction.action === "none") {
        holdAction = undefined;
      }

      if (!tapAction && !holdAction) {
        return;
      }

      const defaultEntity = statusInfo.entityId || container.status_entity || container.control_entity || container.switch_entity;
      const toggleEntity = container.control_entity || container.switch_entity || defaultEntity;

      row.classList.add("actionable");
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      const readableLabel = (labelText || "").trim() || container.name || "Container";
      row.setAttribute("aria-label", readableLabel);

      const holdDelay = typeof container.hold_delay === "number" && container.hold_delay >= 0 ? container.hold_delay : 500;
      let holdTimer = null;
      let holdActivated = false;
      let keyboardClickSuppressed = false;

      const clearHoldTimer = () => {
        if (holdTimer) {
          window.clearTimeout(holdTimer);
          holdTimer = null;
        }
      };

      const pointerDownHandler = (event) => {
        if (this._isInteractiveTarget(event)) {
          return;
        }
        if (typeof event.button === "number" && event.button !== 0) {
          return;
        }
        keyboardClickSuppressed = false;
        holdActivated = false;
        clearHoldTimer();
        if (!holdAction) {
          return;
        }
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          holdActivated = true;
          this._handleContainerAction(holdAction, defaultEntity, toggleEntity);
        }, holdDelay);
      };

      const pointerUpHandler = (event) => {
        if (this._isInteractiveTarget(event)) {
          clearHoldTimer();
          holdActivated = false;
          return;
        }
        clearHoldTimer();
        keyboardClickSuppressed = false;
      };

      const pointerCancelHandler = () => {
        clearHoldTimer();
        holdActivated = false;
        keyboardClickSuppressed = false;
      };

      const clickHandler = (event) => {
        if (this._isInteractiveTarget(event)) {
          return;
        }
        if (keyboardClickSuppressed) {
          keyboardClickSuppressed = false;
          return;
        }
        if (holdActivated) {
          holdActivated = false;
          return;
        }
        if (tapAction) {
          this._handleContainerAction(tapAction, defaultEntity, toggleEntity);
        }
      };

      const keydownHandler = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          keyboardClickSuppressed = true;
          if (tapAction) {
            this._handleContainerAction(tapAction, defaultEntity, toggleEntity);
          }
        }
        if ((event.key === " " || event.key === "Space" || event.key === "Spacebar") && holdAction) {
          event.preventDefault();
          holdActivated = true;
          keyboardClickSuppressed = true;
          this._handleContainerAction(holdAction, defaultEntity, toggleEntity);
        }
      };

      const keyupHandler = (event) => {
        if ((event.key === " " || event.key === "Space" || event.key === "Spacebar") && holdAction) {
          event.preventDefault();
          holdActivated = false;
        }
      };

      row.addEventListener("pointerdown", pointerDownHandler);
      row.addEventListener("pointerup", pointerUpHandler);
      row.addEventListener("pointercancel", pointerCancelHandler);
      row.addEventListener("pointerleave", pointerCancelHandler);
      row.addEventListener("click", clickHandler);
      row.addEventListener("keydown", keydownHandler);
      row.addEventListener("keyup", keyupHandler);
    }

    _normalizeActionConfig(action) {
      if (!action) {
        return undefined;
      }
      if (typeof action === "string") {
        return { action };
      }
      if (typeof action !== "object") {
        return undefined;
      }
      if (!action.action) {
        if (action.service || action.service_data || action.data || action.target) {
          return { ...action, action: "call-service" };
        }
        if (action.navigation_path || action.path) {
          return { ...action, action: "navigate" };
        }
        if (action.url || action.url_path) {
          return { ...action, action: "url" };
        }
        if (action.entity) {
          return { ...action, action: "more-info" };
        }
        return { ...action, action: "more-info" };
      }
      return { ...action };
    }

    _handleContainerAction(actionConfig, defaultEntity, toggleEntity) {
      const config = this._normalizeActionConfig(actionConfig);
      if (!config || config.action === "none") {
        return;
      }

      switch (config.action) {
        case "more-info": {
          const entityId = config.entity || defaultEntity;
          if (entityId) {
            this._showMoreInfo(entityId);
          }
          break;
        }
        case "navigate": {
          const path = config.navigation_path || config.path;
          if (path) {
            const event = new CustomEvent("navigate", {
              bubbles: true,
              composed: true,
              detail: { path },
            });
            this.dispatchEvent(event);
          }
          break;
        }
        case "url": {
          const url = config.url_path || config.url;
          if (url) {
            const target = config.new_tab === false ? "_self" : "_blank";
            const features = target === "_blank" ? "noreferrer" : undefined;
            window.open(url, target, features);
          }
          break;
        }
        case "call-service": {
          if (!this._hass) {
            return;
          }
          const serviceString = config.service || config.service_name;
          let domain;
          let service;
          if (serviceString && typeof serviceString === "string") {
            const [svcDomain, svcName] = serviceString.split(".");
            if (svcDomain && svcName) {
              domain = svcDomain;
              service = svcName;
            }
          }
          if (!domain) {
            domain = config.domain;
          }
          if (!service) {
            service = config.service;
          }
          if (!domain || !service) {
            console.warn("docker-card: call-service action missing domain/service", config);
            return;
          }
          const data = { ...(config.service_data || config.data || {}) };
          if (config.entity && !data.entity_id) {
            data.entity_id = config.entity;
          } else if (!data.entity_id && defaultEntity) {
            data.entity_id = defaultEntity;
          }
          const target = config.target;
          if (target) {
            this._hass.callService(domain, service, data, target);
          } else {
            this._hass.callService(domain, service, data);
          }
          break;
        }
        case "fire-dom-event": {
          const eventName = config.event || config.event_type || "ll-custom";
          const detail = config.event_data || config.data || {};
          const event = new CustomEvent(eventName, {
            detail,
            bubbles: true,
            composed: true,
          });
          this.dispatchEvent(event);
          break;
        }
        case "toggle": {
          const entityId = config.entity || toggleEntity || defaultEntity;
          if (entityId && this._hass) {
            this._toggleEntity(entityId);
          }
          break;
        }
        default: {
          console.warn("docker-card: Unsupported action", config);
        }
      }
    }

    _isInteractiveTarget(event) {
      if (!event || !event.target) {
        return false;
      }
      const target = event.target;
      if (target.closest(".actions")) {
        return true;
      }
      const interactiveSelectors = ["button", "a", "input", "select", "textarea", "ha-switch"];
      return interactiveSelectors.some((selector) => Boolean(target.closest(selector)));
    }

    _entityDomain(entityId) {
      return domainFromEntityId(entityId);
    }

    _toggleEntity(entityId) {
      if (!this._hass || !entityId) {
        return;
      }
      this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
    }

    _toggleCapability(entityId, domainOverride) {
      if (!entityId) {
        return undefined;
      }
      const domain = domainOverride || this._entityDomain(entityId);
      if (!domain) {
        return undefined;
      }
      const mapping = TOGGLE_SERVICE_MAP[domain];
      if (!mapping) {
        return undefined;
      }
      return {
        domain,
        entity_id: entityId,
        on: mapping.on,
        off: mapping.off,
      };
    }

    async _handleToggle(container, shouldRun, toggleEl) {
      const key = this._containerKey(container);
      if (!toggleEl) {
        return;
      }

      const action = shouldRun ? "start" : "stop";
      const displayName = this._containerDisplayName(container);
      const actionWord = shouldRun ? this._localize("actions.start") : this._localize("actions.stop");
      const serviceConfig = this._resolveToggleService(container, shouldRun);

      if (!serviceConfig) {
        this._notify(this._localize("notifications.missing_toggle", { action: actionWord, name: displayName }));
        toggleEl.checked = !shouldRun;
        return;
      }

      toggleEl.disabled = true;
      this._setPending(key, action);
      this.render();

      try {
        await this._callService(serviceConfig);
        this._notify(
          shouldRun
            ? this._localize("notifications.starting", { name: displayName })
            : this._localize("notifications.stopping", { name: displayName }),
        );
      } catch (error) {
        console.error("docker-card toggle error", error);
        this._notify(
          shouldRun
            ? this._localize("notifications.failed_start", { name: displayName })
            : this._localize("notifications.failed_stop", { name: displayName }),
        );
      } finally {
        this._clearPending(key);
        this.render();
      }
    }

    async _handleAction(container, actionKey) {
      const serviceConfig = this._getActionService(container, actionKey);
      const displayName = this._containerDisplayName(container);
      const actionLabel = this._localize(`actions.${actionKey}`);

      if (!serviceConfig) {
        this._notify(this._localize("notifications.missing_action", {
          action: actionLabel.toLowerCase(),
          name: displayName,
        }));
        return;
      }

      const key = this._containerKey(container);
      this._closeMenu();
      this._setPending(key, actionKey);
      this.render();

      try {
        await this._callService(serviceConfig);
        this._notify(this._localize(`notifications.pending.${actionKey}`, { name: displayName }));
      } catch (error) {
        console.error(`docker-card ${actionKey} error`, error);
        this._notify(this._localize(`notifications.failed.${actionKey}`, { name: displayName }));
      } finally {
        this._clearPending(key);
        this.render();
      }
    }

    _setPending(key, action) {
      this._clearPendingTimer(key);
      this._pending.set(key, action);
      if (!this._pendingTimers) {
        this._pendingTimers = new Map();
      }
      // A recreate can outlive any sensible spinner. Release the row and let the
      // state sensor tell the truth rather than locking the controls forever.
      this._pendingTimers.set(
        key,
        window.setTimeout(() => {
          this._pendingTimers.delete(key);
          if (this._pending.get(key) === action) {
            this._pending.delete(key);
            this.render();
          }
        }, PENDING_TIMEOUT_MS),
      );
    }

    _clearPending(key) {
      this._clearPendingTimer(key);
      this._pending.delete(key);
    }

    _clearPendingTimer(key) {
      if (this._pendingTimers && this._pendingTimers.has(key)) {
        window.clearTimeout(this._pendingTimers.get(key));
        this._pendingTimers.delete(key);
      }
    }

    _resolveToggleService(container, shouldRun) {
      const controlEntityId = container.control_entity || container.switch_entity;
      const toggleCapability = this._toggleCapability(controlEntityId, container.control_domain || container.switch_domain);
      if (toggleCapability) {
        const serviceName = shouldRun ? toggleCapability.on : toggleCapability.off;
        if (serviceName) {
          return {
            domain: toggleCapability.domain,
            service: serviceName,
            data: {
              entity_id: toggleCapability.entity_id,
            },
          };
        }
      }

      const candidate = shouldRun ? container.start_service : container.stop_service;
      return this._normalizeService(candidate);
    }

    _normalizeService(service) {
      if (!service) {
        return undefined;
      }

      if (typeof service === "string") {
        const parts = service.split(".");
        if (parts.length !== 2) {
          console.warn("Invalid service string", service);
          return undefined;
        }
        return { domain: parts[0], service: parts[1], data: {} };
      }

      const { domain, service: srv, data, service_data, entity_id, target } = service;
      if (!domain || !srv) {
        console.warn("Invalid service object", service);
        return undefined;
      }

      const payload = { ...(service_data || data || {}) };

      if (entity_id && !payload.entity_id) {
        payload.entity_id = entity_id;
      }

      if (target && !payload.target) {
        payload.target = target;
      }

      return {
        domain,
        service: srv,
        data: payload,
      };
    }

    async _callService(service) {
      if (!this._hass) {
        throw new Error("Home Assistant instance unavailable");
      }
      return this._hass.callService(service.domain, service.service, service.data || {});
    }

    _computeOverallStatus() {
      const entityId = this._effectiveOverview().status;
      const entity = entityId ? this._getEntity(entityId) : undefined;
      const rawState = entity ? entity.state : undefined;
      const normalized = this._normalizeStatus(rawState);
      const label = normalized.label || this._localize("status.unknown");
      const cssClass = normalized.cssClass || "idle";
      const tone = normalized.tone || "idle";
      const accent = this._statusAccent(tone);

      return { label, cssClass, tone, accent, entityId };
    }

    _normalizeStatus(state) {
      if (!state) {
        return { label: this._localize("status.unknown"), cssClass: "idle", tone: "idle" };
      }

      const value = state.toString().toLowerCase();
      if (["on", "running", "online", "ok", "true", "ready"].includes(value)) {
        return { label: this._localize("status.online"), cssClass: "running", tone: "running" };
      }
      if (["off", "offline", "error", "problem", "false", "down"].includes(value)) {
        return { label: this._localize("status.offline"), cssClass: "offline", tone: "not_running" };
      }
      const transitional = {
        starting: "status.starting",
        degraded: "status.degraded",
        paused: "status.paused",
        unknown: "status.unknown",
        idle: "status.idle",
      };
      if (Object.prototype.hasOwnProperty.call(transitional, value)) {
        return {
          label: this._localize(transitional[value]),
          cssClass: "idle",
          tone: "idle",
        };
      }
      return { label: this._formatStateValue(state), cssClass: "idle", tone: "idle" };
    }

    _statusAccent(tone) {
      if (tone === "running") {
        return this.config.running_color;
      }
      if (tone === "not_running") {
        return this.config.not_running_color;
      }
      return undefined;
    }

    _prettyStatus(state, options = {}) {
      if (!state) {
        return this._localize("status.unknown");
      }
      const value = state.toString();
      const lower = value.toLowerCase();
      const running = options.runningStates || this.config.running_states;
      const stopped = options.stoppedStates || this.config.stopped_states;

      if (running.includes(lower)) {
        return this._localize("status.running");
      }
      if (stopped.includes(lower)) {
        return this._localize("status.stopped");
      }

      const transitional = {
        starting: "status.starting",
        degraded: "status.degraded",
        paused: "status.paused",
        unknown: "status.unknown",
        idle: "status.idle",
      };
      if (Object.prototype.hasOwnProperty.call(transitional, lower)) {
        return this._localize(transitional[lower]);
      }

      return value.charAt(0).toUpperCase() + value.slice(1);
    }

    _formatStateValue(state) {
      if (state === undefined || state === null) {
        return "—";
      }
      if (state === "unknown" || state === "unavailable") {
        return "—";
      }
      return state;
    }

    _isPlaceholderValue(value) {
      if (value === undefined || value === null) {
        return true;
      }
      const str = value.toString().trim();
      if (!str) {
        return true;
      }
      if (str === "—") {
        return true;
      }
      if (/^(unknown|unavailable)$/i.test(str)) {
        return true;
      }
      const stripped = str.replace(/[—\s/·]/g, "");
      return stripped.length === 0;
    }

    _parseIntState(state) {
      if (state === undefined || state === null) {
        return undefined;
      }
      const str = state.toString().trim();
      if (!str) {
        return undefined;
      }
      const parsed = Number(str);
      if (Number.isInteger(parsed)) {
        return parsed;
      }
      const numericMatch = str.match(/-?\d+/);
      if (numericMatch) {
        const coerced = Number(numericMatch[0]);
        if (Number.isInteger(coerced)) {
          return coerced;
        }
      }
      return undefined;
    }

    _getEntity(entityId) {
      if (!entityId || !this._hass || !this._hass.states) {
        return undefined;
      }
      return this._hass.states[entityId];
    }

    _friendlyName(entityId) {
      const entity = this._getEntity(entityId);
      if (!entity) {
        return entityId || this._localize("common.container");
      }
      if (entity.attributes && entity.attributes.friendly_name) {
        return entity.attributes.friendly_name;
      }
      return entityId || this._localize("common.container");
    }

    _notify(message) {
      if (!message) {
        return;
      }
      const event = new CustomEvent("hass-notification", {
        detail: { message },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(event);
    }
  }

  customElements.define(CARD_NAME, DockerCard);
})();
