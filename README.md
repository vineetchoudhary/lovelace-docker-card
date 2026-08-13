# Docker Card

A simple Lovelace card that lets you view and control your Docker containers from Home Assistant. When paired with the official Home Assistant Portainer integration, every entity shown below already exists (no templates or shell commands required). Drop the card into your dashboard and manage containers without leaving Home Assistant.

![](/screenshots/screenshot.png)

## Features

- Compact overview of your Docker host
- Auto-updating container list with live state badges and control actions
- Per-container CPU and memory usage read from any sensor you point at it
- Theme-aware styling with configurable running vs not-running accent colors
- Works out-of-the-box with entities provided by the Portainer integration; also supports any toggle-friendly domains (`switch`, `input_boolean`, `light`, etc.)
- Optional tap/hold actions per container row for quick navigation, service calls, or external links

## Requirements

- Home Assistant 2025.8 or newer
- Docker managed via the official Portainer integration (provides all referenced sensors, switches, and buttons)
- Optional: For non-Portainer environments, equivalent entities (sensors, binary_sensors, switches, scripts, etc.) that expose Docker data and operations

> [!IMPORTANT]   
> This card **does not** fetch Docker data directly. It visualises data exposed through the standard Home Assistant entity model. Example helpers are included below for non-Portainer setups; if you already use the Home Assistant Portainer integration, you can plug its entities directly into the card.

## Installation

### 1. Via HACS (recommended)
1. In Home Assistant, open **HACS (Community Store) → ⋮ → Custom repositories**.
2. Add this repository as a **Dashboard** type and click **Add**.
3. Locate **Docker Card** under **Frontend** and install it.
4. Reload Lovelace resources (or restart Home Assistant) so the module is served.

