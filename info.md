# Docker Card

A simple Lovelace card that lets you monitor and control your Docker containers without leaving Home Assistant.

## Highlights

- Compact overview of Docker host stats (counts, version, OS, daemon state)
- Live container list with status badges and start/stop actions
- Optional per-container CPU and memory usage, plus any other entity you want on the row
- Start, stop, restart, pause, resume, kill and recreate from one compact menu, with confirmation on the destructive ones
- Image-update badge per container, installable from the card
- Auto-discovery from the Portainer integration — one line of YAML builds the whole card
- Optional grouping by Docker Compose stack, with a switch for the whole stack
- Optional per-container icons
- Theme-aware styling with configurable running vs not-running colors
- Works out of the box with Portainer entities or any toggle-friendly domain
- Optional tap/hold actions on each container row to trigger more-info, URLs, or service calls

## Installation

1. In Home Assistant, open **HACS → Frontend → ⋮ → Custom repositories**.
2. Paste this repository URL, choose **Dashboard**, and click **Add**.
3. Search for **Docker Card** under **Frontend**, open the entry, then click **Download**.
4. Reload Lovelace resources (or restart Home Assistant) so the card is available.
5. If HACS does not add it automatically, register `/hacsfiles/lovelace-docker-card/docker-card.js` as a Lovelace resource.

## Example configuration

With the Portainer integration, this is the whole configuration:

```yaml
type: custom:docker-card
title: Docker @ MyServer
auto_discover: true
group_by: stack
containers_expanded: true
```

Or wire everything up by hand:

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
    hold_action:
      action: call-service
      service: script.trigger_container_diagnostics
```
