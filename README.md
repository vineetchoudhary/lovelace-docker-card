# Docker Card

A simple Lovelace card that lets you view and control your Docker containers from Home Assistant. When paired with the official Home Assistant Portainer integration, every entity shown below already exists (no templates or shell commands required). Drop the card into your dashboard and manage containers without leaving Home Assistant.

![](/screenshots/screenshot.png)

## Features

- Compact overview of your Docker host
- Auto-updating container list with live state badges and control actions
- Per-container CPU and memory usage, plus any other entity you want on the row
- Start, stop, restart, pause, resume, kill and recreate, with confirmation on the destructive ones
- Image-update badge per container, installable from the card
- Auto-discovery: point it at the Portainer integration and it builds the whole card for you
- Optional per-container icons
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
| `show_containers` | No | `auto` (default), `true` or `false` — see [Hiding the container list](#hiding-the-container-list) |
| `show_icons` | No | `auto` (default), `true` or `false` — see [Icons](#icons) |
| `auto_discover` | No | Build the card from the Portainer integration — see [Auto-discovery](#auto-discovery) |
| `primary_action` | No | Which action gets its own button rather than living in the menu. `auto` (default), `none`, or an action name — see [Container actions](#container-actions) |
| `actions` | No | Which actions may appear at all. Defaults to all of them |
| `confirm_actions` | No | Actions needing a second click to fire. Defaults to `kill`, `recreate`, `update`; `[]` disables |
| `show_update_badge` | No | `false` hides the image-update badge |
| `show_health` | No | `false` hides the health badge |
| `show_host_actions` | No | `false` hides the header menu with the prune buttons |
| `group_by` | No | `none` (default) or `stack` — see [Grouping by stack](#grouping-by-stack) |
| `stacks` | No | Per-stack settings, keyed by stack name (see below) |
| `transitional_states` | No | States treated as in-between. Defaults to `restarting, removing, paused, starting` |
| `docker_overview` | No | Mapping of high-level stats to entity IDs (see below) |
| `running_color` | No | Global border/accent color for running containers and status pill |
| `not_running_color` | No | Global border/accent color for containers that are not running |
| `running_states` | No | Global list of states that count as “running”. Defaults to `running, on, started, up`. Matching is case-insensitive |
| `stopped_states` | No | Global list of states that count as “stopped”. Defaults to `stopped, off, exited, down, inactive, dead, created` |
| `stopped_color` | Legacy | Backwards compatible alias for `not_running_color` |
| `containers` | Conditional | List of containers, or a single container object (see below). Not needed when `auto_discover` is set |

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
| `prune_images` | Header menu | Button that prunes unused images |
| `prune_volumes` | Header menu | Button that prunes unused volumes |

#### `containers[]`

| Option | Required | Description |
| --- | --- | --- |
| `name` | No | Friendly label (defaults to the status entity's friendly name) |
| `icon` | No | Icon shown before the name, e.g. `mdi:calendar`. `none` hides it for this row — see [Icons](#icons) |
| `stack` | No | Stack this container belongs to, used by `group_by: stack`. Filled in automatically by auto-discovery |
| `status_entity` | Preferably | Entity whose state represents the container status |
| `control_entity` | Conditional | Entity that supports `turn_on`/`turn_off` (`switch`, `input_boolean`, `light`, `fan`, `script`, `automation`) to start/stop the container |
| `control_domain` | No | Override domain name when the entity uses a custom namespace |
| `start_service` / `stop_service` | Conditional | Service to call instead of `control_entity`, as `domain.service` or an object with `domain`, `service` and optional `data`/`entity_id`/`target` |
| `restart_entity` | No | Entity to trigger a restart. `button` → `press`, `script`/`switch` → `turn_on`, `automation` → `trigger` |
| `pause_entity` | No | Entity that pauses the container |
| `resume_entity` | No | Entity that resumes a paused container |
| `kill_entity` | No | Entity that kills the container |
| `recreate_entity` | No | Entity that recreates the container |
| `update_entity` | No | `update` entity for the container image — see [Image updates](#image-updates) |
| `update_action` | No | What the update badge does: `more-info` (default), `install` or `none` |
| `health_entity` | No | Sensor reporting `healthy` / `unhealthy` / `starting`, shown as a badge |
| `<action>_domain` | No | Override the domain for any action entity |
| `<action>_service` | No | Call a service instead of pressing an entity, for any action |
| `primary_action` | No | Per-container override of the card-level `primary_action` |
| `actions` | No | Per-container override of the card-level `actions` list |
| `cpu_entity` | No | Sensor holding the container's CPU usage — see [CPU and memory usage](#cpu-and-memory-usage) |
| `memory_entity` | No | Sensor holding the container's memory usage |
| `extra_entities` | No | Any other entities to show on the detail line — see [Extra entities](#extra-entities) |
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

Values follow the sensor's own `unit_of_measurement`: a `%` sensor (or one with no unit) renders as
`38.5%`, anything else keeps its unit — `512 MB`. Sensors that are `unknown`, `unavailable` or
non-numeric are skipped, and a container with neither sensor shows no resource line at all.

## Extra entities

`cpu_entity` and `memory_entity` are shorthands for the two most common cases. Anything else you want on
that line goes in `extra_entities`:

```yaml
containers:
  - name: Zigbee2MQTT
    status_entity: sensor.zigbee2mqtt_state
    cpu_entity: sensor.zigbee2mqtt_cpu_usage_total
    memory_entity: sensor.zigbee2mqtt_memory_usage_percentage
    extra_entities:
      - sensor.zigbee2mqtt_image                  # string form
      - entity: sensor.zigbee2mqtt_health         # object form
        name: Health                              # optional label override
        icon: mdi:heart-pulse                     # optional; replaces the text label
```

- Extras render after CPU and memory, in the order you list them.
- Non-numeric states are shown as-is, so image tags and version strings survive intact. Numeric states
  follow the same unit rules as above, except that an extra with no unit is shown as a plain number
  rather than assumed to be a percentage.
- The label defaults to the entity's friendly name with the container name stripped off the front, so
  `Zigbee2MQTT Image` becomes `Image`. Use `name` to override it or `icon` to replace it.
- Long values are truncated; the full `label: value` is always in the tooltip.

## Icons

```yaml
show_icons: true
containers:
  - name: Calendar
    icon: mdi:calendar
    status_entity: sensor.calendar_state
```

The icon sits before the container name and takes the row's running / not-running accent color. Per row
it resolves in this order: `containers[].icon` → the status entity's `icon` attribute → the control
entity's `icon` attribute → `mdi:docker`. Set `icon: none` to opt a single row out.

| `show_icons` | Behaviour |
| --- | --- |
| `auto` (default) | Only show icons that are actually configured, either through `containers[].icon` or a custom `icon` on the entity. Existing dashboards are unchanged |
| `true` | Always show one, falling back to `mdi:docker` |
| `false` | Never show icons, even where `icon` is set |

When any row has an icon, rows without one reserve the same space so the list stays aligned.

## Hiding the container list

```yaml
type: custom:docker-card
show_containers: false     # overview-only card
```

| `show_containers` | Behaviour |
| --- | --- |
| `auto` (default) | Hides the “Containers” section when there are no containers **and** the card still has an overview to show |
| `true` | Always render the section, including the “No containers configured.” hint |
| `false` | Never render it |

`auto` only hides the section when the card has something else to display — with no containers *and* no
overview the hint stays, so a broken configuration is visible instead of rendering as an empty box.

## Container actions

Every container supports the same set of lifecycle actions. Each one takes an entity (pressed through
`button.press`, `switch.turn_on`, `script.turn_on` or `automation.trigger` depending on its domain), or a
service if you would rather call one directly:

```yaml
containers:
  - name: Zigbee2MQTT
    status_entity: sensor.zigbee2mqtt_state
    control_entity: switch.zigbee2mqtt_container
    restart_entity: button.zigbee2mqtt_restart_container
    pause_entity: button.zigbee2mqtt_pause_container
    resume_entity: button.zigbee2mqtt_resume_container
    kill_entity: button.zigbee2mqtt_kill_container
    recreate_entity: button.zigbee2mqtt_recreate_container
    update_entity: update.zigbee2mqtt_image_update
```

The switch starts and stops the container. Everything else sits behind a single `⋮` button, so the row
keeps its width no matter how many actions a container supports:

| `primary_action` | Behaviour |
| --- | --- |
| `auto` (default) | One available action renders as a direct icon button — a menu would cost the same width and an extra click. Two or more collapse into the `⋮` menu |
| `none` | Always use the menu, even for a single action |
| an action name | That action gets the button, the rest go in the menu. `restart` automatically yields to `Resume` on a paused container |

So a hand-written container with only `restart_entity` keeps its one-click restart button, while a
Portainer container offering restart, pause, kill, recreate and update shows a single `⋮` instead of five
buttons.

**Actions appear only when they can run.** The card reads each action entity's own availability, and the
Portainer integration already marks a button `unavailable` when the action does not apply — you cannot
pause a stopped container, or restart a paused one. Nothing configured for an action means it is never
offered, and a container with no available actions shows no button at all.

`kill`, `recreate` and `update` ask for confirmation: the menu item arms on the first click and fires on
the second, disarming itself after a few seconds. Change that with `confirm_actions`, or set
`confirm_actions: []` to fire immediately.

The prune buttons on the Docker host itself sit behind a `⋮` menu in the card header, and are
confirm-gated the same way.

## Image updates

Point `update_entity` at an `update` entity and a container with a pending image update shows an
**Update** badge next to its name:

```yaml
containers:
  - name: Zigbee2MQTT
    status_entity: sensor.zigbee2mqtt_state
    update_entity: update.zigbee2mqtt_image_update
    update_action: more-info      # more-info (default) | install | none
```

Clicking the badge opens the more-info dialog by default, which is where Home Assistant offers its own
install button. `update_action: install` makes the badge install directly instead, and the `⋮` menu always
carries an explicit **Update** item.

While an install is running the row is marked pending and shows `Installing… 42%` when the entity reports
progress. That comes from the entity, not a timer, so it stays accurate for a recreate that takes minutes.

> Portainer reports image versions as sha256 digests rather than version numbers, so the card never prints
> them inline — the before/after digests are truncated into the badge's tooltip.

## Container states

Docker containers are not simply running or stopped, so states fall into three buckets:

| Bucket | Default states | Appearance |
| --- | --- | --- |
| Running | `running`, `on`, `started`, `up` | Running accent color |
| Stopped | `stopped`, `off`, `exited`, `down`, `inactive`, `dead`, `created` | Not-running accent color |
| Transitional | `restarting`, `removing`, `paused`, `starting` | Warning color |

Anything else is shown as-is with the not-running styling. The switch is disabled while a container is
mid-flight (`restarting`, `removing`, `starting`), but stays usable when a container is merely `paused` —
stopping a paused container is perfectly valid. Override any bucket with `running_states`,
`stopped_states` or `transitional_states`, globally or per container.

## Grouping by stack

Set `group_by: stack` and containers are listed under a collapsible heading per stack, with a count and —
where the stack exposes one — a switch that starts or stops the whole stack:

```yaml
type: custom:docker-card
auto_discover: true
group_by: stack
containers_expanded: true
```

```
▾ MEDIA            3   ( )
    Jellyfin        Running
    Sonarr          Running
    Radarr          Stopped
▾ UNGROUPED        2   
    Home Assistant  Running
    Zigbee2MQTT     Running
```

Auto-discovery fills in each container's stack from the Portainer device tree, and picks up the stack's
own switch. Without discovery you can group by hand with `containers[].stack`, and point the group switch
at an entity yourself:

```yaml
group_by: stack
stacks:
  media:
    control_entity: switch.media_stack
containers:
  - name: Jellyfin
    stack: media
    status_entity: sensor.jellyfin_state
  - name: Home Assistant
    status_entity: sensor.homeassistant_state
```

- Groups are sorted by name; containers with no stack collect under **Ungrouped**, always last.
- Each group collapses independently, and stays collapsed across state updates.
- A configured `stacks:` entry overrides whatever discovery found for the same stack name.
- If nothing has a stack, the card renders a flat list as usual, so turning `group_by` on is never
  destructive.

## Auto-discovery

Rather than listing containers by hand, let the card read them from the Portainer integration:

```yaml
type: custom:docker-card
title: Docker @ MyServer
auto_discover: true
containers_expanded: true
```

That is the whole configuration. The card finds every container, wires up its state sensor, switch,
lifecycle buttons, update entity, CPU/memory/health sensors and image name, records which stack each one
belongs to, fills the host overview from the Portainer endpoint, and links each row back to its page in
Portainer on long-press.

Narrow it down when you need to:

```yaml
auto_discover:
  integration: portainer     # default
  endpoint: Local            # endpoint device name or id; omit to include every endpoint
  stack: media               # only containers belonging to this stack
  area: Server rack          # area name, alias or id
  include: ["*"]             # name globs; * and ? are supported
  exclude: ["*-db", "watchtower"]
  sort: name                 # name (default) | state | cpu
  link_to_portainer: true    # default hold_action → the container's Portainer page
  overview: true             # also fill docker_overview from the endpoint device
```

Discovered rows can still be refined by hand. A `containers:` entry whose `name` matches a discovered
container is merged on top of it, and anything that matches nothing is kept as an ordinary manual row:

```yaml
auto_discover: true
containers:
  - name: zigbee2mqtt        # matches the discovered container
    icon: mdi:zigbee
    tap_action:
      action: navigate
      navigation_path: /lovelace/zigbee
```

Notes:

- Entities are matched on the integration's `translation_key`, never on entity IDs — entity IDs are
  generated from names in your own language, so a German or French install discovers exactly the same way.
- Hidden and disabled entities and devices are skipped. `include_hidden: true` opts the hidden ones in.
- Discovery only re-runs when Home Assistant's entity or device registry actually changes, not on every
  state update, so a container added in Portainer appears without a dashboard reload.
- If your Home Assistant does not expose the registries to custom cards, the card logs a warning and falls
  back to whatever `containers:` you configured, rather than failing.
- With several Portainer endpoints and no `endpoint:` set, containers from all of them are listed but the
  overview is left out, since there is no single host to describe.

## Styling and customization

- **Accent colors:** Override `running_color` and `not_running_color` globally, or set per-container overrides to highlight critical services.
- **Running/Total highlight:** The "Running / Total" overview pill turns the not-running color whenever the counts diverge—handy for spotting issues at a glance.
- **Theme alignment:** The card inherits typography, spacing, and background from your current Home Assistant theme, so it stays consistent without extra work.
- **Resource line:** CPU and memory only take up space when you configure them, so a mixed dashboard can show usage for the containers you care about and stay compact for the rest.
- **Compact controls:** actions are round icon buttons rather than text labels, and collapse into a single `⋮` menu once there is more than one, so the row width stays the same whether a container offers one action or six. A restart button still carries the `restart-button` class, so existing `card_mod` styling keeps working.
- **Narrow columns:** below a card width of 360px the switch and buttons drop to their own line instead of squeezing the container name.

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
- **An action is missing from the ⋮ menu:** Either nothing is configured for it, or its entity is currently `unavailable` because the action does not apply to the container's state — Portainer marks pause unavailable on a stopped container, restart unavailable on a paused one, and so on.
- **`auto_discover` finds nothing:** Confirm the Portainer integration is loaded and its devices exist under **Settings → Devices & Services**. The card only matches devices belonging to the integration named in `auto_discover.integration`.

## Development

- Distributed bundle lives in `docker-card.js`
- No build tooling required; the published file is ready-to-serve ES2021 JavaScript

## License

MIT