<!--
Installation is easiest via the [Home Assistant Community Store (HACS)](https://hacs.xyz/), which is the best place to get third-party integrations for Home Assistant. Once you have HACS set up, simply click the button below (requires My Homeassistant configured) or follow the [instructions for adding a custom repository](https://hacs.xyz/docs/faq/custom_repositories) and then locate **Docker Card** under **Frontend** and install it.

[![](/icons/hacs.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=vineetchoudhary&repository=lovelace-docker-card&category=dashboard)
-->

### 2. Manual install

1. Copy `docker-card.js` to your Home Assistant `/config/www/docker-card/` folder.
2. Add the resource through **Settings → Dashboards → Resources → +**:
   ```yaml
   url: /local/docker-card/docker-card.js
   type: module
   ```
3. Reload the browser cache (`Ctrl/Cmd + Shift + R`).

### Example Configuration
Basic card setup (YAML) using entities exposed by the Portainer integration:

```yaml
type: custom:docker-card
title: Docker @ MyServer
containers_expanded: false
docker_overview:
  container_count: sensor.docker_containers_total
  containers_running: sensor.docker_containers_running
  containers_stopped: sensor.docker_containers_stopped
  docker_version: sensor.docker_version
  image_count: sensor.docker_images
  operating_system: sensor.host_os
  operating_system_version: sensor.host_os_version
  status: binary_sensor.docker_daemon_status
running_color: "var(--state-active-color)"
not_running_color: "#c22040"
containers:
  - name: Home Assistant
    status_entity: sensor.docker_homeassistant_status
    control_entity: switch.docker_homeassistant
    restart_entity: switch.docker_restart_homeassistant
    cpu_entity: sensor.docker_homeassistant_cpu
    memory_entity: sensor.docker_homeassistant_memory
    tap_action:
      action: more-info
      entity: binary_sensor.docker_homeassistant_status
    hold_action:
      action: url
      url_path: https://portainer.local/#!/2/docker/containers/homeassistant
  - name: Node-RED
    status_entity: sensor.docker_nodered_status
    control_entity: switch.docker_nodered
    restart_entity: button.docker_restart_nodered
    cpu_entity: sensor.docker_nodered_cpu
    memory_entity: sensor.docker_nodered_memory
    tap_action:
      action: toggle
      entity: switch.docker_nodered
    hold_action:
      action: call-service
      service: script.trigger_container_diagnostics
```

![](/screenshots/screenshot-expanded.png)

## Quick Start (Portainer integration)

1. Install the **Portainer** integration and complete its setup wizard (Settings → Devices & Services → + → Portainer).
2. Confirm entities such as `sensor.docker_containers_running`, `switch.docker_<container>`, `button.docker_restart_<container>`, and the per-container CPU/memory sensors exist.
3. Add the YAML snippet above to your dashboard (Edit Dashboard → Add Card → Manual → paste YAML).
4. Optionally tweak `running_color` or `not_running_color` to match your theme.

You now have an interactive Docker control panel that stays in sync with Portainer.

### Supported options

#### Card

| Option | Required | Description |
| --- | --- | --- |
| `title` | No | Override the card header (defaults to “Docker Card”) |
| `containers_expanded` | No | Set `true` to expand or `false` (default) to collapse the container list on initial load |
| `docker_overview` | No | Mapping of high-level stats to entity IDs (see below) |
| `running_color` | No | Global border/accent color for running containers and status pill |
| `not_running_color` | No | Global border/accent color for containers that are not running |
| `running_states` | No | Global list of states that count as “running”. Defaults to `running, on, started, up`. Matching is case-insensitive |
| `stopped_states` | No | Global list of states that count as “stopped”. Defaults to `stopped, off, exited, down, inactive` |
| `stopped_color` | Legacy | Backwards compatible alias for `not_running_color` |
| `containers` | **Yes** | List of containers, or a single container object (see below) |

#### `docker_overview`

Each key is optional. A pill is only rendered when its entity exists and has a usable state, so an
unavailable sensor disappears rather than showing a dash.

| Option | Shown as | Description |
| --- | --- | --- |
| `status` | Header pill | Overall daemon state. `on`/`running`/`online`/`ok`/`ready` reads **Online**, `off`/`offline`/`error`/`problem`/`down` reads **Offline**, anything else is treated as idle |
| `container_count` | Running / Total | Total number of containers |
| `containers_running` | Running / Total | Number of running containers. The pill turns the not-running color when running ≠ total |
| `containers_stopped` | Running / Total | Number of stopped containers. Used to derive the total when `container_count` is not configured |
| `image_count` | Images | Number of Docker images |
| `docker_version` | Docker | Docker version |
| `operating_system` | OS | Host operating system |
| `operating_system_version` | OS | Host OS version, joined to the name as `name · version` |

#### `containers[]`

| Option | Required | Description |
| --- | --- | --- |
| `name` | No | Friendly label (defaults to the status entity's friendly name) |
| `status_entity` | Preferably | Entity whose state represents the container status |
| `control_entity` | Conditional | Entity that supports `turn_on`/`turn_off` (`switch`, `input_boolean`, `light`, `fan`, `script`, `automation`) to start/stop the container |
| `control_domain` | No | Override domain name when the entity uses a custom namespace |
| `start_service` / `stop_service` | Conditional | Service to call instead of `control_entity`, as `domain.service` or an object with `domain`, `service` and optional `data`/`entity_id`/`target` |
| `restart_entity` | No | Entity to trigger a restart. `button` → `press`, `script`/`switch` → `turn_on`, `automation` → `trigger` |
| `restart_domain` | No | Override domain for the restart entity |
| `restart_service` | No | Service to call for a restart instead of `restart_entity`, same syntax as `start_service` |
| `cpu_entity` | No | Sensor holding the container's CPU usage — see [CPU and memory usage](#cpu-and-memory-usage) |
| `memory_entity` | No | Sensor holding the container's memory usage |
| `running_color` | No | Per-container override for the running border/accent color |
| `not_running_color` | No | Per-container override for the not-running border/accent color |
| `running_states` | No | Custom list of states that count as “running” for this container |
| `stopped_states` | No | Custom list of states that count as “stopped” for this container |
| `tap_action` | No | Action to run when the row is tapped/clicked (standard Lovelace action object) |
| `hold_action` | No | Action to run on hold/long-press (supports the same syntax as `tap_action`) |
| `hold_delay` | No | Hold detection delay in milliseconds (defaults to 500) |
| `id` | No | Stable identifier for the row. Only needed if two containers share the same name and entities |
| `switch_entity` | Legacy | Backwards compatible alias for `control_entity` |
| `switch_domain` | Legacy | Backwards compatible alias for `control_domain` |
| `stopped_color` | Legacy | Backwards compatible alias for `not_running_color` |

Supported `tap_action` / `hold_action` values are `more-info` (default), `toggle`, `navigate`, `url`, `call-service`, `fire-dom-event` and `none`. `more-info` defaults to the container's `status_entity`; `toggle` defaults to its `control_entity`.

> Tip: `binary_sensor` and `sensor` entities are read-only. Use a `switch`, `input_boolean`, `light`, or similar domain for `control_entity` so the card can call `turn_on`/`turn_off` — otherwise the row's switch stays disabled.

Color settings fall back to Home Assistant theme values (`var(--state-active-color)`, `var(--state-error-color)`) when omitted. Legacy keys `stopped_color` and `containers[].stopped_color` still map to the new not-running color options for backward compatibility.

## CPU and memory usage

Point `cpu_entity` and `memory_entity` at any numeric sensor and the values appear as a small line
under the container's status:

```yaml
containers:
  - name: Home Assistant
    status_entity: sensor.docker_homeassistant_status
    control_entity: switch.docker_homeassistant
    cpu_entity: sensor.docker_homeassistant_cpu
    memory_entity: sensor.docker_homeassistant_memory
```


## Styling and customization

- **Accent colors:** Override `running_color` and `not_running_color` globally, or set per-container overrides to highlight critical services.
- **Running/Total highlight:** The "Running / Total" overview pill turns the not-running color whenever the counts diverge—handy for spotting issues at a glance.
- **Theme alignment:** The card inherits typography, spacing, and background from your current Home Assistant theme, so it stays consistent without extra work.
- **Resource line:** CPU and memory only take up space when you configure them, so a mixed dashboard can show usage for the containers you care about and stay compact for the rest.

## Exposing Docker to Home Assistant

If you rely on the Portainer integration you already have everything you need—just reference its entities in the card configuration above.

### Without Portainer

For environments that do not use Portainer, the example below shows how to surface equivalent entities with `command_line` sensors and `shell_command` helpers. Adjust container names to match your setup.

```yaml
# configuration.yaml or a dedicated package
sensor:
  - platform: command_line
    name: docker_containers_total
    command: "docker info --format '{% raw %}{{.Containers}}{% endraw %}'"
    scan_interval: 60
  - platform: command_line
    name: docker_containers_running
    command: "docker info --format '{% raw %}{{.ContainersRunning}}{% endraw %}'"
    scan_interval: 60
  - platform: command_line
    name: docker_containers_stopped
    command: "docker info --format '{% raw %}{{.ContainersStopped}}{% endraw %}'"
    scan_interval: 60
  - platform: command_line
    name: docker_images
    command: "docker info --format '{% raw %}{{.Images}}{% endraw %}'"
    scan_interval: 300
  - platform: command_line
    name: docker_version
    command: "docker version --format '{% raw %}{{.Server.Version}}{% endraw %}'"
    scan_interval: 3600
  - platform: command_line
    name: docker_homeassistant_status
    command: "docker inspect -f '{% raw %}{{.State.Status}}{% endraw %}' homeassistant"
    scan_interval: 30
  - platform: command_line
    name: docker_nodered_status
    command: "docker inspect -f '{% raw %}{{.State.Status}}{% endraw %}' nodered"
    scan_interval: 30
  - platform: command_line
    name: docker_homeassistant_cpu
    command: "docker stats homeassistant --no-stream --format '{% raw %}{{.CPUPerc}}{% endraw %}' | tr -d '%'"
    unit_of_measurement: "%"
    scan_interval: 60
  - platform: command_line
    name: docker_homeassistant_memory
    command: "docker stats homeassistant --no-stream --format '{% raw %}{{.MemPerc}}{% endraw %}' | tr -d '%'"
    unit_of_measurement: "%"
    scan_interval: 60

binary_sensor:
  - platform: command_line
    name: docker_daemon_status
    command: "docker info > /dev/null && echo 'on' || echo 'off'"
    device_class: connectivity
    scan_interval: 30

shell_command:
  docker_start_homeassistant: "docker start homeassistant"
  docker_stop_homeassistant: "docker stop homeassistant"
  docker_restart_homeassistant: "docker restart homeassistant"
  docker_start_nodered: "docker start nodered"
  docker_stop_nodered: "docker stop nodered"
  docker_restart_nodered: "docker restart nodered"

script:
  docker_start_homeassistant:
    alias: Start Home Assistant container
    sequence:
      - service: shell_command.docker_start_homeassistant
  docker_stop_homeassistant:
    alias: Stop Home Assistant container
    sequence:
      - service: shell_command.docker_stop_homeassistant
  docker_restart_homeassistant:
    alias: Restart Home Assistant container
    sequence:
      - service: shell_command.docker_restart_homeassistant
  docker_start_nodered:
    alias: Start Node-RED container
    sequence:
      - service: shell_command.docker_start_nodered
  docker_stop_nodered:
    alias: Stop Node-RED container
    sequence:
      - service: shell_command.docker_stop_nodered
  docker_restart_nodered:
    alias: Restart Node-RED container
    sequence:
      - service: shell_command.docker_restart_nodered

```

To expose toggle-friendly entities, you can wrap the same shell commands in `command_line` switches or template buttons:

```yaml
switch:
  - platform: command_line
    switches:
      docker_homeassistant:
        friendly_name: Docker Home Assistant
        command_on: "docker start homeassistant"
        command_off: "docker stop homeassistant"
        command_state: "docker inspect -f '{% raw %}{{.State.Running}}{% endraw %}' homeassistant"
        value_template: "{{ value == 'true' or value == 'running' }}"

button:
  - platform: template
    buttons:
      docker_restart_homeassistant:
        name: Restart Home Assistant container
        press:
          service: shell_command.docker_restart_homeassistant
```

Once the entities above are available, wire them into the card configuration as shown earlier.

## Troubleshooting

- **Custom card not found:** Ensure the resource URL is registered (`/hacsfiles/...` for HACS, `/local/...` for manual installs) and hard-refresh the browser.
- **Entities missing:** Double-check the Portainer integration is connected and that entity IDs in your YAML match the ones generated in Home Assistant.
- **Colors not updating:** Reload the dashboard after updating `running_color`/`not_running_color`, and confirm there are no typos in the CSS variables or hex codes.
- **Start/stop switch is greyed out:** The container has no `control_entity`, no `start_service`/`stop_service`, or points at a read-only entity such as a `sensor` or `binary_sensor`.
- **CPU/memory line missing:** The sensor is `unknown`, `unavailable`, or non-numeric. Check its state in **Developer Tools → States**; a state like `7.24%` (with the unit baked into the state) is a string, not a number—strip the `%` in the sensor and set `unit_of_measurement` instead.
- **Memory shown as a percentage when it isn't:** A sensor with no `unit_of_measurement` is assumed to be a percentage. Set the unit (`MB`, `MiB`, …) on the sensor.

## Development

- Distributed bundle lives in `docker-card.js`
- No build tooling required; the published file is ready-to-serve ES2021 JavaScript

## License

MIT
