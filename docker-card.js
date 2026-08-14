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
    },
    resources: {
      cpu: "CPU",
      memory: "Memory"
    },
    actions: {
      start: "start",
      stop: "stop",
      restart: "Restart",
      start_container: "Start container",
      stop_container: "Stop container",
    },
    notifications: {
      starting: "Starting {name}…",
      stopping: "Stopping {name}…",
      failed_start: "Failed to start {name}. Check logs.",
      failed_stop: "Failed to stop {name}. Check logs.",
      restarting: "Restarting {name}…",
      failed_restart: "Failed to restart {name}.",
      missing_toggle: "No service configured to {action} {name}.",
      missing_restart: "No restart service configured for {name}.",
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

  const RESTART_SERVICE_MAP = {
    button: { service: "press" },
    switch: { service: "turn_on" },
    script: { service: "turn_on" },
    automation: { service: "trigger" },
  };

  const DEFAULT_CONTAINER_ICON = "mdi:docker";

  const CONTAINER_KEYS = [
    "id",
    "name",
    "icon",
    "extra_entities",
    "status_entity",
    "control_entity",
    "control_domain",
    "switch_entity",
    "switch_domain",
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
        running_states: ["running", "on", "started", "up"],
        stopped_states: ["stopped", "off", "exited", "down", "inactive"],
        running_color: "var(--state-active-color, var(--success-color, #2e8f57))",
        not_running_color: "var(--state-error-color, var(--error-color, #c22040))",
        ...normalizedConfig,
        containers,
      };

      this.config.running_states =
        lowercaseList(this.config.running_states) || ["running", "on", "started", "up"];
      this.config.stopped_states =
        lowercaseList(this.config.stopped_states) || ["stopped", "off", "exited", "down", "inactive"];
      this.config.show_containers = normalizeVisibility(this.config.show_containers);
      this.config.show_icons = normalizeVisibility(this.config.show_icons);
      this._trackedEntities = undefined;

      if (typeof this.config.containers_expanded === "boolean") {
        this._containersExpanded = this.config.containers_expanded;
      }

      if (!this.config.docker_overview || typeof this.config.docker_overview !== "object") {
        this.config.docker_overview = {};
      }

      if (!this.config.containers.length) {
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
      if (previous && !this._relevantStateChanged(previous, hass)) {
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
      return 3 + Math.min(this.config.containers.length, 8);
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

      Object.values(this.config.docker_overview || {}).forEach(add);
      (this.config.containers || []).forEach((container) => {
        add(container.status_entity);
        add(container.control_entity);
        add(container.switch_entity);
        add(container.restart_entity);
        add(container.cpu_entity);
        add(container.memory_entity);
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
          justify-content: space-between;
          margin-bottom: 1rem;
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
        .restart-button {
          border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
          background: transparent;
          color: var(--primary-text-color);
          font: inherit;
          border-radius: 999px;
          padding: 0.4rem 1rem;
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
        }
        .restart-button:hover {
          border-color: var(--primary-color);
          color: var(--primary-color);
        }
        .restart-button:active {
          background: var(--primary-color);
          color: var(--text-primary-color, #fff);
        }
        .restart-button:disabled,
        ha-switch[disabled] {
          opacity: 0.6;
          cursor: not-allowed;
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

      return wrapper;
    }

    _buildOverview() {
      const overviewConfig = this.config.docker_overview;
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
      const { containers, show_containers: showContainers } = this.config;

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
      // keep the list aligned.
      const icons = containers.map((container) => this._resolveContainerIcon(container));
      const anyIcon = icons.some(Boolean);

      containers.forEach((container, index) => {
        const key = this._containerKey(container);
        const pendingAction = this._pending.get(key);
        const row = document.createElement("div");
        row.classList.add("container-row");
        row.dataset.containerKey = key;

        const statusInfo = this._containerStatus(container);
        row.classList.add(statusInfo.cssClass);
        const runningColor = container.running_color || this.config.running_color;
        const notRunningColor =
          container.not_running_color || container.stopped_color || this.config.not_running_color;
        if (runningColor) {
          row.style.setProperty("--docker-card-running-color", runningColor);
        }
        if (notRunningColor) {
          row.style.setProperty("--docker-card-not-running-color", notRunningColor);
        }
        if (pendingAction) {
          row.classList.add("pending");
        }

        if (anyIcon) {
          const icon = document.createElement("ha-icon");
          icon.classList.add("container-icon");
          if (icons[index]) {
            icon.setAttribute("icon", icons[index]);
          } else {
            icon.classList.add("placeholder-icon");
          }
          row.appendChild(icon);
        }

        const infoBlock = document.createElement("div");
        infoBlock.classList.add("container-info");

        const name = document.createElement("div");
        name.classList.add("container-name");
        name.textContent = container.name || this._friendlyName(container.status_entity || container.switch_entity);
        infoBlock.appendChild(name);

        const state = document.createElement("div");
        state.classList.add("container-status", statusInfo.cssClass);
        state.textContent = statusInfo.label;
        infoBlock.appendChild(state);

        const resources = this._buildResourceUsage(container);
        if (resources) {
          infoBlock.appendChild(resources);
        }

        row.appendChild(infoBlock);

        const actions = document.createElement("div");
        actions.classList.add("actions");

        const toggle = document.createElement("ha-switch");
        toggle.checked = pendingAction ? pendingAction === "start" : statusInfo.isRunning;
        toggle.disabled = !statusInfo.canToggle || Boolean(pendingAction);
        toggle.title = statusInfo.isRunning
          ? this._localize("actions.stop_container")
          : this._localize("actions.start_container");
        toggle.addEventListener("change", (event) => {
          event.stopPropagation();
          const target = event.target;
          if (!target || target.disabled) {
            return;
          }
          const shouldRun = target.checked;
          this._handleToggle(container, shouldRun, toggle);
        });
        actions.appendChild(toggle);

        const restartButton = document.createElement("button");
        restartButton.classList.add("restart-button");
        restartButton.textContent = this._localize("actions.restart");
        restartButton.disabled = !statusInfo.canRestart || Boolean(pendingAction);
        restartButton.addEventListener("click", (event) => {
          event.stopPropagation();
          this._handleRestart(container, restartButton);
        });
        actions.appendChild(restartButton);

        row.appendChild(actions);
        this._attachContainerActions(row, container, statusInfo, name.textContent || "");

        list.appendChild(row);
      });

      return section;
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

      const normalizedState = rawState ? rawState.toLowerCase() : undefined;
      const isRunning = normalizedState ? runningStates.includes(normalizedState) : false;
      const isStopped = normalizedState ? stoppedStates.includes(normalizedState) : false;

      const label = this._prettyStatus(rawState, { runningStates, stoppedStates });

      const cssClass = isRunning ? "running" : isStopped ? "stopped" : "unknown";

      const controlEntityId = container.control_entity || container.switch_entity;
      const toggleCapability = this._toggleCapability(controlEntityId, container.control_domain || container.switch_domain);
      const canToggle = Boolean(toggleCapability || (container.start_service && container.stop_service));

      const restartService = this._getRestartService(container);
      const canRestart = Boolean(restartService);

      return {
        entity,
        entityId: stateEntityId,
        rawState,
        label,
        cssClass,
        isRunning,
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
      return objectId
        .split("_")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
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

    _restartCapability(entityId, domainOverride) {
      if (!entityId) {
        return undefined;
      }
      const domain = domainOverride || this._entityDomain(entityId);
      if (!domain) {
        return undefined;
      }
      const mapping = RESTART_SERVICE_MAP[domain];
      if (!mapping) {
        return undefined;
      }
      return {
        domain,
        entity_id: entityId,
        service: mapping.service,
      };
    }

    _getRestartService(container) {
      if (!container) {
        return undefined;
      }
      if (container.restart_entity) {
        const capability = this._restartCapability(container.restart_entity, container.restart_domain);
        if (capability) {
          return {
            domain: capability.domain,
            service: capability.service,
            data: { entity_id: capability.entity_id },
          };
        }
      }
      return this._normalizeService(container.restart_service);
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
      this._pending.set(key, action);
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
        this._pending.delete(key);
        this.render();
      }
    }

    async _handleRestart(container, buttonEl) {
      if (!buttonEl) {
        return;
      }

      const serviceConfig = this._getRestartService(container);
      const displayName = this._containerDisplayName(container);
      if (!serviceConfig) {
        this._notify(this._localize("notifications.missing_restart", { name: displayName }));
        return;
      }

      const key = this._containerKey(container);
      buttonEl.disabled = true;
      this._pending.set(key, "restart");
      this.render();

      try {
        await this._callService(serviceConfig);
        this._notify(this._localize("notifications.restarting", { name: displayName }));
      } catch (error) {
        console.error("docker-card restart error", error);
        this._notify(this._localize("notifications.failed_restart", { name: displayName }));
      } finally {
        this._pending.delete(key);
        this.render();
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
      const entityId = this.config.docker_overview.status;
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
